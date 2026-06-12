'use client';

import FsExplorer from '@/components/FsExplorer';

export default function FileManagerClient({ initialPath }: { initialPath?: string }) {
  return <FsExplorer apiBase="/api/v1/admin/fs" initialPath={initialPath} />;
}
