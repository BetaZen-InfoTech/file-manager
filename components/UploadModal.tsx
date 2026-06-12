'use client';

import { useCallback, useRef, useState } from 'react';
import { Modal } from '@/components/Modal';

interface QueueItem {
  id: string;
  name: string;
  rel: string; // path relative to the current dir (may include subfolders)
  file: File;
  size: number;
  status: 'queued' | 'uploading' | 'done' | 'error';
  progress: number;
  error?: string;
}

function fmtBytes(n: number) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let v = n,
    i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

const joinPath = (cwd: string, rel: string) => {
  const r = rel.replace(/^\/+/, '');
  return cwd === '/' || cwd === '' ? `/${r}` : `${cwd.replace(/\/+$/, '')}/${r}`;
};

let idc = 0;
const nextId = () => `u${++idc}-${Math.floor(performance.now())}`;

// Recursively walk a dropped FileSystemEntry (file or directory).
async function walkEntry(entry: any, prefix: string): Promise<{ file: File; rel: string }[]> {
  if (entry.isFile) {
    const file: File = await new Promise((res, rej) => entry.file(res, rej));
    return [{ file, rel: prefix + file.name }];
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const entries: any[] = [];
    // readEntries returns at most ~100 per call — loop until empty.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch: any[] = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      entries.push(...batch);
    }
    const nested = await Promise.all(entries.map((e) => walkEntry(e, prefix + entry.name + '/')));
    return nested.flat();
  }
  return [];
}

