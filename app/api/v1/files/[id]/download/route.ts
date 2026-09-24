import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { forbidden, internalError, isObjectIdHex, notFound, unauthorized, suspended } from '@/lib/http';
import { audit } from '@/lib/audit';
import { getObjectCached } from '@/lib/cache';
import { FileModel } from '@/models/File';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (p.vendorStatus === 'suspended') return suspended();
  if (!isObjectIdHex(params.id)) return notFound('file not found');
  await dbConnect();
  const file = await FileModel.findOne({
    _id: params.id,
    vendorId: p.vendorId,
    status: 'ready'
  }).lean();
  if (!file) return notFound('file not found');
  if (!can(p, 'file:download', { vendorId: p.vendorId, bucketId: String(file.bucketId) }))
    return forbidden();

  // Stream through the app — the object store is internal (127.0.0.1) and a
  // presigned redirect would be unreachable by external API clients. Served from
  // the VPS cache on a hit (see lib/cache.ts); falls back to storage on a fault.
  let obj;
  try {
    obj = await getObjectCached(file.storageKey, {
      mimeType: file.mimeType,
      sizeHint: file.sizeBytes
    });
  } catch {
    // The DB row exists but the storage object is unreadable/missing (orphaned
    // row, out-of-band deletion). Return a clear JSON 500 rather than letting the
    // throw become an opaque empty-body 500 the client can't parse.
    return internalError('The file could not be read from storage.');
  }
  await audit(p, req, { action: 'file.download', resourceType: 'file', resourceId: String(file._id) });

  const fileName = (file.originalName.split(/[\\/]/).pop() || 'download').replace(/"/g, '');
  const headers: Record<string, string> = {
    'content-type': obj.contentType || file.mimeType || 'application/octet-stream',
    'content-disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
    'cache-control': 'private, no-store'
  };
  const len = obj.contentLength ?? file.sizeBytes;
  if (len) headers['content-length'] = String(len);
  const node = obj.stream as any;
  req.signal.addEventListener('abort', () => node?.destroy?.());
  const web = Readable.toWeb(node) as ReadableStream<Uint8Array>;
  return new NextResponse(web, { status: 200, headers });
}
