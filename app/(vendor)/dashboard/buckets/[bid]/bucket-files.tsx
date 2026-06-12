'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal, CopyButton } from '@/components/Modal';

type FileRow = {
  _id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  isHidden?: boolean;
  folderId?: string | null;
  createdAt: string;
};
type FolderRow = { _id: string; name: string; isHidden?: boolean };
type Crumb = { id: string | null; name: string };

function fmtBytes(b: number): string {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = b / 1024,
    i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${u[i]}`;
}
function fileIcon(mime: string): string {
  if (/^image\//.test(mime)) return '🖼️';
  if (/^video\//.test(mime)) return '🎬';
  if (/^audio\//.test(mime)) return '🎵';
  if (/pdf/.test(mime)) return '📕';
  if (/zip|compress|tar|rar|7z/.test(mime)) return '🗜️';
  if (/^text\/|json|xml|csv|javascript|html/.test(mime)) return '📃';
  return '📄';
}

export default function BucketFiles({
  bucketId,
  initialFiles
}: {
  bucketId: string;
  initialFiles: FileRow[];
}) {
  const [trail, setTrail] = useState<Crumb[]>([{ id: null, name: 'Root' }]);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>(initialFiles);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null); // null=closed, string=name
  const [active, setActive] = useState<FileRow | null>(null); // file actions modal
  const [link, setLink] = useState<{ type: string; url: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const folderId = trail[trail.length - 1].id;

  async function load(fid: string | null) {
    setLoading(true);
    setError(null);
    try {
      const hp = showHidden ? '&showHidden=true' : '';
      const [fr, fl] = await Promise.all([
        fetch(`/api/v1/buckets/${bucketId}/folders?parentId=${fid ?? ''}${hp}`),
        fetch(`/api/v1/buckets/${bucketId}/files?folderId=${fid ?? ''}${hp}`)
      ]);
      const frj = await fr.json().catch(() => ({ items: [] }));
      const flj = await fl.json().catch(() => ({ items: [] }));
      setFolders(fr.ok ? frj.items : []);
      setFiles(fl.ok ? flj.items : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(folderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden]);

  function openFolder(f: FolderRow) {
    const next = [...trail, { id: f._id, name: f.name }];
    setTrail(next);
    load(f._id);
  }
  function goCrumb(i: number) {
    const next = trail.slice(0, i + 1);
    setTrail(next);
    load(next[next.length - 1].id);
  }

  async function createFolder() {
    const name = (newFolder || '').trim();
    if (!name) return;
    const res = await fetch(`/api/v1/buckets/${bucketId}/folders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, parentId: folderId })
    });
    setNewFolder(null);
    if (res.ok) load(folderId);
    else setError((await res.json().catch(() => null))?.error?.message || 'Could not create folder');
  }

  async function upload(list: FileList | null) {
    if (!list || list.length === 0) return;
    setUploading(true);
    setError(null);
    setProgress(0);
    try {
      for (let i = 0; i < list.length; i++) {
        const fd = new FormData();
        fd.append('file', list[i]);
        if (folderId) fd.append('folderId', folderId);
        const res = await fetch(`/api/v1/buckets/${bucketId}/files`, { method: 'POST', body: fd });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message || 'Upload failed');
        setProgress(Math.round(((i + 1) / list.length) * 100));
      }
      await load(folderId);
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
    } finally {
      setUploading(false);
      setProgress(0);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function share(fileId: string, type: 'public' | 'temporary' | 'private') {
    setLink(null);
    const body: any = { type };
    if (type === 'public') body.neverExpire = true;
    if (type === 'temporary') body.expiresIn = 600;
    if (type === 'private') body.expiresIn = 3600;
    const res = await fetch(`/api/v1/files/${fileId}/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const d = await res.json();
    if (res.ok) setLink({ type: d.type, url: d.accessUrl });
    else setError(d?.error?.message || 'Failed to create link');
  }

  async function toggleHide(f: FileRow) {
    await fetch(`/api/v1/files/${f._id}/${f.isHidden ? 'unhide' : 'hide'}`, { method: 'POST' });
    setActive(null);
    load(folderId);
  }
  async function trash(f: FileRow) {
    await fetch(`/api/v1/files/${f._id}`, { method: 'DELETE' });
    setActive(null);
    load(folderId);
  }

  const empty = folders.length === 0 && files.length === 0;

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="card flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          {trail.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-gray-600">/</span>}
              <button
                onClick={() => goCrumb(i)}
                className={`max-w-[140px] truncate rounded px-1.5 py-0.5 ${
                  i === trail.length - 1 ? 'text-white' : 'text-gray-400 hover:bg-[#1c1c20] hover:text-white'
                }`}
              >
                {i === 0 ? '🏠 Root' : c.name}
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setNewFolder('')}>
            ＋ Folder
          </button>
          <label className="btn cursor-pointer px-3 py-1.5 text-xs">
            <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} disabled={uploading} />
            {uploading ? `Uploading ${progress}%` : '⬆ Upload'}
          </label>
          <button
            className="rounded-md border border-border px-2 py-1.5 text-xs text-gray-300 hover:bg-[#1c1c20]"
            onClick={() => setView((v) => (v === 'grid' ? 'list' : 'grid'))}
            title="Toggle view"
          >
            {view === 'grid' ? '☰' : '▦'}
          </button>
        </div>
      </div>

      {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}

      <div className="flex items-center justify-between px-1">
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          Show hidden
        </label>
        <button className="text-xs text-gray-400 hover:text-white" onClick={() => load(folderId)}>
          ↻ Refresh
        </button>
      </div>

      {/* drop area */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          upload(e.dataTransfer.files);
        }}
        className={`min-h-[200px] rounded-xl border-2 border-dashed p-3 transition ${
          drag ? 'border-accent bg-accent/5' : 'border-border'
        }`}
      >
        {loading ? (
          <div className="py-16 text-center text-sm text-gray-500">Loading…</div>
        ) : empty ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <div className="text-3xl">📂</div>
            <p className="text-sm text-gray-400">This folder is empty. Drag files here, or use Upload.</p>
          </div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {folders.map((f) => (
              <button
                key={f._id}
                onDoubleClick={() => openFolder(f)}
                onClick={() => openFolder(f)}
                className={`flex flex-col items-center gap-2 rounded-xl border border-border bg-panel p-4 text-center transition hover:border-accent/50 hover:bg-[#16161a] ${f.isHidden ? 'opacity-60' : ''}`}
              >
                <span className="text-3xl">📁</span>
                <span className="line-clamp-2 break-all text-xs text-gray-200">{f.name}</span>
              </button>
            ))}
            {files.map((f) => (
              <button
                key={f._id}
                onClick={() => setActive(f)}
                className={`flex flex-col items-center gap-2 rounded-xl border border-border bg-panel p-4 text-center transition hover:border-accent/50 hover:bg-[#16161a] ${f.isHidden ? 'opacity-60' : ''}`}
              >
                <span className="text-3xl">{fileIcon(f.mimeType)}</span>
                <span className="line-clamp-2 break-all text-xs text-gray-200">{f.originalName}</span>
                <span className="text-[10px] text-gray-500">{fmtBytes(f.sizeBytes)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {folders.map((f) => (
              <button key={f._id} onClick={() => openFolder(f)} className="flex w-full items-center gap-3 px-2 py-2.5 text-left hover:bg-[#16161a]">
                <span className="text-lg">📁</span>
                <span className="flex-1 truncate text-sm text-gray-200">{f.name}</span>
                <span className="text-xs text-gray-600">folder</span>
              </button>
            ))}
            {files.map((f) => (
              <div key={f._id} className={`flex items-center gap-3 px-2 py-2.5 hover:bg-[#16161a] ${f.isHidden ? 'opacity-60' : ''}`}>
                <span className="text-lg">{fileIcon(f.mimeType)}</span>
                <span className="flex-1 truncate text-sm text-gray-200">{f.originalName}</span>
                <span className="hidden text-xs text-gray-500 sm:block">{fmtBytes(f.sizeBytes)}</span>
                <button className="btn-secondary px-2 py-1 text-[11px]" onClick={() => setActive(f)}>
                  Actions
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* new folder modal */}
      <Modal
        open={newFolder !== null}
        onClose={() => setNewFolder(null)}
        title="New folder"
        icon={<span className="text-lg">📁</span>}
        size="sm"
        footer={
          <>
            <button className="btn-secondary px-4 py-2 text-sm" onClick={() => setNewFolder(null)}>
              Cancel
            </button>
            <button className="btn px-4 py-2 text-sm" onClick={createFolder}>
              Create
            </button>
          </>
        }
      >
        <input
          autoFocus
          className="input"
          placeholder="Folder name"
          value={newFolder || ''}
          onChange={(e) => setNewFolder(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && createFolder()}
        />
      </Modal>

      {/* file actions modal */}
      <Modal
        open={!!active}
        onClose={() => {
          setActive(null);
          setLink(null);
        }}
        title={active?.originalName}
        icon={<span className="text-lg">{active ? fileIcon(active.mimeType) : '📄'}</span>}
      >
        {active && (
          <div className="space-y-4">
            <div className="text-xs text-gray-400">
              {active.mimeType} · {fmtBytes(active.sizeBytes)}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <a className="btn text-center text-sm" href={`/api/v1/files/${active._id}/download`}>
                ⬇ Download
              </a>
              <button className="btn-secondary text-sm" onClick={() => toggleHide(active)}>
                {active.isHidden ? 'Unhide' : 'Hide'}
              </button>
              <button className="btn-secondary text-sm" onClick={() => share(active._id, 'public')}>
                Public link
              </button>
              <button className="btn-secondary text-sm" onClick={() => share(active._id, 'temporary')}>
                10-min link
              </button>
              <button className="btn-secondary text-sm" onClick={() => share(active._id, 'private')}>
                Private (JWT)
              </button>
              <button className="btn-danger text-sm" onClick={() => trash(active)}>
                Move to trash
              </button>
            </div>
            {link && (
              <div className="space-y-2 rounded-lg border border-success/40 bg-success/10 p-3">
                <div className="text-[11px] font-medium text-success">{link.type} link</div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-black/30 px-2 py-1 text-[11px] text-gray-200">{link.url}</code>
                  <CopyButton text={link.url} className="px-2 py-1 text-[11px]" />
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
