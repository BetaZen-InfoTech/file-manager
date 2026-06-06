import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { forbidden, jsonOk, unauthorized } from '@/lib/http';
import { Vendor } from '@/models/Vendor';
import { FileModel } from '@/models/File';
import { Bucket } from '@/models/Bucket';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:usage:read')) return forbidden();
  await dbConnect();
  const [vendorAgg, fileCount, bucketCount] = await Promise.all([
    Vendor.aggregate([
      {
        $group: {
          _id: null,
          totalStorage: { $sum: '$usage.storageBytes' },
          totalFiles: { $sum: '$usage.fileCount' },
          vendorCount: { $sum: 1 },
          suspended: { $sum: { $cond: [{ $eq: ['$status', 'suspended'] }, 1, 0] } }
        }
      }
    ]),
    FileModel.countDocuments({ status: 'ready' }),
    Bucket.countDocuments({})
  ]);
  return jsonOk({
    storage: vendorAgg[0]?.totalStorage || 0,
    files: fileCount,
    buckets: bucketCount,
    vendors: vendorAgg[0]?.vendorCount || 0,
    suspendedVendors: vendorAgg[0]?.suspended || 0
  });
}
