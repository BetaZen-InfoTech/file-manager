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
  if (!body?.jti) return badRequest('jti required');
  await dbConnect();
  await JwtRevocation.updateOne(
    { jti: body.jti },
    {
      $setOnInsert: {
        vendorId: p.vendorId,
        jti: body.jti,
        subject: body.subject || '',
        revokedAt: new Date()
      }
    },
    { upsert: true }
  );
  await audit(p, req, { action: 'jwt.revoke', resourceType: 'jwt', resourceId: body.jti });
  return jsonOk({ ok: true });
}
