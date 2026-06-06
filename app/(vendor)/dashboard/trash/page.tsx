import { dbConnect } from '@/lib/db';
import { FileModel } from '@/models/File';
import { getServerSession } from '@/lib/session-server';
import TrashList from './trash-list';

export const dynamic = 'force-dynamic';

export default async function TrashPage() {
  const session = await getServerSession();
  if (!session?.vendor) return null;
  await dbConnect();
  const items = await FileModel.find({ vendorId: session.vendor.id, status: 'trashed' })
    .sort({ deletedAt: -1 })
    .limit(200)
    .lean();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-white">Trash</h1>
      <p className="text-sm text-gray-400">Files in trash are auto-purged after 30 days.</p>
      <TrashList initial={JSON.parse(JSON.stringify(items))} />
    </div>
  );
}
