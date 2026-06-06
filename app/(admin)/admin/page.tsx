import { dbConnect } from '@/lib/db';
import { Vendor } from '@/models/Vendor';
import { FileModel } from '@/models/File';

export const dynamic = 'force-dynamic';

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(2)} ${units[i]}`;
}

export default async function AdminDashboardPage() {
  await dbConnect();
  const [vendors, suspended, agg, files] = await Promise.all([
    Vendor.countDocuments({}),
    Vendor.countDocuments({ status: 'suspended' }),
    Vendor.aggregate([
      { $group: { _id: null, storage: { $sum: '$usage.storageBytes' } } }
    ]),
    FileModel.countDocuments({ status: 'ready' })
  ]);
  const storage = agg[0]?.storage || 0;

  const stats = [
    { label: 'Vendors', value: vendors },
    { label: 'Suspended', value: suspended },
    { label: 'Files', value: files },
    { label: 'Storage', value: fmtBytes(storage) }
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-white">Platform overview</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <div className="text-xs uppercase tracking-wide text-gray-400">{s.label}</div>
            <div className="mt-1 text-xl font-semibold text-white">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
