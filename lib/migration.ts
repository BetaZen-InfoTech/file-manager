import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable, Transform } from 'stream';
import crypto from 'crypto';
import { lookup as mimeLookup } from 'mime-types';
import mongoose from 'mongoose';
import { dbConnect } from './db';
import { storage, objectKey } from './storage';
import { decryptSecret, encryptSecret } from './crypto';
import { Migration, MigrationDoc } from '@/models/Migration';
import { Bucket } from '@/models/Bucket';
import { Folder } from '@/models/Folder';
import { FileModel } from '@/models/File';
import { Vendor } from '@/models/Vendor';
import { User } from '@/models/User';
import { ApiKey } from '@/models/ApiKey';
import { Link } from '@/models/Link';
import { Plan } from '@/models/Plan';
import { Payment } from '@/models/Payment';
import { AuditLog } from '@/models/AuditLog';
import { PlatformSettings } from '@/models/PlatformSettings';
import { JwtRevocation } from '@/models/JwtRevocation';

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

// ===========================================================================
// bcdnp -> bcdnp streaming transfer (pull from another file-manager install)
// ===========================================================================

function normBase(u: string): string {
  return u.replace(/\/+$/, '');
}

export async function testBcdnp(baseUrl: string, token: string): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await fetch(`${normBase(baseUrl)}/api/v1/transfer/manifest?limit=1`, {
      headers: { authorization: `Bearer ${token}` },
      redirect: 'manual'
    });
    if (r.status !== 200) return { ok: false, message: `source responded ${r.status} (bad URL or token?)` };
    await r.json().catch(() => null);
    return { ok: true, message: 'Connected to source instance.' };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

export async function discoverBcdnp(
  baseUrl: string,
  token: string
): Promise<{ ok: boolean; objects: number; bytes: number; message?: string }> {
  try {
    const r = await fetch(`${normBase(baseUrl)}/api/v1/transfer/manifest?limit=1`, {
      headers: { authorization: `Bearer ${token}` },
      redirect: 'manual'
    });
    if (r.status !== 200) return { ok: false, objects: 0, bytes: 0, message: `source responded ${r.status}` };
    const j: any = await r.json();
    return { ok: true, objects: j?.summary?.objects || 0, bytes: j?.summary?.bytes || 0 };
  } catch (e) {
    return { ok: false, objects: 0, bytes: 0, message: msg(e) };
  }
}

interface ManifestEntry {
  id: string;
  bucketName: string;
  folderPath: string;
  originalName: string;
  sizeBytes: number;
  mimeType: string;
  sha256: string;
}

