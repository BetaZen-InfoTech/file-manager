import { NextRequest } from 'next/server';
import { Readable } from 'stream';
import { dbConnect } from '@/lib/db';
import { notFound, unauthorized } from '@/lib/http';
import { verifyTransferToken } from '@/lib/transfer-token';
import { storage } from '@/lib/storage';
import { FileModel } from '@/models/File';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// SOURCE raw byte stream for one file. Streams from object storage straight
// through the app over the public domain (no zip, no buffer) — the only way
// the destination can fetch bytes, since presigned MinIO URLs are 127.0.0.1.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const tok = await verifyTransferToken(req);
  if (!tok) return unauthorized('invalid transfer token');

  await dbConnect();
  const filter: any = { _id: params.id, status: 'ready' };
  if (tok.kind === 'vendor' && tok.vendorId) filter.vendorId = tok.vendorId; // per-file scope IN query
  if (tok.bucketIds && tok.bucketIds.length) filter.bucketId = { $in: tok.bucketIds };

  const file: any = await FileModel.findOne(filter).lean();
  if (!file) return notFound('file not found');

  let got;
  try {
    got = await storage.getObject(file.storageKey);
  } catch (err: any) {
    const code = err?.$metadata?.httpStatusCode;
    if (code === 404 || err?.name === 'NoSuchKey' || err?.name === 'NotFound') {
      // The object is gone from storage (e.g. a shared-DB key repoint). Return a
      // clean 404 so the caller can distinguish "missing" from a transient fault.
      return notFound('file object not found in storage');
    }
    throw err;
  }
  const { contentLength, contentType } = got;
  const node = got.stream as Readable;

  // If S3 errors mid-stream the headers are already sent — just tear down cleanly.
  node.on('error', () => {
    try {
      node.destroy();
    } catch {
      /* ignore */
    }
  });

  // Destroy the upstream S3 socket if the client disconnects mid-stream.
  req.signal.addEventListener('abort', () => {
    try {
      node.destroy();
    } catch {
      /* ignore */
    }
  });

  // Use Readable.toWeb for a proper WHATWG ReadableStream (type-safe + driver-
  // agnostic). Streams lazily with backpressure; never buffers the whole file.
  const webStream = Readable.toWeb(node) as ReadableStream<Uint8Array>;

  const headers: Record<string, string> = {
    'content-type': contentType || file.mimeType || 'application/octet-stream',
    'cache-control': 'no-store',
    'content-encoding': 'identity'
  };
  // Prefer the REAL object size from S3 (authoritative); DB sizeBytes is only a
  // fallback — never the other way around (avoids content-length mismatch).
  const len = contentLength ?? file.sizeBytes;
  if (len != null) headers['content-length'] = String(len);
  if (file.checksum?.sha256) headers['x-fm-sha256'] = file.checksum.sha256; // advisory
  headers['x-fm-size'] = String(file.sizeBytes);

  return new Response(webStream, { headers });
}
