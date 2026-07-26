import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/session-server';
import { serverIp } from '@/lib/server-ip';
import { Icon } from '@/components/Icon';
import FileManagerClient from './client';

export const dynamic = 'force-dynamic';

export default async function ServerFilesPage({
  searchParams
}: {
  searchParams?: { path?: string };
}) {
  const session = await getServerSession();
  if (!session) redirect('/login');
  if (session.user.role !== 'super_admin') {
    return (
      <div className="card text-sm text-gray-400">
        The server file manager is available to <strong className="text-white">super admins</strong> only.
      </div>
    );
  }
  const initialPath = typeof searchParams?.path === 'string' ? searchParams.path : undefined;
  const ip = serverIp();
  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-white">File Manager</h1>
          {ip && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-xs text-emerald-400"
              title="This server's IP address"
            >
              <Icon name="server" className="h-3.5 w-3.5" />
              {ip}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-400">
          Browse &amp; manage files on the server. Full filesystem access — be careful.
        </p>
      </div>
      <FileManagerClient initialPath={initialPath} />
    </div>
  );
}
