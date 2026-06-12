import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { forbidden, notFound, unauthorized, suspended } from '@/lib/http';
import { audit } from '@/lib/audit';
import { storage } from '@/lib/storage';
import { FileModel } from '@/models/File';

export const runtime = 'nodejs';

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
  const url = await storage.presignedGet(file.storageKey, 300, file.originalName);
  await audit(p, req, {
    action: 'file.download',
    resourceType: 'file',
    resourceId: String(file._id)
  });
  return NextResponse.redirect(url, 302);
}
