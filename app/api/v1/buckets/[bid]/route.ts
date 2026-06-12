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
  suspended,
  unauthorized
} from '@/lib/http';
import { updateBucketSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { Bucket } from '@/models/Bucket';
import { FileModel } from '@/models/File';
import { Folder } from '@/models/Folder';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { bid: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  await dbConnect();
  const bucket = await Bucket.findOne({ _id: params.bid, vendorId: p.vendorId }).lean();
  if (!bucket) return notFound('bucket not found');
  if (!can(p, 'bucket:read', { vendorId: p.vendorId, bucketId: String(bucket._id) }))
    return forbidden();
  return jsonOk(bucket);
}

export async function PATCH(req: NextRequest, { params }: { params: { bid: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (p.vendorStatus === 'suspended') return suspended();
  if (!can(p, 'bucket:update', { vendorId: p.vendorId, bucketId: params.bid })) return forbidden();
  const body = await safeParseJson(req);
  const parsed = updateBucketSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input');
  await dbConnect();
  const update: any = {};
  if (parsed.data.name) update.name = parsed.data.name;
  if (parsed.data.description !== undefined) update.description = parsed.data.description;
  if (parsed.data.isPublic !== undefined) update.isPublic = parsed.data.isPublic;
  if (parsed.data.settings) {
    if (parsed.data.settings.allowedMimeTypes !== undefined)
      update['settings.allowedMimeTypes'] = parsed.data.settings.allowedMimeTypes;
    if (parsed.data.settings.maxFileSizeBytes !== undefined)
      update['settings.maxFileSizeBytes'] = parsed.data.settings.maxFileSizeBytes;
  }
  const bucket = await Bucket.findOneAndUpdate(
    { _id: params.bid, vendorId: p.vendorId },
    { $set: update },
    { new: true }
  );
  if (!bucket) return notFound('bucket not found');
  await audit(p, req, {
    action: 'bucket.update',
    resourceType: 'bucket',
    resourceId: String(bucket._id),
    meta: update
  });
  return jsonOk(bucket);
}

export async function DELETE(req: NextRequest, { params }: { params: { bid: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (p.vendorStatus === 'suspended') return suspended();
  if (!can(p, 'bucket:delete', { vendorId: p.vendorId, bucketId: params.bid })) return forbidden();
  await dbConnect();
  const fileCount = await FileModel.countDocuments({
    bucketId: params.bid,
    vendorId: p.vendorId,
    status: { $ne: 'trashed' }
  });
  if (fileCount > 0) return badRequest('Bucket is not empty');
  const bucket = await Bucket.findOneAndDelete({ _id: params.bid, vendorId: p.vendorId });
  if (!bucket) return notFound('bucket not found');
  await Folder.deleteMany({ bucketId: params.bid, vendorId: p.vendorId });
  await audit(p, req, {
    action: 'bucket.delete',
    resourceType: 'bucket',
    resourceId: String(bucket._id)
  });
  return jsonOk({ ok: true });
}
