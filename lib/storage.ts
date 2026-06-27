import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';
import fsp from 'fs/promises';
import nodePath from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { env } from './env';

export interface PutResult {
  etag: string;
  size: number;
}

export interface StorageDriver {
  driver: string;
  ensureBucket(): Promise<void>;
  putObject(key: string, body: Buffer | Uint8Array, meta: { mimeType: string }): Promise<PutResult>;
  putObjectStream(
    key: string,
    body: Readable,
    contentLength: number,
    meta: { mimeType: string }
  ): Promise<PutResult>;
  getObject(key: string): Promise<{ stream: Readable; contentLength?: number; contentType?: string }>;
  objectExists(key: string): Promise<boolean>;
  deleteObject(key: string): Promise<void>;
  presignedGet(key: string, expirySeconds: number, fileName?: string): Promise<string>;
  initMultipart(key: string, mimeType: string): Promise<string>;
  uploadPart(key: string, uploadId: string, partNumber: number, body: Buffer): Promise<string>;
  completeMultipart(
    key: string,
    uploadId: string,
    parts: { ETag: string; PartNumber: number }[]
  ): Promise<{ size: number }>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
}

// A "not found" error shaped like the AWS SDK's so callers that branch on
// `$metadata.httpStatusCode === 404` / name `NoSuchKey` work for BOTH drivers.
function notFoundErr(key: string): Error {
  const e: any = new Error(`object not found: ${key}`);
  e.name = 'NoSuchKey';
  e.$metadata = { httpStatusCode: 404 };
  return e;
}

// ===========================================================================
// S3 / MinIO driver
// ===========================================================================
function makeS3Storage(): StorageDriver {
  const client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY
    },
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    // CRITICAL for putObjectStream: newer AWS SDK v3 defaults to computing a
    // request checksum, which forces a streamed Readable body into an
    // `aws-chunked` encoding that DROPS Content-Length — MinIO rejects that.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED'
  } as any);
  const bucket = env.S3_DEFAULT_BUCKET;

  return {
    driver: env.STORAGE_DRIVER,

    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch {
        try {
          await client.send(new CreateBucketCommand({ Bucket: bucket }));
        } catch (err: any) {
          if (err?.name !== 'BucketAlreadyOwnedByYou' && err?.name !== 'BucketAlreadyExists') throw err;
        }
      }
    },

    async putObject(key, body, meta) {
      const res = await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body as Buffer,
          ContentType: meta.mimeType,
          ContentLength: body.byteLength
        })
      );
      return { etag: res.ETag || '', size: body.byteLength };
    },

    async putObjectStream(key, body, contentLength, meta) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentLength: contentLength,
          ContentType: meta.mimeType
        })
      );
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      if (typeof head.ContentLength === 'number' && head.ContentLength !== contentLength) {
        throw new Error(`stored size ${head.ContentLength} != expected ${contentLength}`);
      }
      return { etag: head.ETag || '', size: contentLength };
    },

    async getObject(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return {
        stream: res.Body as Readable,
        contentLength: res.ContentLength,
        contentType: res.ContentType
      };
    },

    async objectExists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (err: any) {
        const code = err?.$metadata?.httpStatusCode;
        if (code === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchKey') return false;
        throw err;
      }
    },

    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async presignedGet(key, expirySeconds, fileName) {
      const cmd = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(fileName
          ? { ResponseContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"` }
          : {})
      });
      return getSignedUrl(client, cmd, { expiresIn: expirySeconds });
    },

    async initMultipart(key, mimeType) {
      const res = await client.send(
        new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: mimeType })
      );
      return res.UploadId || '';
    },

    async uploadPart(key, uploadId, partNumber, body) {
      const res = await client.send(
        new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber, Body: body })
      );
      return res.ETag || '';
    },

    async completeMultipart(key, uploadId, parts) {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts }
        })
      );
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { size: typeof head.ContentLength === 'number' ? head.ContentLength : 0 };
    },

    async abortMultipart(key, uploadId) {
      await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
    }
  };
}

