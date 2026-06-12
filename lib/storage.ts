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
import { Readable } from 'stream';
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
  deleteObject(key: string): Promise<void>;
  presignedGet(key: string, expirySeconds: number, fileName?: string): Promise<string>;
  initMultipart(key: string, mimeType: string): Promise<string>;
  uploadPart(key: string, uploadId: string, partNumber: number, body: Buffer): Promise<string>;
  completeMultipart(
    key: string,
    uploadId: string,
    parts: { ETag: string; PartNumber: number }[]
  ): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
}

function makeS3(): { client: S3Client; bucket: string } {
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
    // `aws-chunked` / STREAMING-UNSIGNED-PAYLOAD-TRAILER encoding that DROPS
    // Content-Length — MinIO rejects that. WHEN_REQUIRED skips it so a raw
    // Readable streams with a literal Content-Length. (Buffer puts are
    // unaffected.) Unknown keys are ignored by older SDKs, so this is safe.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED'
  } as any);
  return { client, bucket: env.S3_DEFAULT_BUCKET };
}

const s3 = makeS3();

export const storage: StorageDriver = {
  driver: env.STORAGE_DRIVER,

  async ensureBucket() {
    try {
      await s3.client.send(new HeadBucketCommand({ Bucket: s3.bucket }));
    } catch {
      try {
        await s3.client.send(new CreateBucketCommand({ Bucket: s3.bucket }));
      } catch (err: any) {
        if (err?.name !== 'BucketAlreadyOwnedByYou' && err?.name !== 'BucketAlreadyExists') {
          throw err;
        }
      }
    }
  },

  async putObject(key, body, meta) {
    const res = await s3.client.send(
      new PutObjectCommand({
        Bucket: s3.bucket,
        Key: key,
        Body: body as Buffer,
        ContentType: meta.mimeType,
        ContentLength: body.byteLength
      })
    );
    return { etag: res.ETag || '', size: body.byteLength };
  },

  // Stream an object in with a KNOWN content length (no buffering, no temp
  // file). Used by server-to-server transfer. Verifies the stored size after.
  async putObjectStream(key, body, contentLength, meta) {
    await s3.client.send(
      new PutObjectCommand({
        Bucket: s3.bucket,
        Key: key,
        Body: body,
        ContentLength: contentLength,
        ContentType: meta.mimeType
      })
    );
    const head = await s3.client.send(new HeadObjectCommand({ Bucket: s3.bucket, Key: key }));
    if (typeof head.ContentLength === 'number' && head.ContentLength !== contentLength) {
      throw new Error(`stored size ${head.ContentLength} != expected ${contentLength}`);
    }
    return { etag: head.ETag || '', size: contentLength };
  },

  async getObject(key) {
    const res = await s3.client.send(new GetObjectCommand({ Bucket: s3.bucket, Key: key }));
    return {
      stream: res.Body as Readable,
      contentLength: res.ContentLength,
      contentType: res.ContentType
    };
  },

  async deleteObject(key) {
    await s3.client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key }));
  },

  async presignedGet(key, expirySeconds, fileName) {
    const cmd = new GetObjectCommand({
      Bucket: s3.bucket,
      Key: key,
      ...(fileName
        ? { ResponseContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"` }
        : {})
    });
    return getSignedUrl(s3.client, cmd, { expiresIn: expirySeconds });
  },

  async initMultipart(key, mimeType) {
    const res = await s3.client.send(
      new CreateMultipartUploadCommand({ Bucket: s3.bucket, Key: key, ContentType: mimeType })
    );
    return res.UploadId || '';
  },

  async uploadPart(key, uploadId, partNumber, body) {
    const res = await s3.client.send(
      new UploadPartCommand({
        Bucket: s3.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: body
      })
    );
    return res.ETag || '';
  },

  async completeMultipart(key, uploadId, parts) {
    await s3.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: s3.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts }
      })
    );
  },

  async abortMultipart(key, uploadId) {
    await s3.client.send(
      new AbortMultipartUploadCommand({ Bucket: s3.bucket, Key: key, UploadId: uploadId })
    );
  }
};

export function objectKey(
  vendorId: string,
  bucketId: string,
  fileId: string,
  originalName: string
): string {
  const safeName = originalName.replace(/[^\w.\-]/g, '_');
  return `vendors/${vendorId}/buckets/${bucketId}/${fileId}/${safeName}`;
}
