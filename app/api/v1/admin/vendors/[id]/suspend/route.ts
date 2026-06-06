import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import {
  forbidden,
  jsonOk,
  notFound,
  safeParseJson,
  unauthorized,
  badRequest
} from '@/lib/http';
import { suspendVendorSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { Vendor } from '@/models/Vendor';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:vendor:suspend')) return forbidden();
  const body = await safeParseJson(req);
  const parsed = suspendVendorSchema.safeParse(body ?? {});
  if (!parsed.success) return badRequest('Invalid input');
  await dbConnect();
  const v = await Vendor.findByIdAndUpdate(
    params.id,
    { $set: { status: 'suspended', suspendedReason: parsed.data.reason || '' } },
    { new: true }
  );
  if (!v) return notFound('vendor not found');
  await audit(p, req, {
    action: 'vendor.suspend',
    resourceType: 'vendor',
    resourceId: String(v._id),
    vendorId: String(v._id),
    meta: { reason: parsed.data.reason }
  });
  return jsonOk({ vendor: v });
}
