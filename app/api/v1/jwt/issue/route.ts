import { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import {
  badRequest,
  forbidden,
  jsonOk,
  safeParseJson,
  unauthorized
} from '@/lib/http';
import { issueJwtSchema } from '@/lib/validation';
import { issueThirdPartyJwt } from '@/lib/jwt';
import { audit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (!can(p, 'apikey:create', { vendorId: p.vendorId })) return forbidden();
  const body = await safeParseJson(req);
  const parsed = issueJwtSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });
  const { token, jti, expiresAt } = await issueThirdPartyJwt(
    {
      vendorId: p.vendorId,
      sub: parsed.data.subject,
      scopes: parsed.data.scopes,
      bucketIds: parsed.data.bucketIds
    },
    parsed.data.expiresIn
  );
  await audit(p, req, {
    action: 'jwt.issue',
    resourceType: 'jwt',
    resourceId: jti,
    meta: { subject: parsed.data.subject, scopes: parsed.data.scopes }
  });
  return jsonOk({ token, jti, expiresAt });
}
