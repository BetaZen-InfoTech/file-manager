import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { forbidden, jsonOk, notFound, unauthorized } from '@/lib/http';
import { audit } from '@/lib/audit';
import { ApiKey } from '@/models/ApiKey';

export const runtime = 'nodejs';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (!can(p, 'apikey:revoke', { vendorId: p.vendorId })) return forbidden();
  await dbConnect();
  const k = await ApiKey.findOneAndUpdate(
    { _id: params.id, vendorId: p.vendorId, status: 'active' },
    { $set: { status: 'revoked' } },
    { new: true }
  );
  if (!k) return notFound('api key not found');
  await audit(p, req, {
    action: 'apikey.revoke',
    resourceType: 'apikey',
    resourceId: String(k._id)
  });
  return jsonOk({ ok: true });
}
