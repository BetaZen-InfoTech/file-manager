import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import {
  badRequest,
  forbidden,
  jsonOk,
  notFound,
  unauthorized,
  suspended
} from '@/lib/http';
import { storage } from '@/lib/storage';
import { FileModel } from '@/models/File';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function PUT(
  req: NextRequest,
  { params }: { params: { uploadId: string; n: string } }
) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (p.vendorStatus === 'suspended') return suspended();
  const partNumber = Number(params.n);
  if (!Number.isFinite(partNumber) || partNumber < 1 || partNumber > 10_000)
    return badRequest('invalid part number');
  await dbConnect();
  const draft = await FileModel.findOne({
    vendorId: p.vendorId,
    status: 'uploading',
    'metadata.uploadId': params.uploadId
  });
  if (!draft) return notFound('upload not found');
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) return badRequest('empty body');
  const etag = await storage.uploadPart(draft.storageKey, params.uploadId, partNumber, buf);
  return jsonOk({ etag, partNumber, size: buf.length });
}
