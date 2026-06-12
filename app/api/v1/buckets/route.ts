import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import {
  badRequest,
  forbidden,
  jsonOk,
  safeParseJson,
  unauthorized
} from '@/lib/http';
import { createBucketSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { Bucket } from '@/models/Bucket';
import { Vendor } from '@/models/Vendor';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden('Vendor-only endpoint');
  if (!can(p, 'bucket:read', { vendorId: p.vendorId })) return forbidden();
  await dbConnect();
  const items = await Bucket.find({ vendorId: p.vendorId }).sort({ name: 1 }).lean();
  return jsonOk({ items });
}

export async function POST(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!p.vendorId) return forbidden('Vendor-only endpoint');
  if (!can(p, 'bucket:create', { vendorId: p.vendorId })) return forbidden();
  const body = await safeParseJson(req);
  const parsed = createBucketSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });

  await dbConnect();
  const vendor = await Vendor.findById(p.vendorId).lean();
  if (!vendor) return forbidden();
  const count = await Bucket.countDocuments({ vendorId: p.vendorId });
  if (vendor.limits.maxBuckets && count >= vendor.limits.maxBuckets) {
    return badRequest('Bucket limit reached');
  }
  const existing = await Bucket.findOne({ vendorId: p.vendorId, name: parsed.data.name });
  if (existing) return badRequest('Bucket name already exists');

  const bucket = await Bucket.create({
    vendorId: p.vendorId,
    name: parsed.data.name,
    description: parsed.data.description || '',
    isPublic: !!parsed.data.isPublic,
    settings: {
      allowedMimeTypes: parsed.data.settings?.allowedMimeTypes || [],
      maxFileSizeBytes: parsed.data.settings?.maxFileSizeBytes || 0
    },
    createdBy: p.userId || null
  });

  // Close the count-then-create race: re-verify after insert and roll back if
  // concurrent creates pushed the vendor over the limit.
  if (vendor.limits.maxBuckets) {
    const n = await Bucket.countDocuments({ vendorId: p.vendorId });
    if (n > vendor.limits.maxBuckets) {
      await Bucket.deleteOne({ _id: bucket._id });
      return badRequest('Bucket limit reached');
    }
  }

  await audit(p, req, {
    action: 'bucket.create',
    resourceType: 'bucket',
    resourceId: String(bucket._id)
  });
  return jsonOk(bucket, 201);
}
