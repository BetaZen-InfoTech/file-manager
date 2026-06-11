import { dbConnect } from '@/lib/db';
import { Vendor } from '@/models/Vendor';
import MigrationClient from './client';

export const dynamic = 'force-dynamic';

export default async function MigrationPage() {
  await dbConnect();
  const vendors = (await Vendor.find().select('name slug').sort({ name: 1 }).lean()).map((v: any) => ({
    id: String(v._id),
    name: v.name as string,
    slug: v.slug as string
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-white">Migrate files from another server</h1>
        <p className="mt-1 text-sm text-gray-400">
          Import all files &amp; folders from another server&apos;s <strong>S3-compatible storage</strong>
          (MinIO, AWS S3, DigitalOcean Spaces, a backup bucket…) into a vendor here. Folder structure
          is rebuilt from the object keys.
        </p>
      </div>
      <MigrationClient vendors={vendors} />
    </div>
  );
}
