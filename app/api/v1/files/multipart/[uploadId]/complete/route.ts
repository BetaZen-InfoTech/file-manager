import { NextRequest } from 'next/server';
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
  suspended,
  unauthorized
} from '@/lib/http';
import { audit } from '@/lib/audit';
import { storage } from '@/lib/storage';
import { checkQuota, incrementUsage } from '@/lib/quota';
import { multipartCompleteSchema } from '@/lib/validation';
import { env } from '@/lib/env';
import { FileModel } from '@/models/File';
import { Bucket } from '@/models/Bucket';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { uploadId: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (p.vendorStatus === 'suspended') return suspended();
  const parsed = multipartCompleteSchema.safeParse(await safeParseJson(req));
  if (!parsed.success) return badRequest('parts[] required', { issues: parsed.error.issues });

  await dbConnect();
  const draft = await FileModel.findOne({
    vendorId: p.vendorId,
    status: 'uploading',
    'metadata.uploadId': params.uploadId
  });
  if (!draft) return notFound('upload not found');
  if (!can(p, 'file:upload', { vendorId: p.vendorId, bucketId: String(draft.bucketId) })) return forbidden();

  // Finalize and read the AUTHORITATIVE stored size (never trust body.sizeBytes —
  // a client could under-report to bypass quota / per-file limits).
  const { size: sizeBytes } = await storage.completeMultipart(draft.storageKey, params.uploadId, parsed.data.parts);

  // Roll back (delete the finalized object + fail the draft) if the real size
  // violates a limit, so quota/billing can't be bypassed via the multipart path.
  const cleanup = async () => {
    await storage.deleteObject(draft.storageKey).catch(() => {});
    draft.status = 'failed';
    await draft.save();
  };
  if (sizeBytes > env.MAX_UPLOAD_BYTES) {
    await cleanup();
    return badRequest('file exceeds MAX_UPLOAD_BYTES');
  }
  const bucket = await Bucket.findById(draft.bucketId).lean();
  if (bucket?.settings?.maxFileSizeBytes && sizeBytes > bucket.settings.maxFileSizeBytes) {
    await cleanup();
    return badRequest('file exceeds bucket maxFileSizeBytes');
  }
  const quota = await checkQuota(p.vendorId, sizeBytes);
  if (!quota.ok) {
    await cleanup();
    return quotaExceeded();
  }

  draft.status = 'ready';
  draft.sizeBytes = sizeBytes;
  await draft.save();
  await Promise.all([
    incrementUsage(p.vendorId, sizeBytes, 1),
    Bucket.updateOne({ _id: draft.bucketId }, { $inc: { storageBytes: sizeBytes, fileCount: 1 } })
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