export default function UploadModal({
  open,
  onClose,
  apiBase,
  cwd,
  onDone
}: {
  open: boolean;
  onClose: () => void;
  apiBase: string;
  cwd: string;
  onDone: () => void;
}) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: { file: File; rel: string }[]) => {
    setItems((prev) => [
      ...prev,
      ...files.map(({ file, rel }) => ({
        id: nextId(),
        name: file.name,
        rel,
        file,
        size: file.size,
        status: 'queued' as const,
        progress: 0
      }))
    ]);
  }, []);

  function onPick(list: FileList | null, asFolder: boolean) {
    if (!list?.length) return;
    const arr = Array.from(list).map((f) => ({
      file: f,
      rel: asFolder && (f as any).webkitRelativePath ? (f as any).webkitRelativePath : f.name
    }));
    addFiles(arr);
    if (fileRef.current) fileRef.current.value = '';
    if (folderRef.current) folderRef.current.value = '';
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dt = e.dataTransfer;
    const collected: { file: File; rel: string }[] = [];
    const entries: any[] = [];
    for (let i = 0; i < dt.items.length; i++) {
      const it = dt.items[i];
      const entry = (it as any).webkitGetAsEntry ? (it as any).webkitGetAsEntry() : null;
      if (entry) entries.push(entry);
    }
    if (entries.length) {
      const nested = await Promise.all(entries.map((en) => walkEntry(en, '')));
      collected.push(...nested.flat());
    } else {
      // fallback: plain files (no directory support in this browser)
      for (let i = 0; i < dt.files.length; i++) collected.push({ file: dt.files[i], rel: dt.files[i].name });
    }
    if (collected.length) addFiles(collected);
  }

  function uploadOne(item: QueueItem): Promise<void> {
    return new Promise((resolve) => {
      const fd = new FormData();
      fd.append('path', joinPath(cwd, item.rel));
      fd.append('file', item.file, item.name);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${apiBase}/upload`);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          setItems((prev) => prev.map((q) => (q.id === item.id ? { ...q, progress: pct, status: 'uploading' } : q)));
        }
      };
      xhr.onload = () => {
        const okk = xhr.status >= 200 && xhr.status < 300;
        let err: string | undefined;
        if (!okk) {
          try {
            err = JSON.parse(xhr.responseText)?.error?.message;
          } catch {
            /* ignore */
          }
          err = err || `HTTP ${xhr.status}`;
        }
        setItems((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: okk ? 'done' : 'error', progress: okk ? 100 : q.progress, error: err } : q)));
        resolve();
      };
      xhr.onerror = () => {
        setItems((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: 'error', error: 'network error' } : q)));
        resolve();
      };
      xhr.withCredentials = true;
      xhr.send(fd);
    });
  }

  async function startUpload() {
    setBusy(true);
    // snapshot the queued items, upload with a small concurrency pool
    const pending = items.filter((i) => i.status === 'queued' || i.status === 'error').map((i) => ({ ...i, status: 'queued' as const, progress: 0, error: undefined }));
    setItems((prev) => prev.map((q) => (pending.find((p) => p.id === q.id) ? { ...q, status: 'queued', progress: 0, error: undefined } : q)));
    const POOL = 3;
    let idx = 0;
    async function worker() {
      while (idx < pending.length) {
        const item = pending[idx++];
        await uploadOne(item);
      }
    }
    await Promise.all(Array.from({ length: Math.min(POOL, pending.length) }, worker));
    setBusy(false);
    onDone();
  }

  function reset() {
    setItems([]);
    setBusy(false);
  }

  const total = items.length;
  const done = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'error').length;
  const totalBytes = items.reduce((a, i) => a + i.size, 0);
  const overall = total ? Math.round(items.reduce((a, i) => a + (i.status === 'done' ? 100 : i.progress), 0) / total) : 0;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) {
          reset();
          onClose();
        }
      }}
      title="Upload files & folders"
      icon={<span>⬆️</span>}
      size="lg"
      footer={
        <>
          <button className="btn-secondary px-4 py-2 text-sm" disabled={busy} onClick={() => { reset(); onClose(); }}>
            {done > 0 && !busy ? 'Done' : 'Cancel'}
          </button>
          <button className="btn px-4 py-2 text-sm" disabled={busy || !items.some((i) => i.status === 'queued' || i.status === 'error')} onClick={startUpload}>
            {busy ? `Uploading… ${overall}%` : `Upload ${items.filter((i) => i.status !== 'done').length || ''}`.trim()}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {/* drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
            dragOver ? 'border-accent bg-accent/10' : 'border-border bg-[#141417]'
          }`}
        >
          <div className="text-3xl">📂</div>
          <div className="text-sm text-gray-300">
            Drag &amp; drop files or whole folders here
          </div>
          <div className="text-xs text-gray-500">…or pick them manually</div>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => fileRef.current?.click()}>Choose files</button>
            <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => folderRef.current?.click()}>Choose folder</button>
          </div>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => onPick(e.target.files, false)} />
          <input
            ref={folderRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => onPick(e.target.files, true)}
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          />
        </div>

        {/* summary + overall progress */}
        {total > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>
                {total} item{total > 1 ? 's' : ''} · {fmtBytes(totalBytes)}
                {done > 0 && <span className="text-emerald-400"> · {done} done</span>}
                {failed > 0 && <span className="text-danger"> · {failed} failed</span>}
              </span>
              {busy && <span className="font-mono">{overall}%</span>}
            </div>
            {busy && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1c1c20]">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${overall}%` }} />
              </div>
            )}
          </div>
        )}

        {/* file list */}
        {total > 0 && (
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {items.map((it) => (
              <div key={it.id} className="rounded-lg border border-border/60 bg-[#141417] px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-gray-200" title={it.rel}>
                    {it.rel.includes('/') ? <span className="text-gray-500">{it.rel.slice(0, it.rel.lastIndexOf('/') + 1)}</span> : null}
                    {it.name}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-gray-500">
                    {it.status === 'done' ? '✅' : it.status === 'error' ? '❌' : it.status === 'uploading' ? `${it.progress}%` : fmtBytes(it.size)}
                  </span>
                </div>
                {(it.status === 'uploading' || it.status === 'done') && (
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[#1c1c20]">
                    <div className={`h-full rounded-full ${it.status === 'done' ? 'bg-emerald-500' : 'bg-accent'}`} style={{ width: `${it.progress}%` }} />
                  </div>
                )}
                {it.error && <div className="mt-1 text-[10px] text-danger">{it.error}</div>}
                {it.status === 'queued' && !busy && (
                  <button className="mt-0.5 text-[10px] text-gray-500 hover:text-danger" onClick={() => setItems((prev) => prev.filter((q) => q.id !== it.id))}>
                    remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
