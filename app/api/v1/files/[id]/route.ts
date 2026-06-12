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
import { updateFileSchema } from '@/lib/validation';
import { FileModel } from '@/models/File';
import { Folder } from '@/models/Folder';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  await dbConnect();
  const file = await FileModel.findOne({ _id: params.id, vendorId: p.vendorId }).lean();
  if (!file) return notFound('file not found');
  if (!can(p, 'file:read', { vendorId: p.vendorId, bucketId: String(file.bucketId) }))
    return forbidden();
  return jsonOk(file);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  const body = await safeParseJson(req);
  const parsed = updateFileSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input');
  await dbConnect();
  const current = await FileModel.findOne({ _id: params.id, vendorId: p.vendorId }).lean();
  if (!current) return notFound('file not found');
  // Mutating a file requires write capability (and respects API-key bucket scope).
  if (!can(p, 'file:upload', { vendorId: p.vendorId, bucketId: String(current.bucketId) }))
    return forbidden();

  const update: any = {};
  if (parsed.data.originalName) update.originalName = parsed.data.originalName;
  if (parsed.data.tags) update.tags = parsed.data.tags;
  if (parsed.data.metadata) update.metadata = parsed.data.metadata;

  // move: validate the target folder is in the same bucket (or root)
  if (parsed.data.folderId !== undefined) {
    if (parsed.data.folderId) {
      const target = await Folder.findOne({
        _id: parsed.data.folderId,
        vendorId: p.vendorId,
        bucketId: current.bucketId
      }).lean();
      if (!target) return badRequest('target folder not found in this bucket');
      update.folderId = parsed.data.folderId;
    } else {
      update.folderId = null;
    }
  }

  const file = await FileModel.findOneAndUpdate(
    { _id: params.id, vendorId: p.vendorId },
    { $set: update },
    { new: true }
  );
  if (!file) return notFound('file not found');
  await audit(p, req, {
    action: 'file.update',
    resourceType: 'file',
    resourceId: String(file._id),
    meta: update
  });
  return jsonOk(file);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  await dbConnect();
  const target = await FileModel.findOne({ _id: params.id, vendorId: p.vendorId }).lean();
  if (!target) return notFound('file not found');
  if (!can(p, 'file:delete', { vendorId: p.vendorId, bucketId: String(target.bucketId) })) return forbidden();
  const file = await FileModel.findOneAndUpdate(
    { _id: params.id, vendorId: p.vendorId, status: { $ne: 'trashed' } },
    { $set: { status: 'trashed', deletedAt: new Date() } },
    { new: true }
  );
  if (!file) return notFound('file not found');
  await audit(p, req, {
    action: 'file.delete',
    resourceType: 'file',
    resourceId: String(file._id)
  });
  return jsonOk({ ok: true });
}
