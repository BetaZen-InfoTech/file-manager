import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import {
  badRequest,
  forbidden,
  isObjectIdHex,
  jsonOk,
  notFound,
  safeParseJson,
  unauthorized
} from '@/lib/http';
import { createFolderSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { Folder } from '@/models/Folder';
import { Bucket } from '@/models/Bucket';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { bid: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (!can(p, 'file:list', { vendorId: p.vendorId, bucketId: params.bid })) return forbidden();
  if (!isObjectIdHex(params.bid)) return notFound('bucket not found');
  await dbConnect();
  const url = new URL(req.url);
  const showHidden = url.searchParams.get('showHidden') === 'true';
  const parentId = url.searchParams.get('parentId') || null;
  if (parentId && !isObjectIdHex(parentId)) return badRequest('invalid parentId');
  // Confirm bucket ownership (else a foreign/unknown bucket lists as 200-empty).
  const ownBucket = await Bucket.findOne({ _id: params.bid, vendorId: p.vendorId }).select('_id').lean();
  if (!ownBucket) return notFound('bucket not found');
  const filter: any = { vendorId: p.vendorId, bucketId: params.bid, parentId: parentId };
  if (!showHidden) filter.isHidden = { $ne: true };
  const items = await Folder.find(filter).sort({ name: 1 }).lean();
  return jsonOk({ items });
}

export async function POST(req: NextRequest, { params }: { params: { bid: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden();
  if (!can(p, 'folder:create', { vendorId: p.vendorId, bucketId: params.bid })) return forbidden();
  if (!isObjectIdHex(params.bid)) return notFound('bucket not found');
  const body = await safeParseJson(req);
  const parsed = createFolderSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input');
  await dbConnect();
  const bucket = await Bucket.findOne({ _id: params.bid, vendorId: p.vendorId });
  if (!bucket) return notFound('bucket not found');
  let parentPath = '/';
  if (parsed.data.parentId) {
    if (!isObjectIdHex(parsed.data.parentId)) return badRequest('invalid id');
    const parent = await Folder.findOne({
      _id: parsed.data.parentId,
      vendorId: p.vendorId,
      bucketId: params.bid
    });
    if (!parent) return badRequest('Parent folder not found');
    parentPath = parent.path === '/' ? `/${parent.name}` : `${parent.path}/${parent.name}`;
  }
  const folder = await Folder.create({
    vendorId: p.vendorId,
    bucketId: params.bid,
    name: parsed.data.name,
    parentId: parsed.data.parentId || null,
    path: parentPath,
    createdBy: p.userId || null
  });
  await audit(p, req, {
    action: 'folder.create',
    resourceType: 'folder',
    resourceId: String(folder._id)
  });
  return jsonOk(folder, 201);
}
