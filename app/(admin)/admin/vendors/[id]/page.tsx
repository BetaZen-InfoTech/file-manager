import { dbConnect } from '@/lib/db';
import { Vendor } from '@/models/Vendor';
import { Bucket } from '@/models/Bucket';
import { FileModel } from '@/models/File';
import VendorActions from './actions';

export const dynamic = 'force-dynamic';

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n,
    i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export default async function VendorDetailPage({ params }: { params: { id: string } }) {
  await dbConnect();
  const v: any = await Vendor.findById(params.id).lean();
  if (!v) return <div className="text-gray-400">Vendor not found.</div>;
  const [bucketCount, fileCount] = await Promise.all([
    Bucket.countDocuments({ vendorId: v._id }),
    FileModel.countDocuments({ vendorId: v._id, status: 'ready' })
  ]);

  const limits = v.limits || {};
  const usage = v.usage || {};
  const maxStorage = limits.maxStorageBytes || 0;
  const usedStorage = usage.storageBytes || 0;
  const pct = maxStorage ? Math.min(100, Math.round((usedStorage / maxStorage) * 100)) : 0;
  const planColors: Record<string, string> = {
    free: 'bg-[#1c1c20] text-gray-300',
    pro: 'bg-accent/15 text-accent',
    enterprise: 'bg-emerald-500/15 text-emerald-300'
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-white">{v.name}</h1>
            {v.status === 'active' ? (
              <span className="chip-success">active</span>
            ) : v.status === 'suspended' ? (
              <span className="chip-danger">suspended</span>
            ) : (
              <span className="chip">{v.status}</span>
            )}
          </div>
          <div className="font-mono text-xs text-gray-500">{v.slug}</div>
        </div>
        <VendorActions vendorId={String(v._id)} status={v.status} name={v.name} />
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Plan">
          <span className={`rounded-md px-2 py-0.5 text-sm font-semibold capitalize ${planColors[v.plan] || 'bg-[#1c1c20] text-gray-300'}`}>
            {v.plan}
          </span>
        </Stat>
        <Stat label="Buckets">
          <span className="text-lg font-semibold text-white">
            {bucketCount}
            <span className="text-xs text-gray-500"> / {limits.maxBuckets ?? '∞'}</span>
          </span>
        </Stat>
        <Stat label="Files">
          <span className="text-lg font-semibold text-white">{fileCount}</span>
        </Stat>
        <Stat label="API keys">
          <span className="text-lg font-semibold text-white">
            <span className="text-xs text-gray-500">max </span>
            {limits.maxApiKeys ?? '∞'}
          </span>
        </Stat>
      </div>

      {/* storage usage */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-white">Storage</span>
          <span className="text-xs text-gray-400">
            {fmtBytes(usedStorage)} <span className="text-gray-600">of</span> {fmtBytes(maxStorage)} · {pct}%
          </span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#1c1c20]">
          <div
            className={`h-full rounded-full transition-all ${pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-accent'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-4">
          <Mini label="Max file size" value={fmtBytes(limits.maxFileSizeBytes || 0)} />
          <Mini label="Max buckets" value={String(limits.maxBuckets ?? '∞')} />
          <Mini label="Max API keys" value={String(limits.maxApiKeys ?? '∞')} />
          <Mini label="Files stored" value={String(usage.fileCount ?? fileCount)} />
        </div>
      </div>

      {v.status === 'suspended' && v.suspendedReason && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          <span className="font-medium">Suspended:</span> {v.suspendedReason}
        </div>
      )}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-gray-200">{value}</div>
    </div>
  );
}
