'use client';

import { useRef, useState } from 'react';

type FileRow = {
  _id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  isHidden?: boolean;
  createdAt: string;
};

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${u[i]}`;
}

export default function BucketFiles({
  bucketId,
  initialFiles
}: {
  bucketId: string;
  initialFiles: FileRow[];
}) {
  const [files, setFiles] = useState<FileRow[]>(initialFiles);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [linkResult, setLinkResult] = useState<{ id: string; type: string; url: string } | null>(
    null
  );
  const [showHidden, setShowHidden] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const res = await fetch(
      `/api/v1/buckets/${bucketId}/files?showHidden=${showHidden ? 'true' : 'false'}`
    );
    if (res.ok) {
      const data = await res.json();
      setFiles(data.items);
    }
  }

  async function upload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError(null);
    setProgress(0);
    try {
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`/api/v1/buckets/${bucketId}/files`, {
          method: 'POST',
          body: fd
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error?.message || `Upload failed (${res.status})`);
        }
        setProgress(Math.round(((i + 1) / fileList.length) * 100));
      }
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function createLink(
    fileId: string,
    type: 'public' | 'private' | 'temporary',
    expiresIn?: number,
    neverExpire?: boolean
  ) {
    setLinkResult(null);
    const body: any = { type };
    if (neverExpire) body.neverExpire = true;
    else if (expiresIn) body.expiresIn = expiresIn;
    const res = await fetch(`/api/v1/files/${fileId}/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (res.ok) {
      setLinkResult({ id: data.id, type: data.type, url: data.accessUrl });
    } else {
      setError(data?.error?.message || 'Failed to create link');
    }
  }

  async function resetLinks(fileId: string) {
    if (!confirm('Revoke ALL links for this file?')) return;
    const res = await fetch(`/api/v1/files/${fileId}/links/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (res.ok) alert(`Revoked ${data.revoked} link(s).`);
    else setError(data?.error?.message || 'Failed');
  }

  async function toggleHide(fileId: string, hide: boolean) {
    await fetch(`/api/v1/files/${fileId}/${hide ? 'hide' : 'unhide'}`, { method: 'POST' });
    await refresh();
  }

  async function softDelete(fileId: string) {
    if (!confirm('Move this file to trash?')) return;
    await fetch(`/api/v1/files/${fileId}`, { method: 'DELETE' });
    await refresh();
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium text-white">Upload files</div>
            <div className="text-xs text-gray-400">Drag & drop, or use the picker.</div>
          </div>
          <label className="btn cursor-pointer">
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => upload(e.target.files)}
              disabled={uploading}
            />
            {uploading ? `Uploading ${progress ?? 0}%` : 'Choose files'}
          </label>
        </div>
        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}
        {linkResult && (
          <div className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
            <div>
              {linkResult.type} link:{' '}
              <a className="underline" href={linkResult.url} target="_blank" rel="noreferrer">
                {linkResult.url}
              </a>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={async (e) => {
              setShowHidden(e.target.checked);
              setTimeout(refresh, 50);
            }}
          />
          Show hidden
        </label>
        <button className="text-xs text-gray-400 hover:text-white" onClick={refresh}>
          Refresh
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="hidden sm:table-cell">Type</th>
              <th>Size</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f._id} className={f.isHidden ? 'opacity-60' : ''}>
                <td className="font-medium">
                  {f.originalName}
                  {f.isHidden && <span className="ml-2 chip">hidden</span>}
                </td>
                <td className="hidden sm:table-cell font-mono text-xs">{f.mimeType}</td>
                <td className="font-mono text-xs">{fmtBytes(f.sizeBytes)}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    <a
                      className="text-xs text-accent hover:underline"
                      href={`/api/v1/files/${f._id}/download`}
                    >
                      Download
                    </a>
                    <button
                      className="text-xs text-gray-300 hover:underline"
                      onClick={() => createLink(f._id, 'public', undefined, true)}
                    >
                      Public link
                    </button>
                    <button
                      className="text-xs text-gray-300 hover:underline"
                      onClick={() => createLink(f._id, 'temporary', 600)}
                    >
                      10-min link
                    </button>
                    <button
                      className="text-xs text-gray-300 hover:underline"
                      onClick={() => createLink(f._id, 'private', 3600)}
                    >
                      Private (JWT) link
                    </button>
                    <button
                      className="text-xs text-warning hover:underline"
                      onClick={() => resetLinks(f._id)}
                    >
                      Reset links
                    </button>
                    <button
                      className="text-xs text-gray-400 hover:underline"
                      onClick={() => toggleHide(f._id, !f.isHidden)}
                    >
                      {f.isHidden ? 'Unhide' : 'Hide'}
                    </button>
                    <button
                      className="text-xs text-danger hover:underline"
                      onClick={() => softDelete(f._id)}
                    >
                      Trash
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {files.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-sm text-gray-500">
                  No files in this bucket yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
