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
function icon(e: Entry) {
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
  async function zipSelected() {
    const paths = [...sel].map((n) => join(cwd, n));
    if (!paths.length) return;
    if (await op({ action: 'zip', path: paths[0], paths, to: join(cwd, `archive-${Date.now()}.zip`) })) load();
  }
  async function deleteSelected() {
    if (!confirm(`Permanently delete ${sel.size} item(s)? This cannot be undone.`)) return;
    for (const n of sel) await op({ action: 'delete', path: join(cwd, n) });
    load();
  }

  const shown = entries.filter((e) => showHidden || !e.isHidden);
  const segs = cwd === '/' ? [] : cwd.split('/').filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button className="rounded-md border border-border px-2 py-1.5 text-xs text-gray-300 hover:bg-[#1c1c20]" onClick={() => load(parent)} title="Up">↑</button>
          <button className="rounded-md border border-border px-2 py-1.5 text-xs text-gray-300 hover:bg-[#1c1c20]" onClick={() => load(home || '/')} title="Home">🏠</button>
          <button className="rounded-md border border-border px-2 py-1.5 text-xs text-gray-300 hover:bg-[#1c1c20]" onClick={() => load()} title="Refresh">↻</button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
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
          <span className="text-accent">{sel.size} selected</span>
          <button className="btn-secondary px-2 py-1 text-[11px]" onClick={zipSelected}>🗜️ Zip</button>
          <button className="btn-danger px-2 py-1 text-[11px]" onClick={deleteSelected}>Delete</button>
          <button className="px-2 py-1 text-[11px] text-gray-400 hover:text-white" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      {error && <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-gray-500">
              <th className="w-8 px-3 py-2"></th>
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
                  <tr key={e.name} className={`border-b border-border/60 hover:bg-[#16161a] ${e.isHidden ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-2">{e.type === 'file' && <input type="checkbox" checked={sel.has(e.name)} onChange={() => toggle(e.name)} />}</td>
                    <td className="px-3 py-2">
                      <button className="flex items-center gap-2 text-left" onClick={() => (isDir ? load(full) : isEditable(e.name) ? openEdit(e) : setProps(e))}>
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
                        <button title="Rename / move" className="text-gray-400 hover:text-white" onClick={() => setRename({ from: full, to: full })}>✏</button>
                        <button title="Copy" className="text-gray-400 hover:text-white" onClick={() => setCopy({ from: full, to: `${full} copy` })}>⧉</button>
                        {/\.zip$/i.test(e.name) && <button title="Extract" className="text-gray-400 hover:text-white" onClick={async () => { if (await op({ action: 'extract', path: full, to: cwd })) load(); }}>📦</button>}
                        <button title="Delete" className="text-danger hover:opacity-80" onClick={async () => { if (confirm(`Delete ${e.name}? This cannot be undone.`) && (await op({ action: 'delete', path: full }))) load(); }}>🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

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
