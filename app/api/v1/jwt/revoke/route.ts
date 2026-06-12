import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import {
  badRequest,
  forbidden,
  jsonOk,
  safeParseJson,
  unauthorized
} from '@/lib/http';
import { audit } from '@/lib/audit';
import { JwtRevocation } from '@/models/JwtRevocation';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (!can(p, 'apikey:revoke', { vendorId: p.vendorId })) return forbidden();
  const body = (await safeParseJson(req)) as { jti?: string; subject?: string } | null;
  if (!body?.jti || typeof body.jti !== 'string' || body.jti.length > 128) return badRequest('jti required');
  await dbConnect();
  // Tenant-scoped: a vendor can only create/refresh revocations under its own
  // vendorId. expiresAt is stamped past the maximum possible 3rd-party JWT
  // lifetime (1 year) so the TTL index can later auto-purge it.
  const expiresAt = new Date(Date.now() + 366 * 24 * 60 * 60 * 1000);
  try {
    await JwtRevocation.updateOne(
      { jti: body.jti, vendorId: p.vendorId },
      { $set: { subject: body.subject || '', revokedAt: new Date(), expiresAt } },
      { upsert: true }
    );
  } catch {
    // Unique jti already revoked (possibly by another tenant) — idempotent success.
  }
  await audit(p, req, { action: 'jwt.revoke', resourceType: 'jwt', resourceId: body.jti });
  return jsonOk({ ok: true });
}
