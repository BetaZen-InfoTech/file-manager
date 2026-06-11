'use client';

import { useEffect, useRef, useState } from 'react';

interface Vendor {
  id: string;
  name: string;
  slug: string;
}
type Job = any;

function fmtBytes(n: number) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n,
    i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export default function MigrationClient({ vendors }: { vendors: Vendor[] }) {
  const [src, setSrc] = useState({
    endpoint: '',
    region: 'us-east-1',
    accessKey: '',
    secretKey: '',
    bucket: '',
    prefix: '',
    forcePathStyle: true
  });
  const [vendorId, setVendorId] = useState(vendors[0]?.id || '');
  const [bucketName, setBucketName] = useState('imported');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [discover, setDiscover] = useState<{ objects: number; bytes: number } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const timer = useRef<any>(null);

  function set<K extends keyof typeof src>(k: K, v: (typeof src)[K]) {
    setSrc((s) => ({ ...s, [k]: v }));
    setDiscover(null);
  }

  async function call(action: 'test' | 'discover' | 'start') {
    setBusy(action);
    setMsg(null);
    const body: any = { action, source: src };
    if (action === 'start') {
      body.targetVendorId = vendorId;
      body.targetBucketName = bucketName;
    }
    const res = await fetch('/api/v1/admin/migration', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const j = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) {
      setMsg(j?.error?.message || 'Failed.');
      return;
    }
    if (action === 'test') setMsg(j.ok ? `✓ ${j.message}` : `✗ ${j.message}`);
    if (action === 'discover')
      j.ok ? setDiscover({ objects: j.objects, bytes: j.bytes }) : setMsg(`✗ ${j.message}`);
    if (action === 'start') {
      setJobId(j.id);
      setMsg('Migration started.');
    }
  }

  // Poll the running job.
  useEffect(() => {
    if (!jobId) return;
    const tick = async () => {
      const r = await fetch(`/api/v1/admin/migration?id=${jobId}`);
      const j = await r.json().catch(() => null);
      if (j && !j.error) {
        setJob(j);
        if (j.status === 'completed' || j.status === 'failed') {
          clearInterval(timer.current);
        }
      }
    };
    tick();
    timer.current = setInterval(tick, 2000);
    return () => clearInterval(timer.current);
  }, [jobId]);

  const running = job && (job.status === 'running' || job.status === 'pending');

  return (
    <div className="space-y-5">
      {/* source */}
      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-white">Source storage (the other server)</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[11px] text-gray-400">
            S3 endpoint
            <input className="input mt-1" placeholder="https://s3.amazonaws.com or http://1.2.3.4:9000" value={src.endpoint} onChange={(e) => set('endpoint', e.target.value)} />
          </label>
          <label className="text-[11px] text-gray-400">
            Region
            <input className="input mt-1" value={src.region} onChange={(e) => set('region', e.target.value)} />
          </label>
          <label className="text-[11px] text-gray-400">
            Access key
            <input className="input mt-1" value={src.accessKey} onChange={(e) => set('accessKey', e.target.value)} />
          </label>
          <label className="text-[11px] text-gray-400">
            Secret key
            <input className="input mt-1" type="password" value={src.secretKey} onChange={(e) => set('secretKey', e.target.value)} />
          </label>
          <label className="text-[11px] text-gray-400">
            Bucket
            <input className="input mt-1" value={src.bucket} onChange={(e) => set('bucket', e.target.value)} />
          </label>
          <label className="text-[11px] text-gray-400">
            Prefix (optional)
            <input className="input mt-1" placeholder="folder/subfolder/" value={src.prefix} onChange={(e) => set('prefix', e.target.value)} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-300">
          <input type="checkbox" checked={src.forcePathStyle} onChange={(e) => set('forcePathStyle', e.target.checked)} />
          Path-style URLs (on for MinIO; off for AWS S3)
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" disabled={!!busy} onClick={() => call('test')}>
            {busy === 'test' ? 'Testing…' : 'Test connection'}
          </button>
          <button className="btn-secondary" disabled={!!busy} onClick={() => call('discover')}>
            {busy === 'discover' ? 'Scanning…' : 'Discover'}
          </button>
          {discover && (
            <span className="chip self-center">
              {discover.objects} objects · {fmtBytes(discover.bytes)}
            </span>
          )}
        </div>
        {msg && <div className="text-xs text-gray-300">{msg}</div>}
      </section>

      {/* destination */}
      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-white">Destination (here)</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[11px] text-gray-400">
            Target vendor
            <select className="input mt-1" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              {vendors.length === 0 && <option value="">— no vendors —</option>}
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.slug})
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-gray-400">
            Target bucket name
            <input className="input mt-1" value={bucketName} onChange={(e) => setBucketName(e.target.value)} />
          </label>
        </div>
        <button
          className="btn"
          disabled={!!busy || !!running || !vendorId || !src.endpoint || !src.bucket}
          onClick={() => {
            if (confirm(`Import all objects from "${src.bucket}" into ${bucketName}? This copies files into your storage.`)) call('start');
          }}
        >
          {running ? 'Migration running…' : 'Start migration'}
        </button>
      </section>

      {/* progress */}
      {job && (
        <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">
              Migration ·{' '}
              <span className={job.status === 'failed' ? 'text-rose-300' : job.status === 'completed' ? 'text-emerald-300' : 'text-amber-300'}>
                {job.status}
              </span>
            </h2>
            <span className="text-xs text-gray-400">
              {job.done?.objects || 0}/{job.totals?.objects || 0} · {fmtBytes(job.done?.bytes || 0)}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#1c1c20]">
            <div className="h-full bg-accent transition-all" style={{ width: `${job.progress || 0}%` }} />
          </div>
          {job.currentItem && <div className="truncate text-[11px] text-gray-500">{job.currentItem}</div>}
          <div className="flex flex-wrap gap-2">
            {(job.steps || []).map((s: any) => (
              <span key={s.name} className="chip">
                {s.status === 'completed' ? '✓' : s.status === 'failed' ? '✗' : s.status === 'running' ? '…' : '·'} {s.name}
                {s.detail ? ` (${s.detail})` : ''}
              </span>
            ))}
          </div>
          {(job.done?.skipped > 0 || job.done?.failed > 0) && (
            <div className="text-[11px] text-gray-400">
              {job.done.skipped} skipped · {job.done.failed} failed
            </div>
          )}
          {job.logs?.length > 0 && (
            <pre className="max-h-56 overflow-auto rounded-md border border-border bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-gray-300">
              {job.logs.map((l: any, idx: number) => `[${l.level}] ${l.message}`).join('\n')}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}
