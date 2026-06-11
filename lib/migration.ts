import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { lookup as mimeLookup } from 'mime-types';
import mongoose from 'mongoose';
import { dbConnect } from './db';
import { storage, objectKey } from './storage';
import { decryptSecret } from './crypto';
import { Migration, MigrationDoc } from '@/models/Migration';
import { Bucket } from '@/models/Bucket';
import { Folder } from '@/models/Folder';
import { FileModel } from '@/models/File';
import { Vendor } from '@/models/Vendor';

// Buffer cap per file (held in memory while copying). Larger objects are
// skipped + logged rather than risk OOM.
const MAX_FILE_BYTES = 256 * 1024 * 1024;

export interface SourceCreds {
  endpoint: string;
  region?: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  prefix?: string;
  forcePathStyle?: boolean;
}

function s3From(c: { endpoint: string; region?: string; accessKey: string; secretKey: string; forcePathStyle?: boolean }): S3Client {
  return new S3Client({
    endpoint: c.endpoint,
    region: c.region || 'us-east-1',
    forcePathStyle: c.forcePathStyle !== false,
    credentials: { accessKeyId: c.accessKey, secretAccessKey: c.secretKey }
  });
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function listAll(client: S3Client, bucket: string, prefix: string): Promise<{ Key: string; Size: number }[]> {
  const out: { Key: string; Size: number }[] = [];
  let token: string | undefined;
  do {
    const r = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, ContinuationToken: token, MaxKeys: 1000 })
    );
    for (const o of r.Contents || []) if (o.Key) out.push({ Key: o.Key, Size: o.Size || 0 });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
    if (out.length > 200_000) break; // runaway guard
  } while (token);
  return out;
}

