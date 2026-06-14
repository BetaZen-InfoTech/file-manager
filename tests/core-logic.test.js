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

// -------------------- [8] Vendor file-manager jail --------------------
// Mirrors lib/server-fs.ts resolveInJail/toRel/jailParent. The promise: a
// vendor can fully use their own folder but can NEVER reach the parent, the
// server root, or another vendor's files.
const path = require('node:path');

function resolveInJail(home, rel) {
  if (rel == null || rel.includes('\0')) return null;
  const r = rel.startsWith('/') ? rel : `/${rel}`;
  const abs = path.resolve(home, '.' + r);
  if (abs !== home && !abs.startsWith(home + path.sep)) return null;
  return abs;
}
function toRel(home, abs) {
  if (abs === home) return '/';
  return '/' + path.relative(home, abs).split(path.sep).join('/');
}
function jailParent(home, abs) {
  if (abs === home) return '/';
  return toRel(home, path.dirname(abs));
}

test('[8] Vendor file-manager jail', async (t) => {
  // Use a POSIX-style home; path.posix keeps the assertions stable cross-OS.
  const p = path.posix;
  const _resolveInJail = (home, rel) => {
    if (rel == null || rel.includes('\0')) return null;
    const r = rel.startsWith('/') ? rel : `/${rel}`;
    const abs = p.resolve(home, '.' + r);
    if (abs !== home && !abs.startsWith(home + p.sep)) return null;
    return abs;
  };
  const _toRel = (home, abs) => (abs === home ? '/' : '/' + p.relative(home, abs));
  const _jailParent = (home, abs) => (abs === home ? '/' : _toRel(home, p.dirname(abs)));
  const HOME = '/var/www/vendors/vendorA';

  await t.test('root resolves to home', () => {
    assert.equal(_resolveInJail(HOME, '/'), HOME);
    assert.equal(_toRel(HOME, HOME), '/');
  });
  await t.test('normal subpaths stay inside', () => {
    assert.equal(_resolveInJail(HOME, '/docs'), HOME + '/docs');
    assert.equal(_resolveInJail(HOME, 'docs/report.txt'), HOME + '/docs/report.txt');
    assert.equal(_toRel(HOME, HOME + '/docs/report.txt'), '/docs/report.txt');
  });
  await t.test('parent escape (..) is blocked', () => {
    assert.equal(_resolveInJail(HOME, '/..'), null);
    assert.equal(_resolveInJail(HOME, '../'), null);
    assert.equal(_resolveInJail(HOME, '/docs/../../secret'), null);
    assert.equal(_resolveInJail(HOME, '/../vendorB'), null); // another vendor
  });
  await t.test('absolute server paths are clamped, not honored', () => {
    // A client-sent absolute path is treated relative to home, never as real /.
    assert.equal(_resolveInJail(HOME, '/etc/passwd'), HOME + '/etc/passwd');
    assert.equal(_resolveInJail(HOME, '/var/www/vendors/vendorB'), HOME + '/var/www/vendors/vendorB');
  });
  await t.test('null byte is rejected', () => {
    assert.equal(_resolveInJail(HOME, '/docs/\0evil'), null);
  });
  await t.test('parent of home never goes above root', () => {
    assert.equal(_jailParent(HOME, HOME), '/'); // Up at home stays home
    assert.equal(_jailParent(HOME, HOME + '/docs'), '/');
    assert.equal(_jailParent(HOME, HOME + '/docs/sub'), '/docs');
  });
  // sanity: the real (path.sep-aware) helpers agree on the happy path
  await t.test('exported-style helpers agree on subpaths', () => {
    const home = path.resolve('/srv/vendors/v1');
    const abs = resolveInJail(home, '/a/b');
    assert.ok(abs && abs.endsWith(path.join('a', 'b')));
    assert.equal(toRel(home, home), '/');
    assert.equal(jailParent(home, home), '/');
  });
});

