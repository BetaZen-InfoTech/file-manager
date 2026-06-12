import Link from 'next/link';
import { dbConnect } from '@/lib/db';
import { Vendor } from '@/models/Vendor';
import { getServerSession } from '@/lib/session-server';
import { realUsageByVendor } from '@/lib/vendor-stats';
import { vendorDiskUsage } from '@/lib/server-fs';
import VendorsGrid from './vendors-grid';

export const dynamic = 'force-dynamic';

const FS_VENDOR_ROOT = process.env.FS_VENDOR_ROOT || '/var/www/vendors';

export default async function VendorsPage() {
  await dbConnect();
  const [items, usageMap, session] = await Promise.all([
    Vendor.find({}).sort({ createdAt: -1 }).limit(100).lean(),
    realUsageByVendor(),
    getServerSession()
  ]);
  const canImpersonate = session?.user.role === 'super_admin';
  const disks = await Promise.all(items.map((v: any) => vendorDiskUsage(String(v._id))));

  const vendors = items.map((v: any, i) => {
    const u = usageMap.get(String(v._id)) || { storageBytes: 0, fileCount: 0 };
    const disk = disks[i] || { bytes: 0, files: 0 };
    return {
      id: String(v._id),
      name: v.name,
      slug: v.slug,
      status: v.status as string,
      plan: v.plan as string,
      storageBytes: u.storageBytes,
      fileCount: u.fileCount,
      maxStorageBytes: v.limits?.maxStorageBytes || 0,
      diskBytes: disk.bytes,
      diskFiles: disk.files,
      folderPath: `${FS_VENDOR_ROOT}/${String(v._id)}`
    };
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Vendors</h1>
        <Link href="/admin/vendors/new" className="btn">
          New vendor
        </Link>
      </div>
      <VendorsGrid vendors={vendors} canImpersonate={canImpersonate} />
    </div>
  );
}
