import { NextRequest } from 'next/server';
import mime from 'mime-types';
import mongoose from 'mongoose';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { badRequest, forbidden, jsonOk, notFound, quotaExceeded, safeParseJson, suspended, unauthorized } from '@/lib/http';
import { audit } from '@/lib/audit';
import { blankFileSchema } from '@/lib/validation';
import { storage, objectKey } from '@/lib/storage';
import { checkQuota, incrementUsage } from '@/lib/quota';
import { sha256, md5 } from '@/lib/crypto';
import { vendorHome, resolveInJail, vendorFolderKey } from '@/lib/server-fs';
import fsp from 'fs/promises';
import nodePath from 'path';
import { FileModel } from '@/models/File';
import { Bucket } from '@/models/Bucket';
import { Folder } from '@/models/Folder';
import { Vendor } from '@/models/Vendor';

export const runtime = 'nodejs';

// Create a new (text) file in a bucket/folder.
export async function POST(req: NextRequest, { params }: { params: { bid: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (p.vendorStatus === 'suspended') return suspended();
  if (!can(p, 'file:upload', { vendorId: p.vendorId, bucketId: params.bid })) return forbidden();

  const body = await safeParseJson(req);
  const parsed = blankFileSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input');

  await dbConnect();
  const bucket = await Bucket.findOne({ _id: params.bid, vendorId: p.vendorId });
  if (!bucket) return notFound('bucket not found');

  let folderId: any = null;
  if (parsed.data.folderId) {
    const target = await Folder.findOne({ _id: parsed.data.folderId, vendorId: p.vendorId, bucketId: params.bid }).lean();
    if (!target) return badRequest('folder not found');
    folderId = target._id;
  }

  const name = parsed.data.name;
  const buf = Buffer.from(parsed.data.content || '', 'utf8');
  const size = buf.byteLength;
  const detectedMime = parsed.data.mimeType || (mime.lookup(name) as string) || 'text/plain';

  const quota = await checkQuota(p.vendorId, size);
  if (!quota.ok) return quotaExceeded();

  await storage.ensureBucket();
  const id = new mongoose.Types.ObjectId();
  const key = objectKey(p.vendorId, String(bucket._id), String(id), name);
  await storage.putObject(key, buf, { mimeType: detectedMime });

  const doc = await FileModel.create({
    _id: id,
    vendorId: p.vendorId,
    bucketId: bucket._id,
    folderId,
    originalName: name,
    storageKey: key,
    extension: (name.split('.').pop() || '').toLowerCase(),
    mimeType: detectedMime,
    sizeBytes: size,
    checksum: { sha256: sha256(buf), md5: md5(buf) },
    status: 'ready',
    uploadedBy: p.userId || null,
    uploadSource: 'ui'
  });

  await Promise.all([
    incrementUsage(p.vendorId, size, 1),
    Bucket.updateOne({ _id: bucket._id }, { $inc: { storageBytes: size, fileCount: 1 } })
  ]);

  // Mirror onto the vendor's server folder so it shows in the file manager.
  let serverPath: string | null = null;
  try {
    const vendor = await Vendor.findById(p.vendorId).select('username').lean();
    const home = await vendorHome(vendorFolderKey({ username: (vendor as any)?.username, _id: p.vendorId }));
    const cleanPath = String((parsed.data as any).path || '/').replace(/^\/+|\/+$/g, '');
    const fileName = name.split(/[\\/]/).pop()!.replace(/[^\w.\-]/g, '_');
    const rel = '/' + [bucket.name, cleanPath, fileName].filter(Boolean).join('/');
    const dest = resolveInJail(home, rel);
    if (dest) {
      await fsp.mkdir(nodePath.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, buf);
      serverPath = rel;
    }
  } catch (e) {
    console.error('fs mirror failed', e);
  }

  await audit(p, req, { action: 'file.create', resourceType: 'file', resourceId: String(doc._id), meta: { name } });
  return jsonOk({ id: String(doc._id), originalName: name, serverPath }, 201);
}