// -------------------- [9] Audit-remediation invariants --------------------
// Mirrors the security fixes: API-key bucket-scope fail-closed (rbac.can),
// safe search regex (lib/search), temporary-link guard, folder-path cascade.
test('[9] Audit-remediation invariants', async (t) => {
  // --- API-key bucket scoping: fail closed for bucket-scoped perms ---
  const isBucketScoped = (perm) => /^(bucket|file|folder|publicurl):/.test(perm);
  function bucketScopeAllows(bucketIds, perm, resourceBucketId) {
    if (bucketIds && bucketIds.length > 0 && isBucketScoped(perm)) {
      if (!resourceBucketId) return false; // fail closed
      if (!bucketIds.includes(resourceBucketId)) return false;
    }
    return true;
  }
  await t.test('scoped key without bucketId is denied (fail closed)', () => {
    assert.equal(bucketScopeAllows(['A'], 'file:download', undefined), false);
  });
  await t.test('scoped key with in-scope bucketId is allowed', () => {
    assert.equal(bucketScopeAllows(['A'], 'file:download', 'A'), true);
  });
  await t.test('scoped key with out-of-scope bucketId is denied', () => {
    assert.equal(bucketScopeAllows(['A'], 'file:download', 'B'), false);
  });
  await t.test('unscoped key/session is unaffected', () => {
    assert.equal(bucketScopeAllows([], 'file:download', undefined), true);
    assert.equal(bucketScopeAllows(undefined, 'file:download', undefined), true);
  });
  await t.test('non-bucket-scoped permission ignores bucket scope', () => {
    assert.equal(bucketScopeAllows(['A'], 'apikey:create', undefined), true);
  });

  // --- Safe search regex: metacharacters escaped, length capped ---
  function safeSearchRegExp(input, maxLen = 100) {
    const s = (input || '').slice(0, maxLen).trim();
    if (!s) return null;
    const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, 'i');
  }
  await t.test('regex metacharacters are escaped (no ReDoS / injection)', () => {
    const re = safeSearchRegExp('(a+)+$');
    // Matches the literal string, NOT as a catastrophic pattern.
    assert.equal(re.test('(a+)+$'), true);
    assert.equal(re.test('aaaaaa'), false);
    assert.equal(safeSearchRegExp('.*').test('anything'), false); // '.*' is literal now
    assert.equal(safeSearchRegExp(''), null);
    assert.equal(safeSearchRegExp('   '), null);
  });
  await t.test('overlong input is capped', () => {
    const re = safeSearchRegExp('a'.repeat(500));
    assert.ok(re.source.length <= 120);
  });

  // --- Temporary link must carry a finite explicit lifetime ---
  const tempLinkValid = (type, expiresIn, neverExpire) =>
    !(type === 'temporary' && (neverExpire || !expiresIn));
  await t.test('temporary link rejects missing expiresIn and neverExpire', () => {
    assert.equal(tempLinkValid('temporary', undefined, false), false);
    assert.equal(tempLinkValid('temporary', 3600, true), false);
    assert.equal(tempLinkValid('temporary', 300, false), true);
    assert.equal(tempLinkValid('public', undefined, true), true); // public may be permanent
  });

  // --- Folder move/rename cascades path to descendants ---
  const fullPath = (f) => (f.path === '/' ? `/${f.name}` : `${f.path}/${f.name}`);
  function cascade(folders, movedId, oldFull, newFull) {
    return folders.map((d) => {
      if (d.id === movedId) return d;
      if (d.path === oldFull || d.path.startsWith(oldFull + '/'))
        return { ...d, path: newFull + d.path.slice(oldFull.length) };
      return d;
    });
  }
  await t.test('descendant paths are rewritten on move', () => {
    // A(/) > B(/A) > C(/A/B). Move B to root D(/), so B.path '/D', cascade C.
    const folders = [
      { id: 'C', name: 'C', path: '/A/B' },
      { id: 'B', name: 'B', path: '/D' } // already moved
    ];
    const out = cascade(folders, 'B', '/A/B', '/D/B');
    assert.equal(out.find((f) => f.id === 'C').path, '/D/B');
    assert.equal(fullPath(out.find((f) => f.id === 'C')), '/D/B/C');
  });
});