async function fetchManifestAll(baseUrl: string, token: string): Promise<ManifestEntry[]> {
  const out: ManifestEntry[] = [];
  let after: string | null = null;
  do {
    const url = `${normBase(baseUrl)}/api/v1/transfer/manifest?limit=1000${after ? `&after=${after}` : ''}`;
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` }, redirect: 'manual' });
    if (r.status !== 200) throw new Error(`manifest fetch failed (${r.status})`);
    const j: any = await r.json();
    for (const f of j.files || []) out.push(f);
    after = j.nextAfter || null;
    if (out.length > 500_000) break;
  } while (after);
  return out;
}

async function ensureBucketByName(
  vendorId: string,
  name: string,
  cache: Map<string, string>,
  createdBy: any
): Promise<string> {
  const cached = cache.get(name);
  if (cached) return cached;
  let bucket = await Bucket.findOne({ vendorId, name });
  if (!bucket) bucket = await Bucket.create({ vendorId, name, createdBy });
  cache.set(name, String(bucket._id));
  return String(bucket._id);
}

export async function runBcdnpTransfer(jobId: string): Promise<void> {
  await dbConnect();

  // Atomic claim: take a pending job, OR reclaim a 'running' job whose heartbeat
  // is stale (previous runner died). Prevents two runners racing.
  const claimed: any = await Migration.findOneAndUpdate(
    {
      _id: jobId,
      $or: [{ status: 'pending' }, { status: 'running', heartbeatAt: { $lt: new Date(Date.now() - 120_000) } }]
    },
    { $set: { status: 'running', heartbeatAt: new Date() } },
    { new: true }
  );
  if (!claimed) return;
  const job: any = claimed;
  if (!job.startedAt) job.startedAt = new Date();

  setStep(job, 'connect', 'running');
  await job.save();

  try {
    const baseUrl = job.bcdnp.baseUrl;
    const token = decryptSecret(job.bcdnp.tokenEnc);
    const vendorId = String(job.targetVendorId);
    await storage.ensureBucket();

    // Drop placeholder rows from a prior interrupted run (no object written).
    await FileModel.deleteMany({ status: 'uploading', 'metadata.transferJobId': jobId });

    setStep(job, 'connect', 'completed');
    setStep(job, 'list', 'running');
    log(job, 'info', 'Fetching manifest from source…');
    await job.save();

    const manifest = await fetchManifestAll(baseUrl, token);
    job.totals.objects = manifest.length;
    job.totals.bytes = manifest.reduce((a, m) => a + (m.sizeBytes || 0), 0);
    setStep(job, 'list', 'completed', `${manifest.length} files`);
    setStep(job, 'copy', 'running');
    log(job, 'info', `Manifest: ${manifest.length} files, ${(job.totals.bytes / 1048576).toFixed(0)} MB.`);
    await job.save();

    const bucketCache = new Map<string, string>();
    const folderCache = new Map<string, string>();
    const startedMs = job.startedAt ? new Date(job.startedAt).getTime() : Date.now();
    let i = 0;

    for (const entry of manifest) {
      i++;

      if (i % 10 === 0) {
        const fresh: any = await Migration.findById(jobId).select('status').lean();
        if (fresh?.status === 'cancelled') {
          setStep(job, 'copy', 'failed', 'cancelled');
          log(job, 'warn', 'Cancelled by admin.');
          await Migration.updateOne({ _id: jobId }, { $set: { finishedAt: new Date() } });
          return;
        }
      }

      const bucketId = await ensureBucketByName(vendorId, entry.bucketName || 'imported', bucketCache, job.createdBy);

      const existing = await FileModel.findOne({ vendorId, 'metadata.sourceFileId': entry.id, status: 'ready' })
        .select('_id')
        .lean();
      if (existing) {
        job.done.skipped++;
      } else {
        let file: any = null;
        try {
          const folderId = await ensureFolderPath(vendorId, bucketId, entry.folderPath || '', folderCache, job.createdBy);
          file = await FileModel.create({
            vendorId,
            bucketId,
            folderId,
            originalName: entry.originalName,
            storageKey: `migrating-${new mongoose.Types.ObjectId()}`,
            extension: (entry.originalName.split('.').pop() || '').toLowerCase(),
            mimeType: entry.mimeType || 'application/octet-stream',
            sizeBytes: 0,
            status: 'uploading',
            uploadSource: 'api',
            metadata: { sourceFileId: entry.id, transferJobId: jobId }
          });

          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 15 * 60 * 1000);
          let counted = 0;
          const hash = crypto.createHash('sha256');
          try {
            const resp = await fetch(`${normBase(baseUrl)}/api/v1/transfer/file/${entry.id}/stream`, {
              headers: { authorization: `Bearer ${token}` },
              redirect: 'manual',
              signal: ctrl.signal
            });
            if (resp.status !== 200 || !resp.body) throw new Error(`stream ${resp.status}`);
            const enc = (resp.headers.get('content-encoding') || 'identity').toLowerCase();
            if (enc !== 'identity') throw new Error(`unexpected content-encoding ${enc}`);

            const srcStream = Readable.fromWeb(resp.body as any);
            const counter = new Transform({
              transform(chunk, _e, cb) {
                counted += chunk.length;
                hash.update(chunk);
                cb(null, chunk);
              }
            });
            srcStream.on('error', (e) => counter.destroy(e));
            srcStream.pipe(counter);

            const mime = entry.mimeType || (mimeLookup(entry.originalName) as string) || 'application/octet-stream';
            const key = objectKey(vendorId, bucketId, String(file._id), entry.originalName);
            await storage.putObjectStream(key, counter, entry.sizeBytes, { mimeType: mime });

            if (counted !== entry.sizeBytes) throw new Error(`size mismatch ${counted} != ${entry.sizeBytes}`);
            const digest = hash.digest('hex');
            if (entry.sha256 && /^[a-f0-9]{64}$/i.test(entry.sha256) && digest !== entry.sha256.toLowerCase()) {
              throw new Error('sha256 mismatch');
            }

            file.storageKey = key;
            file.sizeBytes = entry.sizeBytes;
            file.mimeType = mime;
            file.checksum = { sha256: digest, md5: '' };
            file.status = 'ready';
            await file.save();
            job.done.objects++;
            job.done.bytes += entry.sizeBytes;
          } finally {
            clearTimeout(timer);
          }
        } catch (e) {
          job.done.failed++;
          log(job, 'error', `Failed ${entry.bucketName}/${entry.originalName}: ${msg(e)}`);
          if (file) await FileModel.deleteOne({ _id: file._id, status: 'uploading' }).catch(() => {});
        }
      }

      const elapsed = (Date.now() - startedMs) / 1000;
      const bps = elapsed > 0 ? job.done.bytes / elapsed : 0;
      job.currentItem = `${i}/${manifest.length} · ${entry.bucketName}/${entry.originalName}`;
      job.progress = Math.round((i / Math.max(1, manifest.length)) * 100);
      job.heartbeatAt = new Date();
      if (i % 3 === 0 || i === manifest.length) {
        (job as any).throughputMbps = bps > 0 ? +(bps / 1048576).toFixed(2) : 0;
        await job.save();
      }
    }

    for (const bId of bucketCache.values()) {
      const agg = await FileModel.aggregate([
        { $match: { bucketId: new mongoose.Types.ObjectId(bId), status: 'ready' } },
        { $group: { _id: null, bytes: { $sum: '$sizeBytes' }, count: { $sum: 1 } } }
      ]);
      await Bucket.updateOne({ _id: bId }, { $set: { storageBytes: agg[0]?.bytes || 0, fileCount: agg[0]?.count || 0 } });
    }
    await Vendor.updateOne(
      { _id: vendorId },
      { $inc: { 'usage.storageBytes': job.done.bytes, 'usage.fileCount': job.done.objects } }
    );

    setStep(job, 'copy', 'completed', `${job.done.objects} copied · ${job.done.skipped} skipped · ${job.done.failed} failed`);
    job.status = 'completed';
    job.progress = 100;
    job.finishedAt = new Date();
    log(job, 'info', 'Transfer complete.');
    await job.save();
  } catch (e) {
    job.status = 'failed';
    job.error = msg(e);
    job.finishedAt = new Date();
    setStep(job, 'copy', 'failed');
    log(job, 'error', `Transfer failed: ${msg(e)}`);
    await job.save();
  }
}

// ===========================================================================
// FULL platform migration (bcdnp -> bcdnp): vendors, users, API keys, buckets,
// folders, files, links, plans, payments, settings, audit logs. Pulls metadata
// from the source's /transfer/export endpoint and streams file bytes. Merge
// rules: vendors match by slug (merge into existing); files override on
// path+name+size (skip byte-identical); credentials (hashes) carry over.
// ===========================================================================

async function* iterateExport(baseUrl: string, token: string, collection: string): AsyncGenerator<any> {
  let after: string | null = null;
  do {
    const url = `${normBase(baseUrl)}/api/v1/transfer/export?collection=${collection}&limit=500${after ? `&after=${after}` : ''}`;
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` }, redirect: 'manual' });
    if (r.status !== 200) throw new Error(`export ${collection} failed (${r.status})`);
    const j: any = await r.json();
    for (const it of j.items || []) yield it;
    after = j.nextAfter || null;
  } while (after);
}

