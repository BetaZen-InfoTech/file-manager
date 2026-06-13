import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { forbidden, notFound, unauthorized, suspended } from '@/lib/http';
import { audit } from '@/lib/audit';
import { storage } from '@/lib/storage';
import { FileModel } from '@/models/File';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (p.vendorStatus === 'suspended') return suspended();
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
  // presigned redirect would be unreachable by external API clients.
  const obj = await storage.getObject(file.storageKey);
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
