import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { forbidden, jsonOk, notFound, unauthorized } from '@/lib/http';
import { audit } from '@/lib/audit';
import { FileModel } from '@/models/File';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (!can(p, 'folder:hide', { vendorId: p.vendorId })) return forbidden();
  await dbConnect();
  const f = await FileModel.findOneAndUpdate(
    { _id: params.id, vendorId: p.vendorId },
    { $set: { isHidden: true, hiddenBy: p.userId || null, hiddenAt: new Date() } },
    { new: true }
  );
  if (!f) return notFound('file not found');
  await audit(p, req, {
    action: 'file.hide',
    resourceType: 'file',
    resourceId: String(f._id)
  });
  return jsonOk(f);
}