// ===========================================================================
// Disk driver — stores objects on the local filesystem under STORAGE_DISK_ROOT.
// The object key IS the path under the root, so with the default root /var/www
// a key "vendors/<vendorId>/buckets/<bucketId>/<fileId>/<name>" lands at
// /var/www/vendors/<vendorId>/... . No S3/MinIO required.
// ===========================================================================
function makeDiskStorage(): StorageDriver {
  const ROOT = nodePath.resolve(env.STORAGE_DISK_ROOT);
  const STAGING = nodePath.join(ROOT, '.fm-multipart');

  // Map a key to an absolute path, jailed inside ROOT (rejects traversal).
  function diskPath(key: string): string {
    if (!key || key.includes('\0')) throw new Error('invalid storage key');
    const abs = nodePath.resolve(ROOT, key.replace(/^\/+/, ''));
    if (abs !== ROOT && !abs.startsWith(ROOT + nodePath.sep)) throw new Error('storage key escapes root');
    return abs;
  }
  const stageDir = (uploadId: string) => nodePath.join(STAGING, uploadId.replace(/[^a-zA-Z0-9]/g, ''));
  const partFile = (uploadId: string, n: number) => nodePath.join(stageDir(uploadId), String(n).padStart(6, '0'));

  return {
    driver: 'disk',

    async ensureBucket() {
      await fsp.mkdir(ROOT, { recursive: true });
    },

    async putObject(key, body, _meta) {
      const fp = diskPath(key);
      await fsp.mkdir(nodePath.dirname(fp), { recursive: true });
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      await fsp.writeFile(fp, buf);
      return { etag: crypto.createHash('md5').update(buf).digest('hex'), size: buf.byteLength };
    },

    async putObjectStream(key, body, contentLength, _meta) {
      const fp = diskPath(key);
      await fsp.mkdir(nodePath.dirname(fp), { recursive: true });
      await pipeline(body, fs.createWriteStream(fp));
      const st = await fsp.stat(fp);
      if (typeof contentLength === 'number' && contentLength > 0 && st.size !== contentLength) {
        throw new Error(`stored size ${st.size} != expected ${contentLength}`);
      }
      return { etag: '', size: st.size };
    },

    async getObject(key) {
      const fp = diskPath(key);
      let st: fs.Stats;
      try {
        st = await fsp.stat(fp);
      } catch (e: any) {
        if (e?.code === 'ENOENT') throw notFoundErr(key);
        throw e;
      }
      return { stream: fs.createReadStream(fp), contentLength: st.size, contentType: undefined };
    },

    async objectExists(key) {
      try {
        await fsp.access(diskPath(key));
        return true;
      } catch {
        return false;
      }
    },

    async deleteObject(key) {
      await fsp.rm(diskPath(key), { force: true }).catch(() => {});
    },

    async presignedGet() {
      // Disk has no presigned URLs; callers stream through the app (getObject).
      throw new Error('presignedGet is not supported by the disk storage driver');
    },

    async initMultipart(_key, _mimeType) {
      const uploadId = crypto.randomBytes(16).toString('hex');
      await fsp.mkdir(stageDir(uploadId), { recursive: true });
      return uploadId;
    },

    async uploadPart(_key, uploadId, partNumber, body) {
      const pf = partFile(uploadId, partNumber);
      await fsp.mkdir(nodePath.dirname(pf), { recursive: true });
      await fsp.writeFile(pf, body);
      return crypto.createHash('md5').update(body).digest('hex');
    },

    async completeMultipart(key, uploadId, parts) {
      const fp = diskPath(key);
      await fsp.mkdir(nodePath.dirname(fp), { recursive: true });
      const ordered = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);
      const ws = fs.createWriteStream(fp);
      try {
        for (const p of ordered) {
          await new Promise<void>((resolve, reject) => {
            const rs = fs.createReadStream(partFile(uploadId, p.PartNumber));
            rs.on('error', reject);
            rs.on('end', resolve);
            rs.pipe(ws, { end: false });
          });
        }
      } finally {
        await new Promise<void>((resolve, reject) => {
          ws.end();
          ws.on('finish', () => resolve());
          ws.on('error', reject);
        });
      }
      await fsp.rm(stageDir(uploadId), { recursive: true, force: true }).catch(() => {});
      const st = await fsp.stat(fp);
      return { size: st.size };
    },

    async abortMultipart(_key, uploadId) {
      await fsp.rm(stageDir(uploadId), { recursive: true, force: true }).catch(() => {});
    }
  };
}

export const storage: StorageDriver =
  env.STORAGE_DRIVER === 'disk' ? makeDiskStorage() : makeS3Storage();

export function objectKey(
  vendorId: string,
  bucketId: string,
  fileId: string,
  originalName: string
): string {
  const safeName = originalName.replace(/[^\w.\-]/g, '_');
  return `vendors/${vendorId}/buckets/${bucketId}/${fileId}/${safeName}`;
}
