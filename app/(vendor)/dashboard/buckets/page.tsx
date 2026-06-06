import Link from 'next/link';
import { dbConnect } from '@/lib/db';
import { Bucket } from '@/models/Bucket';
import { getServerSession } from '@/lib/session-server';
import NewBucketForm from './new-form';

export const dynamic = 'force-dynamic';

export default async function BucketsPage() {
  const session = await getServerSession();
  if (!session?.vendor) return null;
  await dbConnect();
  const items = await Bucket.find({ vendorId: session.vendor.id }).sort({ name: 1 }).lean();

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-white">Buckets</h1>
      <NewBucketForm />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((b) => (
          <Link
            key={String(b._id)}
            href={`/dashboard/buckets/${b._id}`}
            className="card transition hover:border-accent/40"
          >
            <div className="flex items-center justify-between">
              <div className="text-base font-medium text-white">{b.name}</div>
              {b.isPublic ? (
                <span className="chip-warning">public</span>
              ) : (
                <span className="chip">private</span>
              )}
            </div>
            <div className="mt-2 text-xs text-gray-400">{b.description || 'No description'}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-gray-500">Files</div>
                <div className="font-mono">{b.fileCount}</div>
              </div>
              <div>
                <div className="text-gray-500">Size</div>
                <div className="font-mono">{(b.storageBytes / 1024 / 1024).toFixed(1)} MB</div>
              </div>
            </div>
          </Link>
        ))}
        {items.length === 0 && (
          <div className="card text-center text-sm text-gray-500">
            No buckets yet — create one above.
          </div>
        )}
      </div>
    </div>
  );
}
