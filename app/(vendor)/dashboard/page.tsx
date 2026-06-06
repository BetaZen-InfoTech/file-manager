import { getServerSession } from '@/lib/session-server';
import { dbConnect } from '@/lib/db';
import { Vendor } from '@/models/Vendor';
import { Bucket } from '@/models/Bucket';
import { FileModel } from '@/models/File';

export const dynamic = 'force-dynamic';

function fmtBytes(b: number): string {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(2)} ${u[i]}`;
}

export default async function VendorHomePage() {
  const session = await getServerSession();
  if (!session?.vendor) return null;
  await dbConnect();
  const [vendor, buckets, files] = await Promise.all([
    Vendor.findById(session.vendor.id).lean(),
    Bucket.countDocuments({ vendorId: session.vendor.id }),
    FileModel.countDocuments({ vendorId: session.vendor.id, status: 'ready' })
  ]);
  if (!vendor) return null;
  const usedPct =
    vendor.limits.maxStorageBytes > 0
      ? Math.min(100, (vendor.usage.storageBytes / vendor.limits.maxStorageBytes) * 100)
      : 0;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-white">Welcome back</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Buckets" value={String(buckets)} />
        <Stat label="Files" value={String(files)} />
        <Stat label="Storage" value={fmtBytes(vendor.usage.storageBytes)} />
        <Stat label="Quota %" value={`${usedPct.toFixed(0)}%`} />
      </div>
      <div className="card">
        <div className="mb-2 text-xs text-gray-400">
          {fmtBytes(vendor.usage.storageBytes)} of {fmtBytes(vendor.limits.maxStorageBytes)} used
        </div>
        <div className="h-2 overflow-hidden rounded bg-border">
          <div
            className={`h-full ${usedPct > 80 ? 'bg-danger' : 'bg-accent'}`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}
