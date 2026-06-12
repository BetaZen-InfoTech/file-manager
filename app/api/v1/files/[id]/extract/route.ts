import { NextRequest } from 'next/server';
import { Readable } from 'stream';
import unzipper from 'unzipper';
import mongoose from 'mongoose';
import mime from 'mime-types';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { badRequest, forbidden, jsonOk, notFound, quotaExceeded, safeParseJson, suspended, unauthorized } from '@/lib/http';
import { audit } from '@/lib/audit';
import { extractSchema } from '@/lib/validation';
import { storage, objectKey } from '@/lib/storage';
import { checkQuota, incrementUsage } from '@/lib/quota';
import { sha256, md5 } from '@/lib/crypto';
import { FileModel } from '@/models/File';
import { Bucket } from '@/models/Bucket';
import { Folder } from '@/models/Folder';

export const runtime = 'nodejs';
export const maxDuration = 300;

const ZIP_CAP = 500 * 1024 * 1024; // max .zip object to buffer
const UNCOMP_CAP = 2 * 1024 * 1024 * 1024; // max total uncompressed (zip-bomb guard)

async function toBuffer(body: unknown): Promise<Buffer> {
  const stream = body as Readable;
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

async function ensureFolderPath(
  vendorId: string,
  bucketId: string,
  rel: string,
  cache: Map<string, string>,
  createdBy: any
): Promise<string | null> {
  const segs = rel.split('/').filter(Boolean);
  let parentId: string | null = null;
  let cum = '';
  for (const seg of segs) {
    cum += `/${seg}`;
    const c = cache.get(cum);
    if (c) {
      parentId = c;
      continue;
    }
    let folder = await Folder.findOne({ vendorId, bucketId, path: cum });
    if (!folder) folder = await Folder.create({ vendorId, bucketId, name: seg, parentId, path: cum, createdBy });
    parentId = String(folder._id);
    cache.set(cum, parentId);
  }
  return parentId;
}

function fullPath(path: string, name: string): string {
  return (path === '/' ? `/${name}` : `${path}/${name}`).replace(/^\/+/, '');
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (p.vendorStatus === 'suspended') return suspended();

  const body = await safeParseJson(req);
  const parsed = extractSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input');

  await dbConnect();
  const zip = await FileModel.findOne({ _id: params.id, vendorId: p.vendorId, status: 'ready' }).lean();
  if (!zip) return notFound('file not found');
  if (!can(p, 'file:upload', { vendorId: p.vendorId, bucketId: String(zip.bucketId) })) return forbidden();
  if (!/zip/i.test(zip.mimeType) && !/\.zip$/i.test(zip.originalName)) return badRequest('not a zip file');
  if (zip.sizeBytes > ZIP_CAP) return badRequest('zip too large to extract (max 500 MB)');

  // base folder to extract into
  let baseRel = '';
  if (parsed.data.folderId) {
    const f = await Folder.findOne({ _id: parsed.data.folderId, vendorId: p.vendorId, bucketId: zip.bucketId }).lean();
    if (!f) return badRequest('target folder not found');
    baseRel = fullPath(f.path || '/', f.name);
  }

  const { stream } = await storage.getObject(zip.storageKey);
  const zipBuf = await toBuffer(stream);
  const dir = await unzipper.Open.buffer(zipBuf);

  const entries = dir.files.filter((e: any) => e.type === 'File');
  const totalUncomp = entries.reduce((a: number, e: any) => a + (e.uncompressedSize || 0), 0);
  if (totalUncomp > UNCOMP_CAP) return badRequest('archive contents too large');
  const quota = await checkQuota(p.vendorId, totalUncomp);
  if (!quota.ok) return quotaExceeded();

  await storage.ensureBucket();
  const cache = new Map<string, string>();
  let created = 0;
  let addedBytes = 0;

  for (const entry of entries as any[]) {
    const rawPath = String(entry.path).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rawPath || rawPath.includes('..')) continue; // path traversal guard
    const parts = rawPath.split('/');
    const name = parts.pop() || rawPath;
    const relDir = [baseRel, parts.join('/')].filter(Boolean).join('/');
    try {
      const folderId = await ensureFolderPath(String(p.vendorId), String(zip.bucketId), relDir, cache, p.userId);
      const content: Buffer = await entry.buffer();
      const detectedMime = (mime.lookup(name) as string) || 'application/octet-stream';
      const id = new mongoose.Types.ObjectId();
      const key = objectKey(String(p.vendorId), String(zip.bucketId), String(id), name);
      await storage.putObject(key, content, { mimeType: detectedMime });
      await FileModel.create({
        _id: id,
        vendorId: p.vendorId,
        bucketId: zip.bucketId,
        folderId,
        originalName: name,
        storageKey: key,
        extension: (name.split('.').pop() || '').toLowerCase(),
        mimeType: detectedMime,
        sizeBytes: content.byteLength,
        checksum: { sha256: sha256(content), md5: md5(content) },
        status: 'ready',
        uploadedBy: p.userId || null,
        uploadSource: 'ui'
      });
      created++;
      addedBytes += content.byteLength;
    } catch {
      /* skip a bad entry */
    }
  }

  await Promise.all([
    incrementUsage(String(p.vendorId), addedBytes, created),
    Bucket.updateOne({ _id: zip.bucketId }, { $inc: { storageBytes: addedBytes, fileCount: created } })
  ]);

  await audit(p, req, { action: 'file.extract', resourceType: 'file', resourceId: String(zip._id), meta: { created } });
  return jsonOk({ ok: true, extracted: created });
}
