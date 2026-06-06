import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import {
  badRequest,
  forbidden,
  jsonOk,
  notFound,
  quotaExceeded,
  safeParseJson,
  unauthorized,
  suspended
} from '@/lib/http';
import { audit } from '@/lib/audit';
import { storage, objectKey } from '@/lib/storage';
import { checkQuota } from '@/lib/quota';
import { env } from '@/lib/env';
import { FileModel } from '@/models/File';
import { Bucket } from '@/models/Bucket';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (p.vendorStatus === 'suspended') return suspended();
  const body = (await safeParseJson(req)) as
    | { bucketId: string; folderId?: string; originalName: string; mimeType: string; sizeBytes: number }
    | null;
  if (!body?.bucketId || !body.originalName || !body.mimeType)
    return badRequest('bucketId, originalName, mimeType required');
  if (!can(p, 'file:upload', { vendorId: p.vendorId, bucketId: body.bucketId })) return forbidden();

  await dbConnect();
  const bucket = await Bucket.findOne({ _id: body.bucketId, vendorId: p.vendorId });
  if (!bucket) return notFound('bucket not found');

  // Enforce per-vendor quota + per-bucket policy at INIT time so a vendor over quota
  // can't even kick off the multipart session and waste storage on aborted parts.
  if (body.sizeBytes && body.sizeBytes > env.MAX_UPLOAD_BYTES) {
    return badRequest('size exceeds MAX_UPLOAD_BYTES');
  }
  if (
    bucket.settings.maxFileSizeBytes &&
    body.sizeBytes &&
    body.sizeBytes > bucket.settings.maxFileSizeBytes
  ) {
    return badRequest('size exceeds bucket maxFileSizeBytes');
  }
  if (
    bucket.settings.allowedMimeTypes &&
    bucket.settings.allowedMimeTypes.length > 0 &&
    !bucket.settings.allowedMimeTypes.includes(body.mimeType)
  ) {
    return badRequest('mime type not allowed by bucket policy');
  }
  if (body.sizeBytes) {
    const quota = await checkQuota(p.vendorId, body.sizeBytes);
    if (!quota.ok) return quotaExceeded();
  }

  await storage.ensureBucket();
  const fileIdObj = new mongoose.Types.ObjectId();
  const key = objectKey(p.vendorId, body.bucketId, String(fileIdObj), body.originalName);
  const uploadId = await storage.initMultipart(key, body.mimeType);
  const draft = await FileModel.create({
    _id: fileIdObj,
    vendorId: p.vendorId,
    bucketId: body.bucketId,
    folderId: body.folderId || null,
    originalName: body.originalName,
    storageKey: key,
    extension: body.originalName.split('.').pop() || '',
    mimeType: body.mimeType,
    sizeBytes: body.sizeBytes || 0,
    status: 'uploading',
    uploadedBy: p.userId || null,
    uploadSource: p.kind === 'apikey' ? 'api' : 'ui',
    apiKeyId: p.apiKeyId || null,
    metadata: { uploadId }
  });
  await audit(p, req, {
    action: 'file.multipart.init',
    resourceType: 'file',
    resourceId: String(draft._id)
  });
  return jsonOk({ uploadId, fileId: String(draft._id), key });
}
