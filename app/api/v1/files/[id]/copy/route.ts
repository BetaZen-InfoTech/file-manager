import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { badRequest, forbidden, jsonOk, notFound, quotaExceeded, safeParseJson, suspended, unauthorized } from '@/lib/http';
import { audit } from '@/lib/audit';
import { copyFileSchema } from '@/lib/validation';
import { checkQuota, incrementUsage } from '@/lib/quota';
import { FileModel } from '@/models/File';
import { Folder } from '@/models/Folder';
import { Bucket } from '@/models/Bucket';

export const runtime = 'nodejs';

// Copy a file. Reuses the SAME storage object (no byte re-copy) — like dedup —
// so it's instant and storage-cheap.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (p.vendorStatus === 'suspended') return suspended();

  const body = await safeParseJson(req);
  const parsed = copyFileSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input');

  await dbConnect();
  const src = await FileModel.findOne({ _id: params.id, vendorId: p.vendorId, status: 'ready' }).lean();
  if (!src) return notFound('file not found');
  if (!can(p, 'file:upload', { vendorId: p.vendorId, bucketId: String(src.bucketId) })) return forbidden();

  let folderId: any = src.folderId || null;
  if (parsed.data.folderId !== undefined) {
    if (parsed.data.folderId) {
      const target = await Folder.findOne({ _id: parsed.data.folderId, vendorId: p.vendorId, bucketId: src.bucketId }).lean();
      if (!target) return badRequest('target folder not found in this bucket');
      folderId = target._id;
    } else folderId = null;
  }

  const quota = await checkQuota(p.vendorId, src.sizeBytes);
  if (!quota.ok) return quotaExceeded();

  const name = (parsed.data.name || `Copy of ${src.originalName}`).slice(0, 255);
  const copy = await FileModel.create({
    vendorId: p.vendorId,
    bucketId: src.bucketId,
    folderId,
    originalName: name,
    storageKey: src.storageKey, // shared object (dedup)
    extension: src.extension,
    mimeType: src.mimeType,
    sizeBytes: src.sizeBytes,
    checksum: src.checksum,
    width: src.width,
    height: src.height,
    thumbnails: src.thumbnails,
    tags: src.tags,
    metadata: { ...(src.metadata || {}), copiedFrom: String(src._id) },
    status: 'ready',
    uploadedBy: p.userId || null,
    uploadSource: 'ui'
  });

  await Promise.all([
    incrementUsage(p.vendorId, src.sizeBytes, 1),
    Bucket.updateOne({ _id: src.bucketId }, { $inc: { storageBytes: src.sizeBytes, fileCount: 1 } })
  ]);

  await audit(p, req, { action: 'file.copy', resourceType: 'file', resourceId: String(copy._id), meta: { from: String(src._id) } });
  return jsonOk({ id: String(copy._id), originalName: copy.originalName }, 201);
}
