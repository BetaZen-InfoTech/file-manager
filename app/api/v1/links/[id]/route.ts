import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { forbidden, jsonOk, notFound, unauthorized } from '@/lib/http';
import { audit } from '@/lib/audit';
import { Link } from '@/models/Link';
import { FileModel } from '@/models/File';

export const runtime = 'nodejs';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  await dbConnect();
  const existing = await Link.findOne({ _id: params.id, vendorId: p.vendorId, status: 'active' }).lean();
  if (!existing) return notFound('link not found');
  const file = await FileModel.findOne({ _id: existing.fileId, vendorId: p.vendorId }).select('bucketId').lean();
  if (!can(p, 'publicurl:revoke', { vendorId: p.vendorId, bucketId: file ? String(file.bucketId) : undefined }))
    return forbidden();
  const link = await Link.findOneAndUpdate(
    { _id: params.id, vendorId: p.vendorId, status: 'active' },
    { $set: { status: 'revoked' } },
    { new: true }
  );
  if (!link) return notFound('link not found');
  await audit(p, req, {
    action: 'link.revoke',
    resourceType: 'link',
    resourceId: String(link._id)
  });
  return jsonOk({ ok: true });
}