async function streamSourceFile(
  baseUrl: string,
  token: string,
  sourceId: string,
  key: string,
  expectedSize: number,
  mime: string
): Promise<{ sha256: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15 * 60 * 1000);
  try {
    const resp = await fetch(`${normBase(baseUrl)}/api/v1/transfer/file/${sourceId}/stream`, {
      headers: { authorization: `Bearer ${token}` },
      redirect: 'manual',
      signal: ctrl.signal
    });
    if (resp.status !== 200 || !resp.body) throw new Error(`stream ${resp.status}`);
    let counted = 0;
    const hash = crypto.createHash('sha256');
    const srcStream = Readable.fromWeb(resp.body as any);
    const counter = new Transform({
      transform(chunk, _e, cb) {
        counted += chunk.length;
        hash.update(chunk);
        cb(null, chunk);
      }
    });
    srcStream.on('error', (e) => counter.destroy(e));
    srcStream.pipe(counter);
    await storage.putObjectStream(key, counter, expectedSize, { mimeType: mime });
    if (counted !== expectedSize) throw new Error(`size mismatch ${counted} != ${expectedSize}`);
    return { sha256: hash.digest('hex') };
  } finally {
    clearTimeout(timer);
  }
}

export async function runFullMigration(jobId: string): Promise<void> {
  await dbConnect();
  const claimed: any = await Migration.findOneAndUpdate(
    {
      _id: jobId,
      $or: [{ status: 'pending' }, { status: 'running', heartbeatAt: { $lt: new Date(Date.now() - 120_000) } }]
    },
    { $set: { status: 'running', heartbeatAt: new Date() } },
    { new: true }
  );
  if (!claimed) return;
  const job: any = claimed;
  if (!job.startedAt) job.startedAt = new Date();

  const baseUrl = job.bcdnp.baseUrl;
  const token = decryptSecret(job.bcdnp.tokenEnc);
  const R: any = (job.report = job.report || {});
  const inc = (a: string, b: string, n = 1) => {
    R[a] = R[a] || {};
    R[a][b] = (R[a][b] || 0) + n;
  };
  const vendorMap = new Map<string, string>();
  const bucketMap = new Map<string, string>();
  const folderMap = new Map<string, string>();
  const fileMap = new Map<string, string>();
  const touchedBuckets = new Set<string>();
  const step = async (name: string, status: string, detail = '') => {
    setStep(job, name, status, detail);
    job.heartbeatAt = new Date();
    await job.save();
  };

  try {
    await storage.ensureBucket();
    log(job, 'info', 'Full migration started.');

    // 1) Vendors — merge by slug.
    await step('vendors', 'running');
    for await (const v of iterateExport(baseUrl, token, 'vendors')) {
      try {
        const ex = await Vendor.findOne({ slug: v.slug }).select('_id').lean();
        if (ex) {
          vendorMap.set(String(v._id), String(ex._id));
          inc('vendors', 'merged');
        } else {
          let username = v.username || null;
          if (username && (await Vendor.findOne({ username }).select('_id').lean())) {
            username = `${username}_${Math.floor(Date.now() / 1000) % 100000}`;
          }
          const created = await Vendor.create({
            name: v.name,
            slug: v.slug,
            username,
            plan: v.plan || 'free',
            status: v.status || 'active',
            contactEmail: v.contactEmail || null,
            limits: v.limits,
            usage: v.usage || { storageBytes: 0, fileCount: 0 }
          });
          vendorMap.set(String(v._id), String(created._id));
          inc('vendors', 'added');
        }
      } catch (e) {
        log(job, 'error', `vendor ${v.slug}: ${msg(e)}`);
      }
    }
    await step('vendors', 'completed', `${R.vendors?.added || 0} added · ${R.vendors?.merged || 0} merged`);

    // 2) Buckets — match by (vendor, name).
    await step('buckets', 'running');
    for await (const b of iterateExport(baseUrl, token, 'buckets')) {
      const vId = vendorMap.get(String(b.vendorId));
      if (!vId) continue;
      const ex = await Bucket.findOne({ vendorId: vId, name: b.name }).select('_id').lean();
      if (ex) {
        bucketMap.set(String(b._id), String(ex._id));
        inc('buckets', 'reused');
      } else {
        const created = await Bucket.create({
          vendorId: vId,
          name: b.name,
          description: b.description || '',
          isPublic: !!b.isPublic,
          settings: b.settings || {}
        });
        bucketMap.set(String(b._id), String(created._id));
        inc('buckets', 'added');
      }
    }
    await step('buckets', 'completed', `${R.buckets?.added || 0} added · ${R.buckets?.reused || 0} reused`);

    // 3) Folders — match by (vendor, bucket, path, name). Parent remapped best-effort.
    await step('folders', 'running');
    for await (const f of iterateExport(baseUrl, token, 'folders')) {
      const vId = vendorMap.get(String(f.vendorId));
      const bId = bucketMap.get(String(f.bucketId));
      if (!vId || !bId) continue;
      const ex = await Folder.findOne({ vendorId: vId, bucketId: bId, path: f.path, name: f.name }).select('_id').lean();
      if (ex) {
        folderMap.set(String(f._id), String(ex._id));
        inc('folders', 'reused');
      } else {
        const parentId = f.parentId ? folderMap.get(String(f.parentId)) || null : null;
        const created = await Folder.create({ vendorId: vId, bucketId: bId, name: f.name, parentId, path: f.path || '/' });
        folderMap.set(String(f._id), String(created._id));
        inc('folders', 'added');
      }
    }
    await step('folders', 'completed', `${R.folders?.added || 0} added · ${R.folders?.reused || 0} reused`);

    // 4) Files — override on path+name+size, skip byte-identical, else create. Stream bytes.
    await step('files', 'running');
    let fi = 0;
    for await (const fl of iterateExport(baseUrl, token, 'files')) {
      fi++;
      const vId = vendorMap.get(String(fl.vendorId));
      const bId = bucketMap.get(String(fl.bucketId));
      if (!vId || !bId) {
        inc('files', 'skipped');
        continue;
      }
      const folderId = fl.folderId ? folderMap.get(String(fl.folderId)) || null : null;
      touchedBuckets.add(bId);
      try {
        const match: any = await FileModel.findOne({
          vendorId: vId,
          bucketId: bId,
          folderId: folderId,
          originalName: fl.originalName,
          sizeBytes: fl.sizeBytes
        }).lean();
        const srcSha = (fl.checksum?.sha256 || '').toLowerCase();
        const mime = fl.mimeType || (mimeLookup(fl.originalName) as string) || 'application/octet-stream';

        if (match && match.checksum?.sha256 && srcSha && match.checksum.sha256.toLowerCase() === srcSha) {
          fileMap.set(String(fl._id), String(match._id)); // byte-identical
          inc('files', 'skipped');
        } else if (match) {
          // override: stream new bytes to a fresh key, then repoint the file
          const key = objectKey(vId, bId, String(match._id), `v${Date.now()}-${fl.originalName}`);
          const { sha256 } = await streamSourceFile(baseUrl, token, String(fl._id), key, fl.sizeBytes, mime);
          await FileModel.updateOne(
            { _id: match._id },
            { $set: { storageKey: key, sizeBytes: fl.sizeBytes, mimeType: mime, checksum: { sha256, md5: '' }, status: 'ready' } }
          );
          fileMap.set(String(fl._id), String(match._id));
          inc('files', 'overridden');
          inc('files', 'bytes', fl.sizeBytes);
        } else {
          const created: any = await FileModel.create({
            vendorId: vId,
            bucketId: bId,
            folderId,
            originalName: fl.originalName,
            storageKey: `migrating-${new mongoose.Types.ObjectId()}`,
            extension: (fl.originalName.split('.').pop() || '').toLowerCase(),
            mimeType: mime,
            sizeBytes: 0,
            tags: fl.tags || [],
            status: 'uploading',
            uploadSource: 'api',
            metadata: { ...(fl.metadata || {}), sourceFileId: String(fl._id) }
          });
          const key = objectKey(vId, bId, String(created._id), fl.originalName);
          const { sha256 } = await streamSourceFile(baseUrl, token, String(fl._id), key, fl.sizeBytes, mime);
          await FileModel.updateOne(
            { _id: created._id },
            { $set: { storageKey: key, sizeBytes: fl.sizeBytes, mimeType: mime, checksum: { sha256, md5: '' }, status: 'ready' } }
          );
          fileMap.set(String(fl._id), String(created._id));
          inc('files', 'added');
          inc('files', 'bytes', fl.sizeBytes);
        }
      } catch (e) {
        inc('files', 'failed');
        log(job, 'error', `file ${fl.originalName}: ${msg(e)}`);
      }
      if (fi % 5 === 0) {
        job.currentItem = `file ${fi}: ${fl.originalName}`;
        job.heartbeatAt = new Date();
        await job.save();
      }
    }
    await step('files', 'completed', `${R.files?.added || 0} added · ${R.files?.overridden || 0} overridden · ${R.files?.skipped || 0} skipped · ${R.files?.failed || 0} failed`);

    // 5) Users — by email (copy password hash). 6) API keys — by keyHash.
    await step('accounts', 'running');
    for await (const u of iterateExport(baseUrl, token, 'users')) {
      try {
        if (await User.findOne({ email: u.email }).select('_id').lean()) {
          inc('users', 'skipped');
          continue;
        }
        const vId = u.vendorId ? vendorMap.get(String(u.vendorId)) || null : null;
        await User.create({
          vendorId: vId,
          email: u.email,
          name: u.name || '',
          passwordHash: u.passwordHash,
          role: u.role,
          permissions: u.permissions || [],
          status: u.status || 'active'
        });
        inc('users', 'added');
      } catch (e) {
        log(job, 'error', `user ${u.email}: ${msg(e)}`);
      }
    }
    for await (const k of iterateExport(baseUrl, token, 'apikeys')) {
      try {
        const vId = vendorMap.get(String(k.vendorId));
        if (!vId) continue;
        if (await ApiKey.findOne({ keyHash: k.keyHash }).select('_id').lean()) {
          inc('apikeys', 'skipped');
          continue;
        }
        const bucketIds = (k.bucketIds || []).map((b: any) => bucketMap.get(String(b))).filter(Boolean);
        await ApiKey.create({
          vendorId: vId,
          name: k.name,
          keyHash: k.keyHash,
          prefix: k.prefix,
          permissions: k.permissions || [],
          bucketIds,
          status: k.status || 'active',
          expiresAt: k.expiresAt || null
        });
        inc('apikeys', 'added');
      } catch (e) {
        log(job, 'error', `apikey ${k.prefix}: ${msg(e)}`);
      }
    }
    await step('accounts', 'completed', `${R.users?.added || 0} users · ${R.apikeys?.added || 0} keys`);

    // 7) Links — by token (remap fileId).
    await step('links', 'running');
    for await (const l of iterateExport(baseUrl, token, 'links')) {
      try {
        const vId = vendorMap.get(String(l.vendorId));
        const fId = fileMap.get(String(l.fileId));
        if (!vId || !fId) {
          inc('links', 'skipped');
          continue;
        }
        if (await Link.findOne({ token: l.token }).select('_id').lean()) {
          inc('links', 'skipped');
          continue;
        }
        await Link.create({
          vendorId: vId,
          fileId: fId,
          type: l.type,
          token: l.token,
          expiresAt: l.expiresAt || null,
          maxDownloads: l.maxDownloads ?? null,
          downloadCount: l.downloadCount || 0,
          requiredScope: l.requiredScope || 'file:download',
          passwordHash: l.passwordHash || null,
          status: l.status || 'active',
          note: l.note || ''
        });
        inc('links', 'added');
      } catch (e) {
        log(job, 'error', `link ${l.token}: ${msg(e)}`);
      }
    }
    await step('links', 'completed', `${R.links?.added || 0} added · ${R.links?.skipped || 0} skipped`);

    // 8) Plans, payments, settings, analytics.
    await step('billing', 'running');
    for await (const pl of iterateExport(baseUrl, token, 'plans')) {
      try {
        if (await Plan.findOne({ code: pl.code }).select('_id').lean()) {
          inc('plans', 'skipped');
          continue;
        }
        await Plan.create({ code: pl.code, name: pl.name, description: pl.description, priceInr: pl.priceInr, interval: pl.interval, limits: pl.limits, active: pl.active, sortOrder: pl.sortOrder });
        inc('plans', 'added');
      } catch (e) {
        log(job, 'error', `plan ${pl.code}: ${msg(e)}`);
      }
    }
    for await (const pay of iterateExport(baseUrl, token, 'payments')) {
      try {
        const vId = vendorMap.get(String(pay.vendorId));
        if (!vId) continue;
        if (pay.gatewayOrderId && (await Payment.findOne({ gatewayOrderId: pay.gatewayOrderId }).select('_id').lean())) {
          inc('payments', 'skipped');
          continue;
        }
        await Payment.create({
          vendorId: vId,
          planCode: pay.planCode,
          gateway: pay.gateway,
          amountInr: pay.amountInr,
          currency: pay.currency,
          interval: pay.interval,
          status: pay.status,
          gatewayOrderId: pay.gatewayOrderId || '',
          gatewayPaymentId: pay.gatewayPaymentId || '',
          gatewayRef: pay.gatewayRef || '',
          periodStart: pay.periodStart || null,
          periodEnd: pay.periodEnd || null,
          raw: pay.raw || {}
        });
        inc('payments', 'added');
      } catch (e) {
        log(job, 'error', `payment: ${msg(e)}`);
      }
    }
    for await (const s of iterateExport(baseUrl, token, 'platformsettings')) {
      try {
        if (await PlatformSettings.findOne({ key: s.key }).select('_id').lean()) {
          inc('settings', 'skipped'); // don't clobber the target's own config
          continue;
        }
        const value: any = s.value;
        if (s.key === 'payments' && value) {
          if (value.razorpay?.keySecret) value.razorpay.keySecret = encryptSecret(String(value.razorpay.keySecret));
          if (value.phonepe?.saltKey) value.phonepe.saltKey = encryptSecret(String(value.phonepe.saltKey));
        }
        if (s.key === 'smtp' && value?.pass) value.pass = encryptSecret(String(value.pass));
        await PlatformSettings.create({ key: s.key, value });
        inc('settings', 'added');
      } catch (e) {
        log(job, 'error', `setting ${s.key}: ${msg(e)}`);
      }
    }
    // Audit logs + JWT revocations (idempotent by _id / jti).
    for await (const a of iterateExport(baseUrl, token, 'auditlogs')) {
      try {
        const vId = a.vendorId ? vendorMap.get(String(a.vendorId)) || null : null;
        await AuditLog.collection.insertOne({
          ...a,
          _id: new mongoose.Types.ObjectId(String(a._id)),
          vendorId: vId ? new mongoose.Types.ObjectId(vId) : null,
          createdAt: a.createdAt ? new Date(a.createdAt) : new Date()
        });
        inc('auditlogs', 'added');
      } catch {
        /* dup _id on re-run — ignore */
      }
    }
    for await (const jr of iterateExport(baseUrl, token, 'jwtrevocations')) {
      try {
        const vId = jr.vendorId ? vendorMap.get(String(jr.vendorId)) || null : null;
        if (await JwtRevocation.findOne({ jti: jr.jti }).select('_id').lean()) continue;
        await JwtRevocation.create({ jti: jr.jti, vendorId: vId, subject: jr.subject || '', expiresAt: jr.expiresAt || null });
        inc('jwtrevocations', 'added');
      } catch {
        /* ignore */
      }
    }
    await step('billing', 'completed', `${R.plans?.added || 0} plans · ${R.payments?.added || 0} payments · ${R.settings?.added || 0} settings · ${R.auditlogs?.added || 0} logs`);

    // Reconcile counters for every bucket we touched + each vendor.
    for (const bId of touchedBuckets) {
      const agg = await FileModel.aggregate([
        { $match: { bucketId: new mongoose.Types.ObjectId(bId), status: 'ready' } },
        { $group: { _id: null, bytes: { $sum: '$sizeBytes' }, count: { $sum: 1 } } }
      ]);
      await Bucket.updateOne({ _id: bId }, { $set: { storageBytes: agg[0]?.bytes || 0, fileCount: agg[0]?.count || 0 } });
    }
    for (const vId of new Set(vendorMap.values())) {
      const agg = await FileModel.aggregate([
        { $match: { vendorId: new mongoose.Types.ObjectId(vId), status: { $in: ['ready', 'trashed'] } } },
        { $group: { _id: null, bytes: { $sum: '$sizeBytes' }, count: { $sum: 1 } } }
      ]);
      await Vendor.updateOne({ _id: vId }, { $set: { 'usage.storageBytes': agg[0]?.bytes || 0, 'usage.fileCount': agg[0]?.count || 0 } });
    }

    job.status = 'completed';
    job.progress = 100;
    job.finishedAt = new Date();
    log(job, 'info', 'Full migration complete.');
    await job.save();
  } catch (e) {
    job.status = 'failed';
    job.error = msg(e);
    job.finishedAt = new Date();
    log(job, 'error', `Full migration failed: ${msg(e)}`);
    await job.save();
  }
}
