'use client';

import FsExplorer from '@/components/FsExplorer';

export default function FileManagerClient() {
  return <FsExplorer apiBase="/api/v1/admin/fs" />;
}