export async function testSource(c: SourceCreds): Promise<{ ok: boolean; message: string; sample?: number }> {
  try {
    const r = await s3From(c).send(
      new ListObjectsV2Command({ Bucket: c.bucket, Prefix: c.prefix || undefined, MaxKeys: 1 })
    );
    return { ok: true, message: 'Connected to source bucket.', sample: r.KeyCount || 0 };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

export async function discoverSource(
  c: SourceCreds
): Promise<{ ok: boolean; objects: number; bytes: number; message?: string }> {
  try {
    const objs = await listAll(s3From(c), c.bucket, c.prefix || '');
    return { ok: true, objects: objs.length, bytes: objs.reduce((a, o) => a + o.Size, 0) };
  } catch (e) {
    return { ok: false, objects: 0, bytes: 0, message: msg(e) };
  }
}

// ---- runner ---------------------------------------------------------------

function log(job: MigrationDoc, level: string, message: string) {
  job.logs.push({ ts: new Date(), level, message } as any);
  if (job.logs.length > 500) job.logs.splice(0, job.logs.length - 500);
}
function setStep(job: MigrationDoc, name: string, status: string, detail = '') {
  const s = job.steps.find((x) => x.name === name);
  if (s) {
    s.status = status;
    if (detail) s.detail = detail;
  } else job.steps.push({ name, status, detail } as any);
}

function splitKey(rel: string): { folderPath: string; fileName: string } {
  const parts = rel.split('/').filter(Boolean);
  const fileName = parts.pop() || rel;
  return { folderPath: parts.join('/'), fileName };
}

async function ensureFolderPath(
  vendorId: string,
  bucketId: string,
  folderPath: string,
  cache: Map<string, string>,
  createdBy: any
): Promise<string | null> {
  if (!folderPath) return null;
  const segments = folderPath.split('/').filter(Boolean);
  let parentId: string | null = null;
  let cumulative = '';
  for (const seg of segments) {
    cumulative += `/${seg}`;
    const cached = cache.get(cumulative);
    if (cached) {
      parentId = cached;
      continue;
    }
    let folder = await Folder.findOne({ vendorId, bucketId, path: cumulative });
    if (!folder) {
      folder = await Folder.create({ vendorId, bucketId, name: seg, parentId, path: cumulative, createdBy });
    }
    parentId = String(folder._id);
    cache.set(cumulative, parentId);
  }
  return parentId;
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  const stream = body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function runMigration(jobId: string): Promise<void> {
  await dbConnect();
  // Loosely typed: mongoose InferSchemaType marks nested subdocs (source,
  // totals, done) optional, but they always exist on a created job.
  const job: any = await Migration.findById(jobId);
  if (!job || job.status !== 'pending') return;

  job.status = 'running';
  job.startedAt = new Date();
  setStep(job, 'connect', 'running');
  await job.save();

  try {
    const src = job.source;
    const client = s3From({
      endpoint: src.endpoint,
      region: src.region,
      accessKey: decryptSecret(src.accessKeyEnc),
      secretKey: decryptSecret(src.secretKeyEnc),
      forcePathStyle: src.forcePathStyle
    });
    const vendorId = String(job.targetVendorId);

    let bucket = await Bucket.findOne({ vendorId, name: job.targetBucketName });
    if (!bucket) bucket = await Bucket.create({ vendorId, name: job.targetBucketName, createdBy: job.createdBy });
    await storage.ensureBucket();
    setStep(job, 'connect', 'completed', `target bucket "${bucket.name}"`);
    log(job, 'info', `Connected. Target bucket "${bucket.name}".`);

    setStep(job, 'list', 'running');
    await job.save();
    const objects = await listAll(client, src.bucket, src.prefix || '');
    job.totals.objects = objects.length;
    job.totals.bytes = objects.reduce((a, o) => a + o.Size, 0);
    setStep(job, 'list', 'completed', `${objects.length} objects`);
    log(job, 'info', `Found ${objects.length} objects in source.`);

    setStep(job, 'copy', 'running');
    await job.save();

    const folderCache = new Map<string, string>();
    const prefix = src.prefix || '';
    let i = 0;
    for (const obj of objects) {
      i++;
      const rel = obj.Key.slice(prefix.length).replace(/^\/+/, '');
      if (!rel || obj.Key.endsWith('/')) {
        job.done.skipped++;
        continue;
      }
      if (obj.Size > MAX_FILE_BYTES) {
        job.done.skipped++;
        log(job, 'warn', `Skipped (too large, >256MB): ${rel}`);
      } else {
        try {
          const { folderPath, fileName } = splitKey(rel);
          const folderId = await ensureFolderPath(vendorId, String(bucket._id), folderPath, folderCache, job.createdBy);
          const extension = (fileName.split('.').pop() || '').toLowerCase();
          const file = await FileModel.create({
            vendorId,
            bucketId: bucket._id,
            folderId,
            originalName: fileName,
            storageKey: `migrating-${new mongoose.Types.ObjectId()}`,
            extension,
            mimeType: 'application/octet-stream',
            sizeBytes: 0,
            status: 'uploading',
            uploadSource: 'api'
          });
          const got = await client.send(new GetObjectCommand({ Bucket: src.bucket, Key: obj.Key }));
          const buf = await streamToBuffer(got.Body);
          const mime = got.ContentType || mimeLookup(fileName) || 'application/octet-stream';
          const key = objectKey(vendorId, String(bucket._id), String(file._id), fileName);
          await storage.putObject(key, buf, { mimeType: mime });
          file.storageKey = key;
          file.sizeBytes = buf.byteLength;
          file.mimeType = mime;
          file.status = 'ready';
          await file.save();
          job.done.objects++;
          job.done.bytes += buf.byteLength;
        } catch (e) {
          job.done.failed++;
          log(job, 'error', `Failed ${rel}: ${msg(e)}`);
        }
      }
      job.currentItem = `${i}/${objects.length} · ${rel}`;
      job.progress = Math.round((i / Math.max(1, objects.length)) * 100);
      if (i % 5 === 0 || i === objects.length) await job.save();
    }

    // Recompute bucket counters + bump vendor usage.
    const agg = await FileModel.aggregate([
      { $match: { bucketId: bucket._id, status: 'ready' } },
      { $group: { _id: null, bytes: { $sum: '$sizeBytes' }, count: { $sum: 1 } } }
    ]);
    bucket.storageBytes = agg[0]?.bytes || 0;
    bucket.fileCount = agg[0]?.count || 0;
    await bucket.save();
    await Vendor.updateOne({ _id: vendorId }, { $inc: { 'usage.storageBytes': job.done.bytes, 'usage.fileCount': job.done.objects } });

    setStep(job, 'copy', 'completed', `${job.done.objects} copied · ${job.done.skipped} skipped · ${job.done.failed} failed`);
    job.status = 'completed';
    job.progress = 100;
    job.finishedAt = new Date();
    log(job, 'info', 'Migration complete.');
    await job.save();
  } catch (e) {
    job.status = 'failed';
    job.error = msg(e);
    job.finishedAt = new Date();
    setStep(job, 'copy', 'failed');
    log(job, 'error', `Migration failed: ${msg(e)}`);
    await job.save();
  }
}
