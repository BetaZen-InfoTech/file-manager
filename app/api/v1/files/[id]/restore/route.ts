import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { forbidden, jsonOk, notFound, suspended, unauthorized } from '@/lib/http';
import { audit } from '@/lib/audit';
import { FileModel } from '@/models/File';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (p.vendorStatus === 'suspended') return suspended();
  await dbConnect();
  const trashed = await FileModel.findOne({ _id: params.id, vendorId: p.vendorId, status: 'trashed' }).lean();
  if (!trashed) return notFound('file not found or not in trash');
  if (!can(p, 'file:delete', { vendorId: p.vendorId, bucketId: String(trashed.bucketId) })) return forbidden();
  // No quota re-check needed: trashed files still count toward usage until purge
  // (recount-usage includes 'trashed'), so a restore doesn't add new bytes.
  const f = await FileModel.findOneAndUpdate(
    { _id: params.id, vendorId: p.vendorId, status: 'trashed' },
    { $set: { status: 'ready', deletedAt: null } },
    { new: true }
  );
  if (!f) return notFound('file not found or not in trash');
  await audit(p, req, {
    action: 'file.restore',
    resourceType: 'file',
    resourceId: String(f._id)
  });
  return jsonOk(f);
}