// -------------------- [10] Vendor username derivation --------------------
// Mirrors lib/username.ts — auto username from a vendor name (only a-z0-9_) +
// collision handling. Names the vendor's private server folder.
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');
function usernameFromName(name) {
  const base = (name || '')
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || 'vendor';
}
function disambiguateUsername(base, taken) {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

test('[10] Vendor username (auto from name, only a-z0-9_)', async (t) => {
  await t.test('spaces & case -> lowercase underscores', () => {
    assert.equal(usernameFromName('BetaZen InfoTech'), 'betazen_infotech');
  });
  await t.test('punctuation collapses to a single underscore', () => {
    assert.equal(usernameFromName('Hello---World!!!'), 'hello_world');
  });
  await t.test('leading/trailing separators are trimmed', () => {
    assert.equal(usernameFromName('  __Acme.. '), 'acme');
  });
  await t.test('digits are preserved', () => {
    assert.equal(usernameFromName('Cloud 9 Media'), 'cloud_9_media');
  });
  await t.test('accents fold to ascii', () => {
    assert.equal(usernameFromName('Café Déjà'), 'cafe_deja');
  });
  await t.test('output only ever contains a-z0-9_', () => {
    for (const s of ['ABC!@#', 'naïve—dash', '9 lives', '   ', '...']) {
      assert.ok(/^[a-z0-9_]+$/.test(usernameFromName(s)), `bad chars in "${usernameFromName(s)}"`);
    }
  });
  await t.test('empty / all-symbol name falls back to "vendor"', () => {
    assert.equal(usernameFromName('***'), 'vendor');
    assert.equal(usernameFromName(''), 'vendor');
  });
  await t.test('unique base returned unchanged', () => {
    assert.equal(disambiguateUsername('acme', ['other']), 'acme');
  });
  await t.test('collision appends _2, then _3', () => {
    assert.equal(disambiguateUsername('acme', ['acme']), 'acme_2');
    assert.equal(disambiguateUsername('acme', ['acme', 'acme_2']), 'acme_3');
  });
});

// ----------------------------------------------------------------------------
// File-manager features: trash, hide/unhide, root-guard, zip-slip boundary.
// Dependency-free mirrors of the security-critical logic in lib/fs-ops.ts and
// lib/fs-trash.ts (§ admin/vendor File Manager).
// ----------------------------------------------------------------------------
const nodePath = require('node:path');

// Path-based actions that must never target the resolver root (FS root / home).
const ROOT_PROTECTED = new Set([
  'delete', 'trash', 'rename', 'copy', 'chmod', 'hide', 'unhide', 'write', 'newfile', 'mkdir', 'zip', 'extract'
]);
function rootGuardBlocks(action, target, rootAbs) {
  return !!(rootAbs && target === rootAbs && ROOT_PROTECTED.has(action));
}

// Trash ids are bare tokens; reject slashes / traversal / junk.
function validTrashId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id) && nodePath.basename(id) === id;
}

// hide/unhide leading-dot derivation (posix basename space).
function deriveName(action, base) {
  return action === 'hide' ? (base.startsWith('.') ? base : `.${base}`) : base.replace(/^\.+/, '');
}

// A zip entry destination is safe only if it stays strictly inside dest.
function zipEntrySafe(absEntry, dest) {
  if (!absEntry) return false;
  return absEntry === dest || absEntry.startsWith(dest + '/');
}
// Entry names with .. segments or NUL are rejected outright.
function zipEntryNameOk(raw) {
  return !!raw && !raw.includes('\0') && !raw.split(/[\/]/).includes('..');
}

// Schema rule: every action except the trash-management ones needs a path.
function pathRequired(action) {
  return !new Set(['restore', 'trash-purge', 'trash-empty']).has(action);
}

test('File Manager — root guard', async (t) => {
  await t.test('blocks delete/trash/rename/zip on the root itself', () => {
    for (const a of ['delete', 'trash', 'rename', 'zip', 'extract', 'chmod']) {
      assert.equal(rootGuardBlocks(a, '/home/v', '/home/v'), true, a);
    }
  });
  await t.test('allows ops on a child of the root', () => {
    assert.equal(rootGuardBlocks('delete', '/home/v/file.txt', '/home/v'), false);
  });
  await t.test('non-destructive actions are not root-guarded', () => {
    assert.equal(rootGuardBlocks('list', '/home/v', '/home/v'), false);
  });
});

test('File Manager — trash id validation', async (t) => {
  await t.test('accepts well-formed ids', () => {
    assert.equal(validTrashId('1749999999999-ab3k9z'), true);
  });
  await t.test('rejects traversal / slashes / suffix injection', () => {
    assert.equal(validTrashId('../etc/passwd'), false);
    assert.equal(validTrashId('a/b'), false);
    assert.equal(validTrashId('id.meta.json'), false);
    assert.equal(validTrashId(''), false);
  });
});

