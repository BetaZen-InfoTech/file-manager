import { NextRequest } from 'next/server';
import mime from 'mime-types';
import fsp from 'fs/promises';
import nodePath from 'path';
import { dbConnect } from '@/lib/db';
import { vendorHome, resolveInJail, vendorFolderKey } from '@/lib/server-fs';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import {
  badRequest,
  forbidden,
  jsonOk,
  notFound,
  quotaExceeded,
  unauthorized,
  suspended
} from '@/lib/http';
import { audit } from '@/lib/audit';
import { storage, objectKey } from '@/lib/storage';
import { checkQuota, incrementUsage } from '@/lib/quota';
import { safeSearchRegExp } from '@/lib/search';
import { md5, sha256 } from '@/lib/crypto';
import { env } from '@/lib/env';
import { fireVendorWebhook } from '@/lib/webhook';
import { extractImageMeta, generateThumbnails } from '@/lib/image';
import { sendMail, MailTemplates } from '@/lib/mail';
import { Bucket } from '@/models/Bucket';
import { FileModel } from '@/models/File';
import { Vendor } from '@/models/Vendor';
import mongoose from 'mongoose';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest, { params }: { params: { bid: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (!can(p, 'file:list', { vendorId: p.vendorId, bucketId: params.bid })) return forbidden();
  await dbConnect();
  const url = new URL(req.url);
  const folderId = url.searchParams.get('folderId') || null;
  const showHidden = url.searchParams.get('showHidden') === 'true';
  const q = (url.searchParams.get('q') || '').slice(0, 100);
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));

  const filter: any = {
    vendorId: p.vendorId,
    bucketId: params.bid,
    folderId,
    status: 'ready'
  };
  if (!showHidden) filter.isHidden = { $ne: true };
  const qre = safeSearchRegExp(q);
  if (qre) filter.$or = [{ originalName: qre }, { tags: q }];

  const [items, total] = await Promise.all([
    FileModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    FileModel.countDocuments(filter)
  ]);
  return jsonOk({ items, total, page, limit });
}

