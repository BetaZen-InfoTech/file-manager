import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { forbidden, jsonOk, notFound, unauthorized } from '@/lib/http';
import { audit } from '@/lib/audit';
import { storage } from '@/lib/storage';
import { FileModel } from '@/models/File';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { uploadId: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  await dbConnect();
  const draft = await FileModel.findOne({
    vendorId: p.vendorId,
    status: 'uploading',
    'metadata.uploadId': params.uploadId
  });
  if (!draft) return notFound('upload not found');
  await storage.abortMultipart(draft.storageKey, params.uploadId);
  draft.status = 'failed';
  await draft.save();
  await audit(p, req, {
    action: 'file.multipart.abort',
    resourceType: 'file',
    resourceId: String(draft._id)
  });
  return jsonOk({ ok: true });
}
