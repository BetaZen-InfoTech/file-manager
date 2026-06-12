import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/session-server';
import FsExplorer from '@/components/FsExplorer';

export const dynamic = 'force-dynamic';

export default async function VendorFilesPage() {
  const session = await getServerSession();
  if (!session) redirect('/login');
  if (['super_admin', 'platform_staff'].includes(session.user.role)) redirect('/admin');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-white">Files</h1>
        <p className="mt-1 text-sm text-gray-400">
          Your private file area. Create, edit, upload, zip, and organize files — you can only see and reach your own folder.
          Files here are kept on the server and <span className="text-gray-300">do not count toward your bucket storage quota</span>.
        </p>
      </div>
      <FsExplorer apiBase="/api/v1/fs" />
    </div>
  );
}
