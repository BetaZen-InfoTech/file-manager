import { dbConnect } from '@/lib/db';
import { Vendor } from '@/models/Vendor';
import { realUsageByVendor, fmtBytes } from '@/lib/vendor-stats';

export const dynamic = 'force-dynamic';

export default async function UsagePage() {
  await dbConnect();
  const [vendors, usageMap] = await Promise.all([
    Vendor.find({}).limit(100).lean(),
    realUsageByVendor()
  ]);
  // Sort by real storage used, descending.
  const rows = vendors
    .map((v: any) => {
      const u = usageMap.get(String(v._id)) || { storageBytes: 0, fileCount: 0 };
      const max = v.limits?.maxStorageBytes || 0;
      const pct = max > 0 ? Math.min(100, (u.storageBytes / max) * 100) : 0;
      return { v, u, max, pct };
    })
    .sort((a, b) => b.u.storageBytes - a.u.storageBytes);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-white">Usage by vendor</h1>
        <p className="mt-1 text-sm text-gray-400">Live figures aggregated from stored files.</p>
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Storage</th>
              <th>Files</th>
              <th>Quota %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ v, u, max, pct }) => (
              <tr key={String(v._id)}>
                <td className="font-medium">{v.name}</td>
                <td className="font-mono text-xs">
                  {fmtBytes(u.storageBytes)} <span className="text-gray-600">/ {fmtBytes(max)}</span>
                </td>
                <td>{u.fileCount}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded bg-border">
                      <div
                        className={`h-full ${pct > 80 ? 'bg-danger' : 'bg-accent'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs">{pct.toFixed(0)}%</span>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-sm text-gray-500">
                  No vendors yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