test('File Manager — hide/unhide name derivation', async (t) => {
  await t.test('hide prefixes a dot once', () => {
    assert.equal(deriveName('hide', 'file.txt'), '.file.txt');
    assert.equal(deriveName('hide', '.file.txt'), '.file.txt');
  });
  await t.test('unhide strips leading dots', () => {
    assert.equal(deriveName('unhide', '.file.txt'), 'file.txt');
    assert.equal(deriveName('unhide', 'file.txt'), 'file.txt');
  });
});

test('File Manager — zip-slip boundary', async (t) => {
  const dest = '/var/www/vendors/acme';
  await t.test('allows entries inside dest', () => {
    assert.equal(zipEntrySafe('/var/www/vendors/acme/a/b.txt', dest), true);
    assert.equal(zipEntrySafe(dest, dest), true);
  });
  await t.test('blocks the sibling-prefix bypass (acme-evil)', () => {
    // The classic unzipper prefix-check bypass that this boundary test closes.
    assert.equal(zipEntrySafe('/var/www/vendors/acme-evil/x', dest), false);
  });
  await t.test('rejects .. and NUL entry names', () => {
    assert.equal(zipEntryNameOk('../sibling/x'), false);
    assert.equal(zipEntryNameOk('a/../../x'), false);
    assert.equal(zipEntryNameOk('ok/path.txt'), true);
  });
});

test('File Manager — schema path requirement', async (t) => {
  await t.test('path required for path-based actions', () => {
    for (const a of ['delete', 'trash', 'mkdir', 'rename', 'zip', 'hide']) assert.equal(pathRequired(a), true, a);
  });
  await t.test('path NOT required for trash-management actions', () => {
    for (const a of ['restore', 'trash-purge', 'trash-empty']) assert.equal(pathRequired(a), false, a);
  });
});

// ----------------------------------------------------------------------------
// Realtime events feed (lib/events.ts + GET /v1/events): tenant + bucket
// scoping, SSE framing, cursor validation. Dependency-free mirrors.
// ----------------------------------------------------------------------------
function canSeeEvent(p, e) {
  if (!p.vendorId || e.vendorId !== p.vendorId) return false;
  if (p.bucketIds && p.bucketIds.length > 0) return !!e.bucketId && p.bucketIds.includes(e.bucketId);
  return true;
}
function sseFrame(e) {
  return `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
}
const isEventCursor = (s) => /^[a-f0-9]{24}$/i.test(s);

test('Realtime — event visibility (tenant + bucket scoping)', async (t) => {
  const evtA = { id: '1', type: 'file.upload', vendorId: 'V1', bucketId: 'B1' };
  const evtNoBucket = { id: '2', type: 'link.create', vendorId: 'V1', bucketId: null };
  await t.test('unscoped key sees own vendor events', () => {
    assert.equal(canSeeEvent({ vendorId: 'V1' }, evtA), true);
    assert.equal(canSeeEvent({ vendorId: 'V1' }, evtNoBucket), true);
  });
  await t.test('never sees another vendor', () => {
    assert.equal(canSeeEvent({ vendorId: 'V2' }, evtA), false);
    assert.equal(canSeeEvent({ vendorId: null }, evtA), false);
  });
  await t.test('bucket-scoped key sees only its bucket', () => {
    assert.equal(canSeeEvent({ vendorId: 'V1', bucketIds: ['B1'] }, evtA), true);
    assert.equal(canSeeEvent({ vendorId: 'V1', bucketIds: ['B9'] }, evtA), false);
  });
  await t.test('bucket-scoped key withholds events with unknown bucket (fail closed)', () => {
    assert.equal(canSeeEvent({ vendorId: 'V1', bucketIds: ['B1'] }, evtNoBucket), false);
  });
});

test('Realtime — SSE frame + cursor', async (t) => {
  await t.test('frames as id/event/data terminated by blank line', () => {
    const e = { id: 'abc', type: 'file.delete', vendorId: 'V1' };
    const f = sseFrame(e);
    assert.equal(f, 'id: abc\nevent: file.delete\ndata: {"id":"abc","type":"file.delete","vendorId":"V1"}\n\n');
    // the data line round-trips to the original event
    const dataLine = f.split('\n').find((l) => l.startsWith('data: ')).slice(6);
    assert.deepEqual(JSON.parse(dataLine), e);
  });
  await t.test('cursor must be a 24-hex ObjectId', () => {
    assert.equal(isEventCursor('64b7f9e2a1c3d4e5f6a7b8c9'), true);
    assert.equal(isEventCursor('not-an-id'), false);
    assert.equal(isEventCursor('../etc'), false);
  });
});
