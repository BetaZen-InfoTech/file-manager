import { NextRequest } from 'next/server';
import archiver from 'archiver';
import mongoose from 'mongoose';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { badRequest, forbidden, jsonOk, notFound, quotaExceeded, safeParseJson, suspended, unauthorized } from '@/lib/http';
import { audit } from '@/lib/audit';
import { archiveSchema } from '@/lib/validation';
import { storage, objectKey } from '@/lib/storage';
import { vendorFolderKeyById } from '@/lib/vendor-folder';
import { checkQuota, incrementUsage } from '@/lib/quota';
import { sha256, md5 } from '@/lib/crypto';
import { FileModel } from '@/models/File';
import { Bucket } from '@/models/Bucket';
import { Folder } from '@/models/Folder';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SRC_CAP = 1024 * 1024 * 1024; // 1 GB total source — buffered in memory

function fullPath(path: string, name: string): string {
  return (path === '/' ? `/${name}` : `${path}/${name}`).replace(/^\/+/, '');
}

// Zip selected files/folders into a new .zip in the bucket.
export async function POST(req: NextRequest, { params }: { params: { bid: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (p.vendorStatus === 'suspended') return suspended();
  if (!can(p, 'file:read', { vendorId: p.vendorId, bucketId: params.bid })) return forbidden();

  const body = await safeParseJson(req);
  const parsed = archiveSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input');

  await dbConnect();
  const bucket = await Bucket.findOne({ _id: params.bid, vendorId: p.vendorId });
  if (!bucket) return notFound('bucket not found');

  // All folders in the bucket → id→fullPath, and subtree resolution.
  const folders = await Folder.find({ vendorId: p.vendorId, bucketId: params.bid })
    .select('_id name path')
    .lean();
  const fpath = new Map(folders.map((f: any) => [String(f._id), fullPath(f.path || '/', f.name)]));

  const folderIdSet = new Set<string>();
  for (const fid of parsed.data.folderIds || []) {
    const base = fpath.get(fid);
    if (base == null) continue;
    folderIdSet.add(fid);
    for (const f of folders) {
      const fp = fpath.get(String(f._id))!;
      if (fp === base || fp.startsWith(base + '/')) folderIdSet.add(String(f._id));
    }
  }

  const or: any[] = [];
  if (parsed.data.fileIds?.length) or.push({ _id: { $in: parsed.data.fileIds } });
  if (folderIdSet.size) or.push({ folderId: { $in: [...folderIdSet].map((x) => new mongoose.Types.ObjectId(x)) } });
  if (!or.length) return badRequest('select at least one file or folder');

  const files = await FileModel.find({ vendorId: p.vendorId, bucketId: params.bid, status: 'ready', $or: or })
    .select('originalName storageKey sizeBytes folderId')
    .lean();
  if (!files.length) return badRequest('nothing to zip');

  const totalSrc = files.reduce((a: number, f: any) => a + (f.sizeBytes || 0), 0);
  if (totalSrc > SRC_CAP) return badRequest('selection too large to zip (max 1 GB)');

  const quota = await checkQuota(p.vendorId, totalSrc);
  if (!quota.ok) return quotaExceeded();

  // Build the zip in memory (capped above).
  const archive = archiver('zip', { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  archive.on('data', (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((res, rej) => {
    archive.on('end', () => res());
    archive.on('error', (e: any) => rej(e));
  });
  const seen = new Set<string>();
  for (const f of files as any[]) {
    const dir = f.folderId ? fpath.get(String(f.folderId)) || '' : '';
    let entry = dir ? `${dir}/${f.originalName}` : f.originalName;
    while (seen.has(entry)) entry = entry.replace(/(\.[^.]+)?$/, `_${Math.floor(performance.now())}$1`);
    seen.add(entry);
    const { stream } = await storage.getObject(f.storageKey);
    archive.append(stream as any, { name: entry });
  }
  await archive.finalize();
  await finished;
  const zipBuf = Buffer.concat(chunks);

  // Store the zip as a new file.
  const zipName = (parsed.data.name || `${bucket.name}-${Date.now()}`).replace(/\.zip$/i, '') + '.zip';
  let folderId: any = null;
  if (parsed.data.folderId) {
    const t = await Folder.findOne({ _id: parsed.data.folderId, vendorId: p.vendorId, bucketId: params.bid }).lean();
    folderId = t?._id || null;
  }
  await storage.ensureBucket();
  const vendorKey = await vendorFolderKeyById(p.vendorId);
  const id = new mongoose.Types.ObjectId();
  const key = objectKey(vendorKey, String(bucket._id), String(id), zipName);
  await storage.putObject(key, zipBuf, { mimeType: 'application/zip' });

  const doc = await FileModel.create({
    _id: id,
    vendorId: p.vendorId,
    bucketId: bucket._id,
    folderId,
    originalName: zipName,
    storageKey: key,
    extension: 'zip',
    mimeType: 'application/zip',
    sizeBytes: zipBuf.byteLength,
    checksum: { sha256: sha256(zipBuf), md5: md5(zipBuf) },
    status: 'ready',
    uploadedBy: p.userId || null,
    uploadSource: 'ui'
  });
  await Promise.all([
    incrementUsage(p.vendorId, zipBuf.byteLength, 1),
    Bucket.updateOne({ _id: bucket._id }, { $inc: { storageBytes: zipBuf.byteLength, fileCount: 1 } })
  ]);

  await audit(p, req, { action: 'file.zip', resourceType: 'file', resourceId: String(doc._id), meta: { count: files.length } });
  return jsonOk({ id: String(doc._id), originalName: zipName, sizeBytes: zipBuf.byteLength, files: files.length }, 201);
}
