import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { forbidden, jsonOk, notFound, unauthorized } from '@/lib/http';
import { audit } from '@/lib/audit';
import { Folder } from '@/models/Folder';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (!can(p, 'folder:hide', { vendorId: p.vendorId })) return forbidden();
  await dbConnect();
  const folder = await Folder.findOneAndUpdate(
    { _id: params.id, vendorId: p.vendorId },
    { $set: { isHidden: false, hiddenBy: null, hiddenAt: null } },
    { new: true }
  );
  if (!folder) return notFound('folder not found');
  await audit(p, req, {
    action: 'folder.unhide',
    resourceType: 'folder',
    resourceId: String(folder._id)
  });
  return jsonOk(folder);
}
