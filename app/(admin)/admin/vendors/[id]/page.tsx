import { dbConnect } from '@/lib/db';
import { Vendor } from '@/models/Vendor';
import { Bucket } from '@/models/Bucket';
import { FileModel } from '@/models/File';
import VendorActions from './actions';

export const dynamic = 'force-dynamic';

export default async function VendorDetailPage({ params }: { params: { id: string } }) {
  await dbConnect();
  const v = await Vendor.findById(params.id).lean();
  if (!v) return <div className="text-gray-400">Vendor not found.</div>;
  const [bucketCount, fileCount] = await Promise.all([
    Bucket.countDocuments({ vendorId: v._id }),
    FileModel.countDocuments({ vendorId: v._id, status: 'ready' })
  ]);
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold text-white">{v.name}</h1>
          <div className="font-mono text-xs text-gray-500">{v.slug}</div>
        </div>
        <VendorActions vendorId={String(v._id)} status={v.status} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Status" value={v.status} />
        <Stat label="Plan" value={v.plan} />
        <Stat label="Buckets" value={String(bucketCount)} />
        <Stat label="Files" value={String(fileCount)} />
      </div>

      <div className="card space-y-3">
        <div className="text-sm font-medium text-white">Limits</div>
        <pre className="overflow-x-auto rounded bg-[#0e0e10] p-3 text-xs text-gray-300">
{JSON.stringify(v.limits, null, 2)}
        </pre>
        <div className="text-sm font-medium text-white">Usage</div>
        <pre className="overflow-x-auto rounded bg-[#0e0e10] p-3 text-xs text-gray-300">
{JSON.stringify(v.usage, null, 2)}
        </pre>
        {v.suspendedReason && (
          <div className="text-xs text-danger">Suspended reason: {v.suspendedReason}</div>
        )}
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
