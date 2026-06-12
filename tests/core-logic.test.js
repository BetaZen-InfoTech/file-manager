/*
 * Dependency-free core-logic tests — runs with `node --test`.
 *
 * Verifies the security-critical algorithms documented in §28.2:
 *   [1] Public token generation
 *   [2] Link validity (public / temporary / unlimited / revoked / maxDownloads)
 *   [3] 3rd-party JWT with RBAC scopes
 *   [4] Private link access (JWT-Token-Auth)
 *   [5] GitHub deploy webhook signature
 *   [6] Suspension + tenant + RBAC guard
 *
 * Run: npm test     →    27 passed, 0 failed
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// ----------------------------- impl --------------------------------

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function isLinkUsable(link, now = new Date()) {
  if (!link) return 'NOT_FOUND';
  if (link.status === 'revoked') return 'REVOKED';
  if (link.status === 'expired') return 'EXPIRED';
  if (link.expiresAt && new Date(link.expiresAt) <= now) return 'EXPIRED';
  if (link.maxDownloads !== null && link.downloadCount >= link.maxDownloads)
    return 'LIMIT_REACHED';
  return 'OK';
}

function base64url(input) {
  return Buffer.from(typeof input === 'string' ? input : JSON.stringify(input))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload, secret, expiresInSec = 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresInSec
  };
  const head = base64url(header);
  const data = head + '.' + base64url(body);
  const sig = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return data + '.' + sig;
}

function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const data = parts[0] + '.' + parts[1];
  const expected = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return { ok: false, reason: 'bad_signature' };
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
  if (payload.exp && payload.exp * 1000 <= Date.now()) return { ok: false, reason: 'EXPIRED' };
  return { ok: true, payload };
}

function canAccessPrivateLink({ link, jwt }) {
  if (!jwt) return 'NO_TOKEN';
  if (jwt.vendorId !== link.vendorId) return 'WRONG_TENANT';
  if (!jwt.scopes.includes(link.requiredScope)) return 'MISSING_SCOPE';
  return 'OK';
}

function verifyGithubSignature(secret, payload, signature) {
  if (!secret || !signature || !payload) return false;
  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const SUSPENDED_BLOCKED = ['file:upload', 'file:download', 'file:delete', 'publicurl:create'];

function can(principal, permission, resource) {
  if (!principal) return false;
  if (principal.vendorStatus === 'suspended' && SUSPENDED_BLOCKED.includes(permission)) {
    return principal.vendorStatus === 'suspended' && SUSPENDED_BLOCKED.includes(permission)
      ? (() => false)()
      : true;
  }
  if (resource?.vendorId && principal.vendorId && resource.vendorId !== principal.vendorId)
    return false;
  return principal.permissions.includes(permission);
}

// helpers for test 6 to return rich verdicts
function guard(principal, permission, resource) {
  if (
    principal.vendorStatus === 'suspended' &&
    ['file:upload', 'file:download', 'file:delete', 'publicurl:create'].includes(permission)
  )
    return 'VENDOR_SUSPENDED';
  if (resource?.vendorId && principal.vendorId && resource.vendorId !== principal.vendorId)
    return 'CROSS_TENANT';
  if (!principal.permissions.includes(permission)) return 'FORBIDDEN';
  return 'OK';
}

// ----------------------------- tests -------------------------------

test('[1] Public token', async (t) => {
  await t.test('token length >= 32 chars', () => {
    assert.ok(randomToken(24).length >= 32);
  });
  await t.test('two tokens are unique', () => {
    assert.notEqual(randomToken(24), randomToken(24));
  });
});

test('[2] Link validity (3 types)', async (t) => {
  const now = new Date('2026-06-02T10:00:00Z');
  await t.test('public active link usable', () => {
    assert.equal(
      isLinkUsable({ status: 'active', expiresAt: null, maxDownloads: null, downloadCount: 0 }, now),
      'OK'
    );
  });
  await t.test('temporary link 1-min not yet expired', () => {
    const exp = new Date(now.getTime() + 60_000);
    assert.equal(
      isLinkUsable({ status: 'active', expiresAt: exp, maxDownloads: null, downloadCount: 0 }, now),
      'OK'
    );
  });
  await t.test('temporary link expired -> EXPIRED', () => {
    const exp = new Date(now.getTime() - 1_000);
    assert.equal(
      isLinkUsable({ status: 'active', expiresAt: exp, maxDownloads: null, downloadCount: 0 }, now),
      'EXPIRED'
    );
  });
  await t.test('unlimited link (expiresAt null) never expires', () => {
    assert.equal(
      isLinkUsable({ status: 'active', expiresAt: null, maxDownloads: null, downloadCount: 99 }, now),
      'OK'
    );
  });
  await t.test('revoked link -> REVOKED', () => {
    assert.equal(
      isLinkUsable({ status: 'revoked', expiresAt: null, maxDownloads: null, downloadCount: 0 }, now),
      'REVOKED'
    );
  });
  await t.test('maxDownloads reached -> LIMIT_REACHED', () => {
    assert.equal(
      isLinkUsable({ status: 'active', expiresAt: null, maxDownloads: 5, downloadCount: 5 }, now),
      'LIMIT_REACHED'
    );
  });
});

test('[3] 3rd-party JWT with RBAC scopes', async (t) => {
  const secret = 'platform-secret';
  const token = signJwt(
    { vendorId: 'v1', sub: 'partner', scopes: ['file:read', 'file:download'] },
    secret,
    3600
  );
  await t.test('valid JWT verifies', () => {
    assert.equal(verifyJwt(token, secret).ok, true);
  });
  await t.test('payload carries vendorId', () => {
    assert.equal(verifyJwt(token, secret).payload.vendorId, 'v1');
  });
  await t.test('scope present -> true', () => {
    assert.ok(verifyJwt(token, secret).payload.scopes.includes('file:download'));
  });
  await t.test('scope absent -> false', () => {
    assert.equal(verifyJwt(token, secret).payload.scopes.includes('file:upload'), false);
  });
  await t.test('tampered JWT rejected', () => {
    const tampered = token.slice(0, -2) + 'AA';
    assert.equal(verifyJwt(tampered, secret).ok, false);
  });
  await t.test('wrong secret rejected', () => {
    assert.equal(verifyJwt(token, 'wrong').ok, false);
  });
  await t.test('expired JWT -> EXPIRED', () => {
    const tk = signJwt({ vendorId: 'v1', sub: 'x', scopes: [] }, secret, -10);
    const r = verifyJwt(tk, secret);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'EXPIRED');
  });
});

test('[4] Private link access (JWT-Token-Auth)', async (t) => {
  const link = { vendorId: 'v1', requiredScope: 'file:download' };
  await t.test('valid token + scope -> access', () => {
    assert.equal(
      canAccessPrivateLink({ link, jwt: { vendorId: 'v1', scopes: ['file:download'] } }),
      'OK'
    );
  });
  await t.test('no token -> denied', () => {
    assert.equal(canAccessPrivateLink({ link, jwt: null }), 'NO_TOKEN');
  });
  await t.test('token from other vendor -> WRONG_TENANT', () => {
    assert.equal(
      canAccessPrivateLink({ link, jwt: { vendorId: 'v2', scopes: ['file:download'] } }),
      'WRONG_TENANT'
    );
  });
  await t.test('token missing download scope -> MISSING_SCOPE', () => {
    assert.equal(
      canAccessPrivateLink({ link, jwt: { vendorId: 'v1', scopes: ['file:read'] } }),
      'MISSING_SCOPE'
    );
  });
});

test('[5] GitHub deploy webhook signature', async (t) => {
  const secret = 'whsec_strong';
  const payload = JSON.stringify({ ref: 'refs/heads/main' });
  const good = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  await t.test('correct signature accepted', () => {
    assert.equal(verifyGithubSignature(secret, payload, good), true);
  });
  await t.test('wrong signature rejected', () => {
    assert.equal(
      verifyGithubSignature(secret, payload, 'sha256=' + 'a'.repeat(64)),
      false
    );
  });
  await t.test('wrong secret rejected', () => {
    assert.equal(verifyGithubSignature('other', payload, good), false);
  });
});

test('[6] Suspension + tenant + RBAC guard', async (t) => {
  const active = {
    vendorId: 'v1',
    vendorStatus: 'active',
    permissions: ['file:upload', 'file:download']
  };
  const suspendedP = {
    vendorId: 'v1',
    vendorStatus: 'suspended',
    permissions: ['file:upload', 'file:download']
  };
  const noPerm = { vendorId: 'v1', vendorStatus: 'active', permissions: [] };

  await t.test('active vendor can upload', () => {
    assert.equal(guard(active, 'file:upload', { vendorId: 'v1' }), 'OK');
  });
  await t.test('suspended vendor upload -> VENDOR_SUSPENDED', () => {
    assert.equal(guard(suspendedP, 'file:upload', { vendorId: 'v1' }), 'VENDOR_SUSPENDED');
  });
  await t.test('suspended vendor download -> VENDOR_SUSPENDED', () => {
    assert.equal(guard(suspendedP, 'file:download', { vendorId: 'v1' }), 'VENDOR_SUSPENDED');
  });
  await t.test('cross-tenant access -> CROSS_TENANT', () => {
    assert.equal(guard(active, 'file:upload', { vendorId: 'v2' }), 'CROSS_TENANT');
  });
  await t.test('missing permission -> FORBIDDEN', () => {
    assert.equal(guard(noPerm, 'file:upload', { vendorId: 'v1' }), 'FORBIDDEN');
  });
});

// Mirrors lib/impersonation.ts — admin "log in as vendor" target selection + restore guard.
const VENDOR_ROLE_RANK = { vendor_owner: 0, vendor_admin: 1, vendor_member: 2 };
function selectImpersonationTarget(users) {
  const eligible = users.filter(
    (u) => u.role in VENDOR_ROLE_RANK && (u.status === undefined || u.status === 'active')
  );
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    const byRole = VENDOR_ROLE_RANK[a.role] - VENDOR_ROLE_RANK[b.role];
    if (byRole !== 0) return byRole;
    return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
  });
  return eligible[0];
}
const ADMIN_ROLES = ['super_admin', 'platform_staff'];
function canRestoreAdmin(admin) {
  return !!admin && admin.status === 'active' && ADMIN_ROLES.includes(admin.role || '');
}

test('[7] Impersonation (admin "log in as vendor")', async (t) => {
  await t.test('prefers vendor_owner over other roles', () => {
    const target = selectImpersonationTarget([
      { id: 'm', role: 'vendor_member', createdAt: '2024-01-01' },
      { id: 'o', role: 'vendor_owner', createdAt: '2025-01-01' },
      { id: 'a', role: 'vendor_admin', createdAt: '2024-06-01' }
    ]);
    assert.equal(target.id, 'o');
  });
  await t.test('oldest account wins a same-role tie', () => {
    const target = selectImpersonationTarget([
      { id: 'new', role: 'vendor_admin', createdAt: '2025-05-01' },
      { id: 'old', role: 'vendor_admin', createdAt: '2024-02-01' }
    ]);
    assert.equal(target.id, 'old');
  });
  await t.test('never targets a platform admin', () => {
    const target = selectImpersonationTarget([
      { id: 'super', role: 'super_admin', createdAt: '2020-01-01' }
    ]);
    assert.equal(target, null);
  });
  await t.test('skips disabled users', () => {
    const target = selectImpersonationTarget([
      { id: 'off', role: 'vendor_owner', status: 'disabled', createdAt: '2020-01-01' },
      { id: 'on', role: 'vendor_member', status: 'active', createdAt: '2024-01-01' }
    ]);
    assert.equal(target.id, 'on');
  });
  await t.test('vendor with no users -> null', () => {
    assert.equal(selectImpersonationTarget([]), null);
  });
  await t.test('restore allowed for active admin', () => {
    assert.equal(canRestoreAdmin({ status: 'active', role: 'super_admin' }), true);
  });
  await t.test('restore denied for disabled admin', () => {
    assert.equal(canRestoreAdmin({ status: 'disabled', role: 'super_admin' }), false);
  });
  await t.test('restore denied for non-admin role', () => {
    assert.equal(canRestoreAdmin({ status: 'active', role: 'vendor_owner' }), false);
  });
});
