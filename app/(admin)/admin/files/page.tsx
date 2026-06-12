import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/session-server';
import FileManagerClient from './client';

export const dynamic = 'force-dynamic';

export default async function ServerFilesPage() {
  const session = await getServerSession();
  if (!session) redirect('/login');
  if (session.user.role !== 'super_admin') {
    return (
      <div className="card text-sm text-gray-400">
        The server file manager is available to <strong className="text-white">super admins</strong> only.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-white">File Manager</h1>
        <p className="mt-1 text-sm text-gray-400">
          Browse &amp; manage files on the server. Full filesystem access — be careful.
        </p>
      </div>
      <FileManagerClient />
    </div>
  );
}
