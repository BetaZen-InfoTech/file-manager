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
        <h1 className="text-2xl font-semibold text-white">Server transfer &amp; migration</h1>
        <p className="mt-1 text-sm text-gray-400">
          Move files &amp; folders here from <strong>another bcdnp server</strong> (mint a transfer token
          there, enter its URL + token below) or from any <strong>S3-compatible storage</strong>. Files
          stream directly — <strong>no zip, no extra disk</strong> — and the job keeps running on the
          server even if you close the browser.
        </p>
      </div>
      <MigrationClient vendors={vendors} />
    </div>
  );
}
