import Link from 'next/link';
import { dbConnect } from '@/lib/db';
import { Vendor } from '@/models/Vendor';

export const dynamic = 'force-dynamic';

export default async function VendorsPage() {
  await dbConnect();
  const items = await Vendor.find({}).sort({ createdAt: -1 }).limit(100).lean();
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Vendors</h1>
        <Link href="/admin/vendors/new" className="btn">
          New vendor
        </Link>
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="hidden sm:table-cell">Slug</th>
              <th>Status</th>
              <th className="hidden sm:table-cell">Plan</th>
              <th>Storage used</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((v) => (
              <tr key={String(v._id)}>
                <td className="font-medium">{v.name}</td>
                <td className="hidden font-mono text-xs sm:table-cell">{v.slug}</td>
                <td>
                  <span
                    className={
                      v.status === 'active'
                        ? 'chip-success'
                        : v.status === 'suspended'
                          ? 'chip-danger'
                          : 'chip-warning'
                    }
                  >
                    {v.status}
                  </span>
                </td>
                <td className="hidden sm:table-cell">{v.plan}</td>
                <td className="font-mono text-xs">
                  {(v.usage.storageBytes / 1024 / 1024).toFixed(1)} MB
                </td>
                <td>
                  <Link
                    href={`/admin/vendors/${v._id}`}
                    className="text-accent hover:underline"
                  >
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-gray-500">
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
