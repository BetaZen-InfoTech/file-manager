import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import {
  badRequest,
  forbidden,
  jsonOk,
  notFound,
  safeParseJson,
  unauthorized
} from '@/lib/http';
import { audit } from '@/lib/audit';
import { Folder } from '@/models/Folder';
import { FileModel } from '@/models/File';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (!can(p, 'folder:update', { vendorId: p.vendorId })) return forbidden();
  const body = (await safeParseJson(req)) as { name?: string; parentId?: string | null } | null;
  if (!body) return badRequest('invalid body');
  await dbConnect();

  const folder = await Folder.findOne({ _id: params.id, vendorId: p.vendorId });
  if (!folder) return notFound('folder not found');

  if (typeof body.name === 'string' && body.name.trim()) folder.name = body.name.trim();

  // move: set parent + recompute this folder's path (must stay in same bucket,
  // can't be moved into itself).
  if (body.parentId !== undefined) {
    if (body.parentId) {
      if (String(body.parentId) === String(folder._id)) return badRequest("can't move into itself");
      const parent = await Folder.findOne({
        _id: body.parentId,
        vendorId: p.vendorId,
        bucketId: folder.bucketId
      }).lean();
      if (!parent) return badRequest('target folder not found in this bucket');
      folder.parentId = parent._id as any;
      folder.path = parent.path === '/' ? `/${parent.name}` : `${parent.path}/${parent.name}`;
    } else {
      folder.parentId = null as any;
      folder.path = '/';
    }
  }

  await folder.save();
  await audit(p, req, { action: 'folder.update', resourceType: 'folder', resourceId: String(folder._id) });
  return jsonOk(folder);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (!can(p, 'folder:update', { vendorId: p.vendorId })) return forbidden();
  await dbConnect();
  const fileCount = await FileModel.countDocuments({
    folderId: params.id,
    vendorId: p.vendorId,
    status: { $ne: 'trashed' }
  });
  if (fileCount > 0) return badRequest('Folder is not empty');
  const folder = await Folder.findOneAndDelete({ _id: params.id, vendorId: p.vendorId });
  if (!folder) return notFound('folder not found');
  await audit(p, req, {
    action: 'folder.delete',
    resourceType: 'folder',
    resourceId: String(folder._id)
  });
  return jsonOk({ ok: true });
}
