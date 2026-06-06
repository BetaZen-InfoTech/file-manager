import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import {
  badRequest,
  forbidden,
  jsonOk,
  notFound,
  safeParseJson,
  unauthorized
} from '@/lib/http';
import { audit } from '@/lib/audit';
import { storage } from '@/lib/storage';
import { incrementUsage } from '@/lib/quota';
import { FileModel } from '@/models/File';
import { Bucket } from '@/models/Bucket';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { uploadId: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  const body = (await safeParseJson(req)) as {
    parts?: { PartNumber: number; ETag: string }[];
    sizeBytes?: number;
  } | null;
  if (!body?.parts || !Array.isArray(body.parts)) return badRequest('parts[] required');
  await dbConnect();
  const draft = await FileModel.findOne({
    vendorId: p.vendorId,
    status: 'uploading',
    'metadata.uploadId': params.uploadId
  });
  if (!draft) return notFound('upload not found');
  await storage.completeMultipart(draft.storageKey, params.uploadId, body.parts);
  const sizeBytes = body.sizeBytes ?? draft.sizeBytes;
  draft.status = 'ready';
  draft.sizeBytes = sizeBytes;
  await draft.save();
  await Promise.all([
    incrementUsage(p.vendorId, sizeBytes, 1),
    Bucket.updateOne(
      { _id: draft.bucketId },
      { $inc: { storageBytes: sizeBytes, fileCount: 1 } }
    )
  ]);
  await audit(p, req, {
    action: 'file.multipart.complete',
    resourceType: 'file',
    resourceId: String(draft._id)
  });
  return jsonOk({
    id: String(draft._id),
    originalName: draft.originalName,
    mimeType: draft.mimeType,
    sizeBytes: draft.sizeBytes,
    bucketId: String(draft.bucketId),
    status: draft.status,
    createdAt: draft.createdAt
  });
}
