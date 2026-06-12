import Link from 'next/link';
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
  let v = b / 1024,
    i = 0;
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
  const [vendor, buckets, fileCount] = await Promise.all([
    Vendor.findById(session.vendor.id).lean() as any,
    Bucket.find({ vendorId: session.vendor.id }).sort({ name: 1 }).lean(),
    FileModel.countDocuments({ vendorId: session.vendor.id, status: 'ready' })
  ]);
  if (!vendor) return null;
  const usedPct =
    vendor.limits.maxStorageBytes > 0
      ? Math.min(100, (vendor.usage.storageBytes / vendor.limits.maxStorageBytes) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-white">Welcome back</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Buckets" value={String(buckets.length)} />
        <Stat label="Files" value={String(fileCount)} />
        <Stat label="Storage" value={fmtBytes(vendor.usage.storageBytes)} />
        <Stat label="Quota" value={`${usedPct.toFixed(0)}%`} />
      </div>

      <div className="card">
        <div className="mb-2 text-xs text-gray-400">
          {fmtBytes(vendor.usage.storageBytes)} of {fmtBytes(vendor.limits.maxStorageBytes)} used
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[#1c1c20]">
          <div
            className={`h-full rounded-full ${usedPct > 90 ? 'bg-danger' : usedPct > 70 ? 'bg-warning' : 'bg-accent'}`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
      </div>

      {/* Your storage */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold text-white">Your files</h2>
          <Link href="/dashboard/buckets" className="text-xs text-accent hover:underline">
            Manage buckets →
          </Link>
        </div>

        {buckets.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 py-10 text-center">
            <div className="text-3xl">📂</div>
            <p className="text-sm text-gray-400">You don&apos;t have any buckets yet.</p>
            <Link href="/dashboard/buckets" className="btn">
              Create your first bucket
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {buckets.map((b: any) => (
              <Link
                key={String(b._id)}
                href={`/dashboard/buckets/${b._id}`}
                className="card group transition hover:border-accent/50 hover:bg-[#16161a]"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-xl">📁</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-white">{b.name}</div>
                    <div className="text-[11px] text-gray-500">
                      {b.fileCount} files · {fmtBytes(b.storageBytes)}
                    </div>
                  </div>
                  {b.isPublic ? <span className="chip-warning">public</span> : <span className="chip">private</span>}
                </div>
                <div className="mt-2 text-[11px] text-accent opacity-0 transition group-hover:opacity-100">
                  Open file manager →
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}
