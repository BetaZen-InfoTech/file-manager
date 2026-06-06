import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import {
  badRequest,
  forbidden,
  jsonOk,
  notFound,
  safeParseJson,
  unauthorized
} from '@/lib/http';
import { updateVendorSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { Vendor } from '@/models/Vendor';
import { FileModel } from '@/models/File';
import { Bucket } from '@/models/Bucket';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:vendor:read')) return forbidden();
  await dbConnect();
  const v = await Vendor.findById(params.id).lean();
  if (!v) return notFound('vendor not found');
  const [bucketsCount, filesCount] = await Promise.all([
    Bucket.countDocuments({ vendorId: v._id }),
    FileModel.countDocuments({ vendorId: v._id, status: 'ready' })
  ]);
  return jsonOk({ vendor: v, stats: { buckets: bucketsCount, files: filesCount } });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:vendor:update')) return forbidden();
  const body = await safeParseJson(req);
  const parsed = updateVendorSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });
  await dbConnect();
  const update: any = {};
  if (parsed.data.name) update.name = parsed.data.name;
  if (parsed.data.plan) update.plan = parsed.data.plan;
  if (parsed.data.limits) {
    for (const [k, v] of Object.entries(parsed.data.limits)) update[`limits.${k}`] = v;
  }
  const v = await Vendor.findByIdAndUpdate(params.id, { $set: update }, { new: true });
  if (!v) return notFound('vendor not found');
  await audit(p, req, {
    action: 'vendor.update',
    resourceType: 'vendor',
    resourceId: String(v._id),
    vendorId: String(v._id),
    meta: update
  });
  return jsonOk({ vendor: v });
}
