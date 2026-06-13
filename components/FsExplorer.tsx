'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import UploadModal from '@/components/UploadModal';

interface Entry {
  name: string;
  type: 'dir' | 'file' | 'symlink' | 'other';
  size: number;
  mode: string;
  modeOctal: string;
  mtime: string;
  isHidden: boolean;
  symlinkTarget?: string;
}

interface TrashItem {
  id: string;
  name: string;
  originalPath: string;
  deletedAt: string;
  type: 'dir' | 'file';
  size: number;
}

function fmtBytes(b: number) {
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
function icon(e: { type: Entry['type']; name: string }) {
  if (e.type === 'dir') return '📁';
  if (e.type === 'symlink') return '🔗';
  if (/\.(zip|tar|gz|rar|7z)$/i.test(e.name)) return '🗜️';
  if (/\.(png|jpe?g|gif|webp|svg|ico)$/i.test(e.name)) return '🖼️';
  if (/\.(mp4|mkv|mov|webm)$/i.test(e.name)) return '🎬';
  if (/\.(mp3|wav|ogg)$/i.test(e.name)) return '🎵';
  if (/\.(pdf)$/i.test(e.name)) return '📕';
  if (/\.(txt|md|json|js|ts|tsx|jsx|css|html?|ya?ml|sh|env|ini|conf|log|py|go|rb|php)$/i.test(e.name)) return '📃';
  return '📄';
}
const join = (dir: string, name: string) => (dir === '/' ? `/${name}` : `${dir}/${name}`);
const isEditable = (name: string) =>
  /\.(txt|md|json|js|ts|tsx|jsx|css|html?|ya?ml|yml|sh|env|ini|conf|cnf|log|py|go|rb|php|sql|xml|csv|toml|service)$/i.test(name) ||
  !name.includes('.');
// The trash root itself is never shown as a normal folder — use the Trash view.
const TRASH_DIRS = new Set(['.trash', '.fs-trash']);

export default function FsExplorer({ apiBase, initialPath }: { apiBase: string; initialPath?: string }) {
  const [cwd, setCwd] = useState('');
  const [parent, setParent] = useState('');
  const [home, setHome] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const [edit, setEdit] = useState<{ path: string; content: string } | null>(null);
  const [rename, setRename] = useState<{ from: string; to: string } | null>(null);
  const [copy, setCopy] = useState<{ from: string; to: string } | null>(null);
  const [chmod, setChmod] = useState<{ path: string; mode: string } | null>(null);
  const [mk, setMk] = useState<{ kind: 'dir' | 'file'; name: string } | null>(null);
  const [props, setProps] = useState<Entry | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  // New: right-click menu, bulk modals, and the trash view.
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry } | null>(null);
  const [bulkDest, setBulkDest] = useState<{ mode: 'copy' | 'move'; dir: string } | null>(null);
  const [bulkMode, setBulkMode] = useState<{ mode: string } | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [trashBusy, setTrashBusy] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);

  async function load(p?: string) {
    setLoading(true);
    setError(null);
    setSel(new Set());
    try {
      const r = await fetch(`${apiBase}?path=${encodeURIComponent(p ?? cwd)}`);
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error?.message || 'cannot open');
        return;
      }
      setCwd(j.path);
      setParent(j.parent);
      setEntries(j.entries);
      if (!home) setHome(j.defaultPath);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load(initialPath || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the context menu on any click, scroll, or Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  async function op(body: any) {
    setError(null);
    const r = await fetch(apiBase, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      setError(j?.error?.message || 'operation failed');
      return false;
    }
    return true;
  }
  // Like op(), but reports into the Trash modal (the page-level banner renders
  // UNDER the modal backdrop and would be invisible).
  async function trashOp(body: any) {
    setTrashError(null);
    const r = await fetch(apiBase, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      setTrashError(j?.error?.message || 'operation failed');
      return false;
    }
    return true;
  }
  async function openEdit(e: Entry) {
    const full = join(cwd, e.name);
    const r = await fetch(`${apiBase}/read?path=${encodeURIComponent(full)}`);
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      setError(j?.error?.message || 'cannot read');
      return;
    }
    setEdit({ path: full, content: j.content });
  }
  function toggle(name: string) {
    setSel((s) => {
      const n = new Set(s);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  }

  // ---- single-entry actions (row buttons + context menu) ----
  function openRow(e: Entry) {
    const full = join(cwd, e.name);
    if (e.type === 'dir') load(full);
    else if (isEditable(e.name)) openEdit(e);
    else setProps(e);
  }
  async function hideEntry(e: Entry) {
    if (await op({ action: e.isHidden ? 'unhide' : 'hide', path: join(cwd, e.name) })) load();
  }
  async function compressEntry(e: Entry) {
    const full = join(cwd, e.name);
    if (await op({ action: 'zip', path: full, paths: [full], to: join(cwd, `${e.name}.zip`) })) load();
  }
  async function trashEntry(e: Entry) {
    if (await op({ action: 'trash', path: join(cwd, e.name) })) load();
  }
  async function deleteEntryForever(e: Entry) {
    if (confirm(`Permanently delete "${e.name}"? This CANNOT be undone.`) && (await op({ action: 'delete', path: join(cwd, e.name) }))) load();
  }
  async function extractEntry(e: Entry) {
    if (await op({ action: 'extract', path: join(cwd, e.name), to: cwd })) load();
  }

  // ---- bulk actions (selection toolbar) ----
  async function compressSelected() {
    const paths = [...sel].map((n) => join(cwd, n));
    if (!paths.length) return;
    if (await op({ action: 'zip', path: paths[0], paths, to: join(cwd, `archive-${Date.now()}.zip`) })) load();
  }
  // Run a per-item op over the selection, then report how many failed (the
  // shared error banner otherwise only shows the LAST item's message).
  async function runBulk(verb: string, fn: (n: string) => Promise<boolean>) {
    const names = [...sel];
    const failed: string[] = [];
    for (const n of names) if (!(await fn(n))) failed.push(n);
    await load();
    if (failed.length) setError(`${verb} ${names.length - failed.length} of ${names.length}; failed: ${failed.join(', ')}`);
  }
  function trashSelected() {
    return runBulk('Trashed', (n) => op({ action: 'trash', path: join(cwd, n) }));
  }
  function deleteSelectedForever() {
    if (!confirm(`Permanently delete ${sel.size} item(s)? This CANNOT be undone.`)) return;
    return runBulk('Deleted', (n) => op({ action: 'delete', path: join(cwd, n) }));
  }
  function runBulkDest() {
    if (!bulkDest) return;
    const dir = bulkDest.dir.replace(/\/+$/, '') || '/';
    const verb = bulkDest.mode === 'copy' ? 'Copied' : 'Moved';
    setBulkDest(null);
    return runBulk(verb, (n) => op({ action: bulkDest.mode === 'copy' ? 'copy' : 'rename', path: join(cwd, n), to: join(dir, n) }));
  }
  function runBulkChmod() {
    if (!bulkMode) return;
    const mode = bulkMode.mode;
    setBulkMode(null);
    return runBulk('Updated', (n) => op({ action: 'chmod', path: join(cwd, n), mode }));
  }

  // ---- trash view ----
  async function openTrash() {
    setTrashOpen(true);
    setTrashBusy(true);
    setTrashError(null);
    try {
      const r = await fetch(`${apiBase}?trash=1`);
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setTrashError(j?.error?.message || 'Could not load trash');
        setTrashItems([]);
        return;
      }
      setTrashItems(j?.trash || []);
    } catch (e: any) {
      setTrashError(e?.message || 'Could not load trash');
      setTrashItems([]);
    } finally {
      setTrashBusy(false);
    }
  }
  async function restoreTrash(id: string) {
    if (await trashOp({ action: 'restore', id })) {
      openTrash();
      load();
    }
  }
  async function purgeTrash(id: string) {
    if (confirm('Permanently delete this item? This CANNOT be undone.') && (await trashOp({ action: 'trash-purge', id }))) openTrash();
  }
  async function emptyTrash() {
    if (confirm('Empty the trash? Everything in it is permanently deleted.') && (await trashOp({ action: 'trash-empty' }))) {
      openTrash();
      load();
    }
  }

  function openMenu(ev: React.MouseEvent, entry: Entry) {
    ev.preventDefault();
    ev.stopPropagation();
    const MW = 210;
    const MH = 380;
    const x = Math.max(8, Math.min(ev.clientX, window.innerWidth - MW - 8));
    const y = Math.max(8, Math.min(ev.clientY, window.innerHeight - MH - 8));
    setMenu({ x, y, entry });
  }

  const shown = entries.filter((e) => (showHidden || !e.isHidden) && !TRASH_DIRS.has(e.name));
  const allSelected = shown.length > 0 && shown.every((e) => sel.has(e.name));
  const segs = cwd === '/' ? [] : cwd.split('/').filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button className="rounded-md border border-border px-2 py-1.5 text-xs text-gray-300 hover:bg-[#1c1c20]" onClick={() => load(parent)} title="Up">↑</button>
          <button className="rounded-md border border-border px-2 py-1.5 text-xs text-gray-300 hover:bg-[#1c1c20]" onClick={() => load(home || '/')} title="Home">🏠</button>
          <button className="rounded-md border border-border px-2 py-1.5 text-xs text-gray-300 hover:bg-[#1c1c20]" onClick={() => load()} title="Refresh">↻</button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button className="btn-secondary px-3 py-1.5 text-xs" onClick={openTrash} title="View the trash — restore or permanently delete">🗑 Trash</button>
            <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setMk({ kind: 'file', name: 'new.txt' })}>＋ File</button>
            <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setMk({ kind: 'dir', name: 'new-folder' })}>＋ Folder</button>
            <button className="btn px-3 py-1.5 text-xs" onClick={() => setShowUpload(true)}>⬆ Upload</button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 text-sm">
          <button className="rounded px-1 text-gray-400 hover:text-white" onClick={() => load(home || '/')}>🏠</button>
          {segs.map((seg, i) => {
            const p = '/' + segs.slice(0, i + 1).join('/');
            return (
              <span key={p} className="flex items-center gap-1">
                <span className="text-gray-600">/</span>
                <button className={`rounded px-1 ${i === segs.length - 1 ? 'text-white' : 'text-gray-400 hover:text-white'}`} onClick={() => load(p)}>{seg}</button>
              </span>
            );
          })}
        </div>

        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden
        </label>
      </div>

      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs">
          <span className="font-medium text-accent">{sel.size} selected</span>
          <button className="btn-secondary px-2 py-1 text-[11px]" onClick={compressSelected}>🗜️ Compress</button>
          <button className="btn-secondary px-2 py-1 text-[11px]" onClick={() => setBulkDest({ mode: 'copy', dir: cwd })}>⧉ Copy to…</button>
          <button className="btn-secondary px-2 py-1 text-[11px]" onClick={() => setBulkDest({ mode: 'move', dir: cwd })}>✁ Move to…</button>
          <button className="btn-secondary px-2 py-1 text-[11px]" onClick={() => setBulkMode({ mode: '644' })}>🔒 Permissions</button>
          <button className="btn-secondary px-2 py-1 text-[11px]" onClick={trashSelected}>🗑 Trash</button>
          <button className="btn-danger px-2 py-1 text-[11px]" onClick={deleteSelectedForever} title="Permanent delete — skips the trash">Delete forever</button>
          <button className="ml-auto px-2 py-1 text-[11px] text-gray-400 hover:text-white" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-gray-500">
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => setSel(e.target.checked ? new Set(shown.map((x) => x.name)) : new Set())}
                  title="Select all"
                />
              </th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Size</th>
              <th className="hidden px-3 py-2 sm:table-cell">Permissions</th>
              <th className="hidden px-3 py-2 md:table-cell">Modified</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">Loading…</td></tr>}
            {!loading && shown.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">Empty directory.</td></tr>}
            {!loading &&
              shown.map((e) => {
                const full = join(cwd, e.name);
                const isDir = e.type === 'dir';
                return (
                  <tr
                    key={e.name}
                    className={`border-b border-border/60 hover:bg-[#16161a] ${e.isHidden ? 'opacity-60' : ''} ${sel.has(e.name) ? 'bg-accent/5' : ''}`}
                    onContextMenu={(ev) => openMenu(ev, e)}
                  >
                    <td className="px-3 py-2"><input type="checkbox" checked={sel.has(e.name)} onChange={() => toggle(e.name)} /></td>
                    <td className="px-3 py-2">
                      <button className="flex items-center gap-2 text-left" onClick={() => openRow(e)}>
                        <span>{icon(e)}</span>
                        <span className="truncate text-gray-200">{e.name}</span>
                        {e.symlinkTarget && <span className="text-[10px] text-gray-500">→ {e.symlinkTarget}</span>}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-400">{isDir ? '—' : fmtBytes(e.size)}</td>
                    <td className="hidden px-3 py-2 sm:table-cell">
                      <button className="rounded bg-[#1c1c20] px-1.5 py-0.5 font-mono text-[10px] text-gray-300 hover:text-white" onClick={() => setChmod({ path: full, mode: e.modeOctal })}>{e.mode}</button>
                    </td>
                    <td className="hidden px-3 py-2 font-mono text-[11px] text-gray-500 md:table-cell">{new Date(e.mtime).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2 text-xs">
                        {!isDir && isEditable(e.name) && <button title="Edit" className="text-gray-400 hover:text-white" onClick={() => openEdit(e)}>✎</button>}
                        {!isDir && <a title="Download" className="text-gray-400 hover:text-white" href={`${apiBase}/download?path=${encodeURIComponent(full)}`}>⬇</a>}
                        <button title="Trash (recoverable)" className="text-gray-400 hover:text-white" onClick={() => trashEntry(e)}>🗑</button>
                        <button title="More actions" className="text-gray-400 hover:text-white" onClick={(ev) => openMenu(ev, e)}>⋮</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* right-click / kebab context menu */}
      {menu && (
        <div
          className="fixed z-50 min-w-[190px] overflow-hidden rounded-lg border border-border bg-[#0e0e10] py-1 text-sm shadow-2xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {(() => {
            const e = menu.entry;
            const isDir = e.type === 'dir';
            const full = join(cwd, e.name);
            const item = (label: string, onClick: () => void, opts: { danger?: boolean; icon?: string } = {}) => (
              <button
                className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${opts.danger ? 'text-danger hover:bg-danger/10' : 'text-gray-200 hover:bg-[#1c1c20]'}`}
                onClick={() => {
                  setMenu(null);
                  onClick();
                }}
              >
                <span className="w-4 text-center text-xs">{opts.icon}</span>
                <span>{label}</span>
              </button>
            );
            const sep = <div className="my-1 border-t border-border/60" />;
            return (
              <>
                {item(isDir ? 'Open' : 'Open / view', () => openRow(e), { icon: isDir ? '📂' : '👁' })}
                {!isDir && isEditable(e.name) && item('Edit', () => openEdit(e), { icon: '✎' })}
                {!isDir && (
                  <a
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-gray-200 hover:bg-[#1c1c20]"
                    href={`${apiBase}/download?path=${encodeURIComponent(full)}`}
                    onClick={() => setMenu(null)}
                  >
                    <span className="w-4 text-center text-xs">⬇</span>
                    <span>Download</span>
                  </a>
                )}
                {sep}
                {item('Rename / move', () => setRename({ from: full, to: full }), { icon: '✏' })}
                {item('Copy to…', () => setCopy({ from: full, to: `${full} copy` }), { icon: '⧉' })}
                {item(e.isHidden ? 'Unhide' : 'Hide', () => hideEntry(e), { icon: e.isHidden ? '🙈' : '👁' })}
                {item('Compress (.zip)', () => compressEntry(e), { icon: '🗜️' })}
                {/\.zip$/i.test(e.name) && item('Extract here', () => extractEntry(e), { icon: '📦' })}
                {item('Permissions…', () => setChmod({ path: full, mode: e.modeOctal }), { icon: '🔒' })}
                {sep}
                {item('Move to Trash', () => trashEntry(e), { icon: '🗑' })}
                {item('Delete forever', () => deleteEntryForever(e), { danger: true, icon: '⚠' })}
              </>
            );
          })()}
        </div>
      )}

      <Modal open={!!mk} onClose={() => setMk(null)} title={mk?.kind === 'dir' ? 'New folder' : 'New file'} size="sm"
        footer={<><button className="btn-secondary px-4 py-2 text-sm" onClick={() => setMk(null)}>Cancel</button><button className="btn px-4 py-2 text-sm" onClick={async () => { if (mk) { const ok = await op({ action: mk.kind === 'dir' ? 'mkdir' : 'newfile', path: join(cwd, mk.name) }); if (ok) { setMk(null); load(); } } }}>Create</button></>}>
        {mk && <input autoFocus className="input" value={mk.name} onChange={(e) => setMk({ ...mk, name: e.target.value })} />}
      </Modal>

      <Modal open={!!rename} onClose={() => setRename(null)} title="Rename / move"
        footer={<><button className="btn-secondary px-4 py-2 text-sm" onClick={() => setRename(null)}>Cancel</button><button className="btn px-4 py-2 text-sm" onClick={async () => { if (rename && (await op({ action: 'rename', path: rename.from, to: rename.to }))) { setRename(null); load(); } }}>Save</button></>}>
        {rename && <input autoFocus className="input font-mono text-xs" value={rename.to} onChange={(e) => setRename({ ...rename, to: e.target.value })} />}
        <p className="mt-2 text-[11px] text-gray-500">Edit the full path to rename in place or move within your area.</p>
      </Modal>

      <Modal open={!!copy} onClose={() => setCopy(null)} title="Copy to"
        footer={<><button className="btn-secondary px-4 py-2 text-sm" onClick={() => setCopy(null)}>Cancel</button><button className="btn px-4 py-2 text-sm" onClick={async () => { if (copy && (await op({ action: 'copy', path: copy.from, to: copy.to }))) { setCopy(null); load(); } }}>Copy</button></>}>
        {copy && <input autoFocus className="input font-mono text-xs" value={copy.to} onChange={(e) => setCopy({ ...copy, to: e.target.value })} />}
      </Modal>

      <Modal open={!!chmod} onClose={() => setChmod(null)} title="Permissions (chmod)" size="sm"
        footer={<><button className="btn-secondary px-4 py-2 text-sm" onClick={() => setChmod(null)}>Cancel</button><button className="btn px-4 py-2 text-sm" onClick={async () => { if (chmod && (await op({ action: 'chmod', path: chmod.path, mode: chmod.mode }))) { setChmod(null); load(); } }}>Apply</button></>}>
        {chmod && (
          <div className="space-y-2">
            <input autoFocus className="input font-mono" value={chmod.mode} onChange={(e) => setChmod({ ...chmod, mode: e.target.value.replace(/[^0-7]/g, '').slice(0, 4) })} placeholder="644" />
            <p className="text-[11px] text-gray-500">Octal, e.g. 644 (files), 755 (dirs), 600 (private).</p>
          </div>
        )}
      </Modal>

      {/* bulk copy / move */}
      <Modal open={!!bulkDest} onClose={() => setBulkDest(null)} title={bulkDest?.mode === 'copy' ? `Copy ${sel.size} item(s) to…` : `Move ${sel.size} item(s) to…`} size="sm"
        footer={<><button className="btn-secondary px-4 py-2 text-sm" onClick={() => setBulkDest(null)}>Cancel</button><button className="btn px-4 py-2 text-sm" onClick={runBulkDest}>{bulkDest?.mode === 'copy' ? 'Copy' : 'Move'}</button></>}>
        {bulkDest && (
          <div className="space-y-2">
            <input autoFocus className="input font-mono text-xs" value={bulkDest.dir} onChange={(e) => setBulkDest({ ...bulkDest, dir: e.target.value })} placeholder="/destination/folder" />
            <p className="text-[11px] text-gray-500">Destination folder. Each selected item keeps its name.</p>
          </div>
        )}
      </Modal>

      {/* bulk permissions */}
      <Modal open={!!bulkMode} onClose={() => setBulkMode(null)} title={`Permissions for ${sel.size} item(s)`} size="sm"
        footer={<><button className="btn-secondary px-4 py-2 text-sm" onClick={() => setBulkMode(null)}>Cancel</button><button className="btn px-4 py-2 text-sm" onClick={runBulkChmod}>Apply</button></>}>
        {bulkMode && (
          <div className="space-y-2">
            <input autoFocus className="input font-mono" value={bulkMode.mode} onChange={(e) => setBulkMode({ mode: e.target.value.replace(/[^0-7]/g, '').slice(0, 4) })} placeholder="644" />
            <p className="text-[11px] text-gray-500">Applied to every selected item. Octal, e.g. 644 / 755.</p>
          </div>
        )}
      </Modal>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? edit.path.split('/').pop() : ''} icon={<span>📝</span>} size="lg"
        footer={<><button className="btn-secondary px-4 py-2 text-sm" onClick={() => setEdit(null)}>Cancel</button><button className="btn px-4 py-2 text-sm" onClick={async () => { if (edit && (await op({ action: 'write', path: edit.path, content: edit.content }))) { setEdit(null); load(); } }}>Save</button></>}>
        {edit && <textarea className="input min-h-[360px] w-full font-mono text-xs" value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} spellCheck={false} />}
      </Modal>

      <Modal open={!!props} onClose={() => setProps(null)} title="Properties" size="sm" footer={<button className="btn px-4 py-2 text-sm" onClick={() => setProps(null)}>Close</button>}>
        {props && (
          <dl className="space-y-1.5 text-xs">
            {[['Name', props.name], ['Type', props.type], ['Size', fmtBytes(props.size)], ['Permissions', `${props.mode} (${props.modeOctal})`], ['Modified', new Date(props.mtime).toLocaleString()]].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-gray-500">{k}</dt><dd className="truncate text-gray-200">{v}</dd></div>
            ))}
          </dl>
        )}
      </Modal>

      {/* trash view */}
      <Modal open={trashOpen} onClose={() => { setTrashOpen(false); setTrashError(null); }} title="Trash" icon={<span>🗑</span>} size="lg"
        footer={
          <>
            <button className="btn-secondary px-4 py-2 text-sm" onClick={() => { setTrashOpen(false); setTrashError(null); }}>Close</button>
            <button className="btn-danger px-4 py-2 text-sm" disabled={!trashItems.length} onClick={emptyTrash}>Empty Trash</button>
          </>
        }>
        {trashError && <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{trashError}</div>}
        {trashBusy ? (
          <p className="py-6 text-center text-sm text-gray-500">Loading…</p>
        ) : trashItems.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">Trash is empty.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-1.5">Name</th>
                  <th className="hidden px-2 py-1.5 sm:table-cell">Original location</th>
                  <th className="px-2 py-1.5">Size</th>
                  <th className="hidden px-2 py-1.5 md:table-cell">Deleted</th>
                  <th className="px-2 py-1.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {trashItems.map((t) => (
                  <tr key={t.id} className="border-b border-border/60">
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-2"><span>{icon({ type: t.type, name: t.name })}</span><span className="truncate text-gray-200">{t.name}</span></span>
                    </td>
                    <td className="hidden max-w-[260px] truncate px-2 py-1.5 font-mono text-[10px] text-gray-500 sm:table-cell" title={t.originalPath}>{t.originalPath}</td>
                    <td className="px-2 py-1.5 font-mono text-gray-400">{t.type === 'dir' ? '—' : fmtBytes(t.size)}</td>
                    <td className="hidden px-2 py-1.5 font-mono text-[10px] text-gray-500 md:table-cell">{new Date(t.deletedAt).toLocaleString()}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end gap-2">
                        <button className="text-accent hover:underline" onClick={() => restoreTrash(t.id)}>Restore</button>
                        <button className="text-danger hover:underline" onClick={() => purgeTrash(t.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <UploadModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        apiBase={apiBase}
        cwd={cwd}
        onDone={() => load()}
      />
    </div>
  );
}