export async function POST(req: NextRequest, { params }: { params: { bid: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (p.vendorStatus === 'suspended') return suspended();
  if (!can(p, 'file:upload', { vendorId: p.vendorId, bucketId: params.bid })) return forbidden();

  const contentType = req.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data'))
    return badRequest('multipart/form-data required');

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest('Invalid multipart body');
  }
  const file = form.get('file');
  if (!(file instanceof Blob)) return badRequest('file field required');

  const originalName = (file as any).name || 'untitled';
  const size = file.size;
  if (size > env.MAX_UPLOAD_BYTES) return badRequest('file exceeds MAX_UPLOAD_BYTES');

  await dbConnect();
  const bucket = await Bucket.findOne({ _id: params.bid, vendorId: p.vendorId });
  if (!bucket) return notFound('bucket not found');

  if (
    bucket.settings.maxFileSizeBytes &&
    size > bucket.settings.maxFileSizeBytes
  ) {
    return badRequest('file exceeds bucket maxFileSizeBytes');
  }

  const detectedMime =
    file.type ||
    mime.lookup(originalName) ||
    'application/octet-stream';
  if (
    bucket.settings.allowedMimeTypes &&
    bucket.settings.allowedMimeTypes.length > 0 &&
    !bucket.settings.allowedMimeTypes.includes(detectedMime)
  ) {
    return badRequest('mime type not allowed by bucket policy');
  }

  const quota = await checkQuota(p.vendorId, size);
  if (!quota.ok) return quotaExceeded();

  const folderId = form.get('folderId');
  // Destination path within the bucket's server folder (default root "/"). The
  // file is mirrored to /var/www/vendors/<username>/<bucket>/<path>/<name> so it
  // shows in the file manager.
  const pathField = String(form.get('path') || '/');
  const tagsRaw = form.get('tags');
  const metadataRaw = form.get('metadata');
  const tags =
    typeof tagsRaw === 'string'
      ? tagsRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
  let metadata: Record<string, unknown> = {};
  if (typeof metadataRaw === 'string') {
    try {
      metadata = JSON.parse(metadataRaw);
    } catch {}
  }

  const arrayBuf = await file.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  const checksum = { sha256: sha256(buf), md5: md5(buf) };
  const extension = (originalName.split('.').pop() || '').toLowerCase();

  await storage.ensureBucket();
  const fileIdObj = new mongoose.Types.ObjectId();
  let storageKeyToUse = objectKey(
    p.vendorId,
    String(bucket._id),
    String(fileIdObj),
    originalName
  );

  // Deduplication: if the same vendor has already stored a file with the same
  // sha256, reuse its storage object instead of writing a second copy.
  const dedupSource = await FileModel.findOne({
    vendorId: p.vendorId,
    'checksum.sha256': checksum.sha256,
    status: 'ready'
  })
    .select('storageKey thumbnails width height')
    .lean();

  let imageMeta: { width: number; height: number } | null = null;
  let thumbnails: Array<{ size: 'sm' | 'md'; storageKey: string; width: number; height: number }> = [];

  if (dedupSource) {
    storageKeyToUse = dedupSource.storageKey;
    imageMeta =
      dedupSource.width || dedupSource.height
        ? { width: dedupSource.width || 0, height: dedupSource.height || 0 }
        : null;
    thumbnails = (dedupSource.thumbnails || []) as typeof thumbnails;
  } else {
    await storage.putObject(storageKeyToUse, buf, { mimeType: detectedMime });
    imageMeta = await extractImageMeta(buf, detectedMime);
    thumbnails = await generateThumbnails(buf, detectedMime, storageKeyToUse);
  }

  const existingVersion = await FileModel.findOne({
    vendorId: p.vendorId,
    bucketId: bucket._id,
    folderId: folderId ? folderId : null,
    originalName
  })
    .sort({ version: -1 })
    .lean();
  const version = (existingVersion?.version || 0) + 1;

  const doc = await FileModel.create({
    _id: fileIdObj,
    vendorId: p.vendorId,
    bucketId: bucket._id,
    folderId: folderId ? folderId : null,
    originalName,
    storageKey: storageKeyToUse,
    extension,
    mimeType: detectedMime,
    sizeBytes: size,
    checksum,
    width: imageMeta?.width || 0,
    height: imageMeta?.height || 0,
    thumbnails,
    tags,
    metadata: { ...metadata, deduped: !!dedupSource },
    version,
    status: 'ready',
    uploadedBy: p.userId || null,
    uploadSource: p.kind === 'apikey' ? 'api' : 'ui',
    apiKeyId: p.apiKeyId || null
  });

  await Promise.all([
    incrementUsage(p.vendorId, size, 1),
    Bucket.updateOne(
      { _id: bucket._id },
      { $inc: { storageBytes: size, fileCount: 1 } }
    )
  ]);

  // Mirror onto the vendor's server folder so it appears in the File Manager:
  //   /var/www/vendors/<username>/<bucketName>/<path>/<filename>
  // Best-effort and jailed — a filesystem error never fails the API upload.
  let mirroredPath: string | null = null;
  try {
    const vendor = await Vendor.findById(p.vendorId).select('username').lean();
    const home = await vendorHome(vendorFolderKey({ username: (vendor as any)?.username, _id: p.vendorId }));
    const cleanPath = pathField.replace(/^\/+|\/+$/g, '');
    const fileName = (originalName.split(/[\\/]/).pop() || 'file').replace(/[^\w.\-]/g, '_');
    const rel = '/' + [bucket.name, cleanPath, fileName].filter(Boolean).join('/');
    const dest = resolveInJail(home, rel);
    if (dest) {
      await fsp.mkdir(nodePath.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, buf);
      mirroredPath = rel;
    }
  } catch (e) {
    console.error('fs mirror failed', e);
  }

  // Quota warning email at 80% (fire-and-forget; only once per crossing — best-effort)
  Vendor.findById(p.vendorId)
    .lean()
    .then((v) => {
      if (!v?.limits?.maxStorageBytes || !v.contactEmail) return;
      const pct = (v.usage.storageBytes / v.limits.maxStorageBytes) * 100;
      const prevPct = ((v.usage.storageBytes - size) / v.limits.maxStorageBytes) * 100;
      if (prevPct < 80 && pct >= 80) {
        const tpl = MailTemplates.quotaWarning(v.name, pct);
        sendMail({ ...tpl, to: v.contactEmail }).catch(() => {});
      }
    })
    .catch(() => {});

  await audit(p, req, {
    action: 'file.upload',
    resourceType: 'file',
    resourceId: String(doc._id),
    meta: { name: originalName, size }
  });

  fireVendorWebhook({
    event: 'file.uploaded',
    vendorId: p.vendorId,
    data: { id: String(doc._id), name: originalName, size }
  }).catch(() => {});

  return jsonOk(
    {
      id: String(doc._id),
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      extension: doc.extension,
      checksum: doc.checksum,
      bucketId: String(doc.bucketId),
      folderId: doc.folderId ? String(doc.folderId) : null,
      tags: doc.tags,
      metadata: doc.metadata,
      version: doc.version,
      status: doc.status,
      createdAt: doc.createdAt,
      serverPath: mirroredPath // where it landed in the file manager (vendor-relative)
    },
    201
  );
}
