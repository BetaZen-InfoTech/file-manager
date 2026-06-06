import Link from 'next/link';
import { dbConnect } from '@/lib/db';
import { Bucket } from '@/models/Bucket';
import { FileModel } from '@/models/File';
import { getServerSession } from '@/lib/session-server';
import BucketFiles from './bucket-files';

export const dynamic = 'force-dynamic';

export default async function BucketPage({ params }: { params: { bid: string } }) {
  const session = await getServerSession();
  if (!session?.vendor) return null;
  await dbConnect();
  const bucket = await Bucket.findOne({
    _id: params.bid,
    vendorId: session.vendor.id
  }).lean();
  if (!bucket) return <div className="text-gray-400">Bucket not found.</div>;
  const files = await FileModel.find({
    vendorId: session.vendor.id,
    bucketId: bucket._id,
    folderId: null,
    status: 'ready'
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard/buckets" className="text-xs text-gray-400 hover:underline">
            ← All buckets
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-white">{bucket.name}</h1>
        </div>
      </div>
      <BucketFiles
        bucketId={String(bucket._id)}
        initialFiles={JSON.parse(JSON.stringify(files))}
      />
    </div>
  );
}
