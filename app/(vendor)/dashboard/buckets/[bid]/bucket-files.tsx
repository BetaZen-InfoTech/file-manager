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
function fileIcon(mime: string, name: string): string {
  if (/zip|compress|tar|rar|7z/.test(mime) || /\.zip$/i.test(name)) return '🗜️';
  if (/^image\//.test(mime)) return '🖼️';
  if (/^video\//.test(mime)) return '🎬';
  if (/^audio\//.test(mime)) return '🎵';
  if (/pdf/.test(mime)) return '📕';
  if (/^text\/|json|xml|csv|javascript|html/.test(mime)) return '📃';
  return '📄';
}
const isZip = (f: FileRow) => /zip/i.test(f.mimeType) || /\.zip$/i.test(f.originalName);
const isText = (f: FileRow) =>
  /^text\//i.test(f.mimeType) ||
  /(json|xml|csv|javascript|html|yaml|markdown)/i.test(f.mimeType) ||
  /\.(txt|md|json|csv|xml|html?|css|js|ts|tsx|jsx|yml|yaml|sh|env|ini|conf|log)$/i.test(f.originalName);

// A small folder browser used to pick a move destination.
function MovePicker({ bucketId, onPick, onClose }: { bucketId: string; onPick: (id: string | null) => void; onClose: () => void }) {
  const [trail, setTrail] = useState<Crumb[]>([{ id: null, name: 'Root' }]);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const here = trail[trail.length - 1].id;
  async function load(fid: string | null) {
    const r = await fetch(`/api/v1/buckets/${bucketId}/folders?parentId=${fid ?? ''}`);
    const j = await r.json().catch(() => ({ items: [] }));
    setFolders(r.ok ? j.items : []);
  }
  useEffect(() => {
    load(here);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        {trail.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-gray-600">/</span>}
            <button className="rounded px-1 text-gray-300 hover:bg-[#1c1c20]" onClick={() => { const n = trail.slice(0, i + 1); setTrail(n); load(n[n.length - 1].id); }}>
              {i === 0 ? '🏠 Root' : c.name}
            </button>
          </span>
        ))}
      </div>
      <div className="max-h-56 divide-y divide-border/60 overflow-auto rounded-md border border-border">
        {folders.length === 0 && <div className="px-3 py-4 text-center text-xs text-gray-500">No subfolders here.</div>}
        {folders.map((f) => (
          <button key={f._id} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-200 hover:bg-[#16161a]" onClick={() => { const n = [...trail, { id: f._id, name: f.name }]; setTrail(n); load(f._id); }}>
            📁 {f.name}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-secondary px-4 py-2 text-sm" onClick={onClose}>Cancel</button>
        <button className="btn px-4 py-2 text-sm" onClick={() => onPick(here)}>Move here</button>
      </div>
    </div>
  );
}

export default function BucketFiles({ bucketId, initialFiles }: { bucketId: string; initialFiles: FileRow[] }) {
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
  const [sel, setSel] = useState<Set<string>>(new Set());

  // modals
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [newFile, setNewFile] = useState<{ name: string; content: string } | null>(null);
  const [active, setActive] = useState<FileRow | null>(null);
  const [activeFolder, setActiveFolder] = useState<FolderRow | null>(null);
  const [rename, setRename] = useState<{ kind: 'file' | 'folder'; id: string; name: string } | null>(null);
  const [move, setMove] = useState<{ kind: 'file' | 'folder'; id: string } | null>(null);
  const [edit, setEdit] = useState<{ id: string; name: string; content: string } | null>(null);
  const [props, setProps] = useState<FileRow | null>(null);
  const [link, setLink] = useState<{ type: string; url: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const folderId = trail[trail.length - 1].id;

  async function load(fid: string | null) {
    setLoading(true);
    setError(null);
    setSel(new Set());
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
  async function api(url: string, method: string, body?: any) {
    const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(j?.error?.message || `${method} failed`);
      return null;
    }
    return res.json().catch(() => ({}));
  }

  async function createFolder() {
    const name = (newFolder || '').trim();
    if (!name) return;
    await api(`/api/v1/buckets/${bucketId}/folders`, 'POST', { name, parentId: folderId });
    setNewFolder(null);
    load(folderId);
  }
  async function createFile() {
    if (!newFile?.name.trim()) return;
    await api(`/api/v1/buckets/${bucketId}/files/blank`, 'POST', { name: newFile.name.trim(), content: newFile.content, folderId });
    setNewFile(null);
    load(folderId);
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
    const d = await api(`/api/v1/files/${fileId}/links`, 'POST', body);
    if (d) setLink({ type: d.type, url: d.accessUrl });
  }
  async function doRename() {
    if (!rename) return;
    const name = rename.name.trim();
    if (!name) return;
    if (rename.kind === 'file') await api(`/api/v1/files/${rename.id}`, 'PATCH', { originalName: name });
    else await api(`/api/v1/folders/${rename.id}`, 'PATCH', { name });
    setRename(null);
    setActive(null);
    setActiveFolder(null);
    load(folderId);
  }
  async function doMove(dest: string | null) {
    if (!move) return;
    if (move.kind === 'file') await api(`/api/v1/files/${move.id}`, 'PATCH', { folderId: dest });
    else await api(`/api/v1/folders/${move.id}`, 'PATCH', { parentId: dest });
    setMove(null);
    setActive(null);
    setActiveFolder(null);
    load(folderId);
  }
  async function copy(f: FileRow) {
    await api(`/api/v1/files/${f._id}/copy`, 'POST', {});
    setActive(null);
    load(folderId);
  }
  async function openEdit(f: FileRow) {
    const d = await api(`/api/v1/files/${f._id}/content`, 'GET');
    if (d) {
      setEdit({ id: f._id, name: f.originalName, content: d.content });
      setActive(null);
    }
  }
  async function saveEdit() {
    if (!edit) return;
    await api(`/api/v1/files/${edit.id}/content`, 'PUT', { content: edit.content });
    setEdit(null);
    load(folderId);
  }
  async function extract(f: FileRow) {
    setError(null);
    const d = await api(`/api/v1/files/${f._id}/extract`, 'POST', { folderId });
    setActive(null);
    if (d) load(folderId);
  }
  async function trash(f: FileRow) {
    await fetch(`/api/v1/files/${f._id}`, { method: 'DELETE' });
    setActive(null);
    load(folderId);
  }
  async function deleteFolder(f: FolderRow) {
    const d = await api(`/api/v1/folders/${f._id}`, 'DELETE');
    setActiveFolder(null);
    if (d) load(folderId);
  }
  // bulk
  function toggleSel(id: string) {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  async function zipSelected() {
    const d = await api(`/api/v1/buckets/${bucketId}/archive`, 'POST', { fileIds: [...sel], folderId });
    if (d) load(folderId);
  }
  async function deleteSelected() {
    if (!confirm(`Move ${sel.size} file(s) to trash?`)) return;
    await Promise.all([...sel].map((id) => fetch(`/api/v1/files/${id}`, { method: 'DELETE' })));
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
              <button onClick={() => goCrumb(i)} className={`max-w-[140px] truncate rounded px-1.5 py-0.5 ${i === trail.length - 1 ? 'text-white' : 'text-gray-400 hover:bg-[#1c1c20] hover:text-white'}`}>
                {i === 0 ? '🏠 Root' : c.name}
              </button>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setNewFolder('')}>＋ Folder</button>
          <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setNewFile({ name: 'untitled.txt', content: '' })}>＋ File</button>
          <label className="btn cursor-pointer px-3 py-1.5 text-xs">
            <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} disabled={uploading} />
            {uploading ? `Uploading ${progress}%` : '⬆ Upload'}
          </label>
          <button className="rounded-md border border-border px-2 py-1.5 text-xs text-gray-300 hover:bg-[#1c1c20]" onClick={() => setView((v) => (v === 'grid' ? 'list' : 'grid'))}>{view === 'grid' ? '☰' : '▦'}</button>
        </div>
      </div>

      {/* selection bar */}
      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs">
          <span className="text-accent">{sel.size} selected</span>
          <button className="btn-secondary px-2 py-1 text-[11px]" onClick={zipSelected}>🗜️ Zip</button>
          <button className="btn-danger px-2 py-1 text-[11px]" onClick={deleteSelected}>Trash</button>
          <button className="px-2 py-1 text-[11px] text-gray-400 hover:text-white" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}

      <div className="flex items-center justify-between px-1">
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden
        </label>
        <button className="text-xs text-gray-400 hover:text-white" onClick={() => load(folderId)}>↻ Refresh</button>
      </div>

      {/* listing */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
        className={`min-h-[200px] rounded-xl border-2 border-dashed p-3 transition ${drag ? 'border-accent bg-accent/5' : 'border-border'}`}
      >
        {loading ? (
          <div className="py-16 text-center text-sm text-gray-500">Loading…</div>
        ) : empty ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <div className="text-3xl">📂</div>
            <p className="text-sm text-gray-400">This folder is empty. Drag files here, or use Upload / New file.</p>
          </div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {folders.map((f) => (
              <div key={f._id} className={`group relative rounded-xl border border-border bg-panel p-4 text-center transition hover:border-accent/50 hover:bg-[#16161a] ${f.isHidden ? 'opacity-60' : ''}`}>
                <button className="flex w-full flex-col items-center gap-2" onClick={() => openFolder(f)}>
                  <span className="text-3xl">📁</span>
                  <span className="line-clamp-2 break-all text-xs text-gray-200">{f.name}</span>
                </button>
                <button className="absolute right-1.5 top-1.5 rounded px-1 text-gray-500 opacity-0 hover:bg-[#1c1c20] hover:text-white group-hover:opacity-100" onClick={() => setActiveFolder(f)}>⋯</button>
              </div>
            ))}
            {files.map((f) => (
              <div key={f._id} className={`group relative rounded-xl border border-border bg-panel p-4 text-center transition hover:border-accent/50 hover:bg-[#16161a] ${f.isHidden ? 'opacity-60' : ''}`}>
                <input type="checkbox" className="absolute left-1.5 top-1.5 opacity-0 group-hover:opacity-100 checked:opacity-100" checked={sel.has(f._id)} onChange={() => toggleSel(f._id)} />
                <button className="flex w-full flex-col items-center gap-2" onClick={() => setActive(f)}>
                  <span className="text-3xl">{fileIcon(f.mimeType, f.originalName)}</span>
                  <span className="line-clamp-2 break-all text-xs text-gray-200">{f.originalName}</span>
                  <span className="text-[10px] text-gray-500">{fmtBytes(f.sizeBytes)}</span>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {folders.map((f) => (
              <div key={f._id} className="flex items-center gap-3 px-2 py-2.5 hover:bg-[#16161a]">
                <button className="flex flex-1 items-center gap-3 text-left" onClick={() => openFolder(f)}>
                  <span className="text-lg">📁</span>
                  <span className="truncate text-sm text-gray-200">{f.name}</span>
                </button>
                <button className="btn-secondary px-2 py-1 text-[11px]" onClick={() => setActiveFolder(f)}>⋯</button>
              </div>
            ))}
            {files.map((f) => (
              <div key={f._id} className={`flex items-center gap-3 px-2 py-2.5 hover:bg-[#16161a] ${f.isHidden ? 'opacity-60' : ''}`}>
                <input type="checkbox" checked={sel.has(f._id)} onChange={() => toggleSel(f._id)} />
                <span className="text-lg">{fileIcon(f.mimeType, f.originalName)}</span>
                <button className="flex-1 truncate text-left text-sm text-gray-200" onClick={() => setActive(f)}>{f.originalName}</button>
                <span className="hidden text-xs text-gray-500 sm:block">{fmtBytes(f.sizeBytes)}</span>
                <button className="btn-secondary px-2 py-1 text-[11px]" onClick={() => setActive(f)}>Actions</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* new folder */}
      <Modal open={newFolder !== null} onClose={() => setNewFolder(null)} title="New folder" icon={<span>📁</span>} size="sm"
        footer={<><button className="btn-secondary px-4 py-2 text-sm" onClick={() => setNewFolder(null)}>Cancel</button><button className="btn px-4 py-2 text-sm" onClick={createFolder}>Create</button></>}>
        <input autoFocus className="input" placeholder="Folder name" value={newFolder || ''} onChange={(e) => setNewFolder(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createFolder()} />
      </Modal>

      {/* new file */}
      <Modal open={!!newFile} onClose={() => setNewFile(null)} title="New file" icon={<span>📄</span>}
        footer={<><button className="btn-secondary px-4 py-2 text-sm" onClick={() => setNewFile(null)}>Cancel</button><button className="btn px-4 py-2 text-sm" onClick={createFile}>Create</button></>}>
        {newFile && (
          <div className="space-y-3">
            <input className="input" placeholder="filename.txt" value={newFile.name} onChange={(e) => setNewFile({ ...newFile, name: e.target.value })} />
            <textarea className="input min-h-[160px] font-mono text-xs" placeholder="File content…" value={newFile.content} onChange={(e) => setNewFile({ ...newFile, content: e.target.value })} />
          </div>
        )}
      </Modal>

      {/* file actions */}
      <Modal open={!!active} onClose={() => { setActive(null); setLink(null); }} title={active?.originalName} icon={<span>{active ? fileIcon(active.mimeType, active.originalName) : '📄'}</span>}>
        {active && (
          <div className="space-y-4">
            <div className="text-xs text-gray-400">{active.mimeType} · {fmtBytes(active.sizeBytes)}</div>
            <div className="grid grid-cols-2 gap-2">
              <a className="btn text-center text-sm" href={`/api/v1/files/${active._id}/download`}>⬇ Download</a>
              <button className="btn-secondary text-sm" onClick={() => setRename({ kind: 'file', id: active._id, name: active.originalName })}>Rename</button>
              <button className="btn-secondary text-sm" onClick={() => setMove({ kind: 'file', id: active._id })}>Move</button>
              <button className="btn-secondary text-sm" onClick={() => copy(active)}>Copy</button>
              {isText(active) && <button className="btn-secondary text-sm" onClick={() => openEdit(active)}>Edit</button>}
              {isZip(active) && <button className="btn-secondary text-sm" onClick={() => extract(active)}>Extract</button>}
              <button className="btn-secondary text-sm" onClick={() => share(active._id, 'public')}>Public link</button>
              <button className="btn-secondary text-sm" onClick={() => share(active._id, 'temporary')}>10-min link</button>
              <button className="btn-secondary text-sm" onClick={() => share(active._id, 'private')}>Private (JWT)</button>
              <button className="btn-secondary text-sm" onClick={() => { setProps(active); }}>Properties</button>
              <button className="btn-secondary text-sm" onClick={() => active && fetch(`/api/v1/files/${active._id}/${active.isHidden ? 'unhide' : 'hide'}`, { method: 'POST' }).then(() => { setActive(null); load(folderId); })}>{active.isHidden ? 'Unhide' : 'Hide'}</button>
              <button className="btn-danger text-sm" onClick={() => trash(active)}>Trash</button>
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

      {/* folder actions */}
      <Modal open={!!activeFolder} onClose={() => setActiveFolder(null)} title={activeFolder?.name} icon={<span>📁</span>} size="sm"
        footer={<button className="btn-secondary px-4 py-2 text-sm" onClick={() => setActiveFolder(null)}>Close</button>}>
        {activeFolder && (
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-secondary text-sm" onClick={() => setRename({ kind: 'folder', id: activeFolder._id, name: activeFolder.name })}>Rename</button>
            <button className="btn-secondary text-sm" onClick={() => setMove({ kind: 'folder', id: activeFolder._id })}>Move</button>
            <button className="btn-danger col-span-2 text-sm" onClick={() => deleteFolder(activeFolder)}>Delete (must be empty)</button>
          </div>
        )}
      </Modal>

      {/* rename */}
      <Modal open={!!rename} onClose={() => setRename(null)} title="Rename" size="sm"
        footer={<><button className="btn-secondary px-4 py-2 text-sm" onClick={() => setRename(null)}>Cancel</button><button className="btn px-4 py-2 text-sm" onClick={doRename}>Save</button></>}>
        {rename && <input autoFocus className="input" value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && doRename()} />}
      </Modal>

      {/* move */}
      <Modal open={!!move} onClose={() => setMove(null)} title="Move to folder" size="sm">
        {move && <MovePicker bucketId={bucketId} onPick={doMove} onClose={() => setMove(null)} />}
      </Modal>

      {/* edit text */}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.name} icon={<span>📝</span>} size="lg"
        footer={<><button className="btn-secondary px-4 py-2 text-sm" onClick={() => setEdit(null)}>Cancel</button><button className="btn px-4 py-2 text-sm" onClick={saveEdit}>Save</button></>}>
        {edit && <textarea className="input min-h-[320px] w-full font-mono text-xs" value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} spellCheck={false} />}
      </Modal>

      {/* properties */}
      <Modal open={!!props} onClose={() => setProps(null)} title="Properties" size="sm"
        footer={<button className="btn px-4 py-2 text-sm" onClick={() => setProps(null)}>Close</button>}>
        {props && (
          <dl className="space-y-1.5 text-xs">
            {[['Name', props.originalName], ['Type', props.mimeType], ['Size', fmtBytes(props.sizeBytes)], ['Created', new Date(props.createdAt).toLocaleString()], ['ID', props._id]].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-gray-500">{k}</dt><dd className="truncate text-gray-200">{v}</dd></div>
            ))}
          </dl>
        )}
      </Modal>
    </div>
  );
}
