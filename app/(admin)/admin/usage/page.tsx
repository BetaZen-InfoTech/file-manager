import { dbConnect } from '@/lib/db';
import { Vendor } from '@/models/Vendor';

export const dynamic = 'force-dynamic';

export default async function UsagePage() {
  await dbConnect();
  const vendors = await Vendor.find({}).sort({ 'usage.storageBytes': -1 }).limit(50).lean();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-white">Usage by vendor</h1>
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
            {vendors.map((v) => {
              const pct =
                v.limits.maxStorageBytes > 0
                  ? Math.min(100, (v.usage.storageBytes / v.limits.maxStorageBytes) * 100)
                  : 0;
              return (
                <tr key={String(v._id)}>
                  <td className="font-medium">{v.name}</td>
                  <td className="font-mono text-xs">
                    {(v.usage.storageBytes / 1024 / 1024).toFixed(1)} MB
                  </td>
                  <td>{v.usage.fileCount}</td>
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
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
