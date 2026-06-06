import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { forbidden, jsonOk, notFound, unauthorized } from '@/lib/http';
import { audit } from '@/lib/audit';
import { Vendor } from '@/models/Vendor';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:vendor:suspend')) return forbidden();
  await dbConnect();
  const v = await Vendor.findByIdAndUpdate(
    params.id,
    { $set: { status: 'active', suspendedReason: null } },
    { new: true }
  );
  if (!v) return notFound('vendor not found');
  await audit(p, req, {
    action: 'vendor.activate',
    resourceType: 'vendor',
    resourceId: String(v._id),
    vendorId: String(v._id)
  });
  return jsonOk({ vendor: v });
}
