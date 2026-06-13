'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal, CopyButton } from '@/components/Modal';

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
  const [mode, setMode] = useState<'bcdnp' | 'bcdnp-full' | 's3'>('bcdnp');
  const [bcdnp, setBcdnp] = useState({ baseUrl: '', token: '' });
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

  // token generator
  const [tokHours, setTokHours] = useState(24);
  const [newToken, setNewToken] = useState<string | null>(null);

  function payload(action: string): any {
    const p: any = { action, sourceType: mode };
    if (mode === 's3') p.source = src;
    else p.bcdnp = bcdnp;
    // Full migration imports ALL vendors — no single target.
    if (action === 'start' && mode !== 'bcdnp-full') {
      p.targetVendorId = vendorId;
      p.targetBucketName = bucketName;
    }
    return p;
  }

  async function call(action: 'test' | 'discover' | 'start') {
    setBusy(action);
    setMsg(null);
    const res = await fetch('/api/v1/admin/migration', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload(action))
    });
    const j = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) {
      setMsg(j?.error?.message || 'Failed.');
      return;
    }
    if (action === 'test') setMsg(j.ok ? `✓ ${j.message}` : `✗ ${j.message}`);
    if (action === 'discover') j.ok ? setDiscover({ objects: j.objects, bytes: j.bytes }) : setMsg(`✗ ${j.message}`);
    if (action === 'start') {
      setJobId(j.id);
      setMsg('Transfer started — it keeps running on the server even if you close this tab.');
    }
  }

  async function jobAction(action: 'cancel' | 'resume') {
    if (!jobId) return;
    await fetch('/api/v1/admin/migration', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, id: jobId })
    });
  }

  async function genToken() {
    setBusy('token');
    const res = await fetch('/api/v1/admin/transfer-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create', hours: tokHours, label: 'transfer' })
    });
    const j = await res.json().catch(() => null);
    setBusy(null);
    if (res.ok) setNewToken(j.token);
    else setMsg(j?.error?.message || 'Could not generate token.');
  }

  // On mount, re-attach to the newest non-terminal job (survives reload).
  useEffect(() => {
    fetch('/api/v1/admin/migration')
      .then((r) => r.json())
      .then((d) => {
        const live = (d.jobs || []).find((x: any) => x.status === 'running' || x.status === 'pending');
        if (live) setJobId(String(live._id));
      })
      .catch(() => {});
  }, []);

  // Poll the active job.
  useEffect(() => {
    if (!jobId) return;
    const tick = async () => {
      const r = await fetch(`/api/v1/admin/migration?id=${jobId}`);
      const j = await r.json().catch(() => null);
      if (j && !j.error) {
        setJob(j);
        if (['completed', 'failed', 'cancelled'].includes(j.status)) clearInterval(timer.current);
      }
    };
    tick();
    timer.current = setInterval(tick, 2000);
    return () => clearInterval(timer.current);
  }, [jobId]);

  const running = job && (job.status === 'running' || job.status === 'pending');

  return (
    <div className="space-y-5">
      {/* ===== Pull INTO this server ===== */}
      <section className="card space-y-4">
        <h2 className="text-sm font-semibold text-white">Import files into this server</h2>

        <div className="flex flex-wrap gap-2">
          <button
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${mode === 'bcdnp' ? 'border-accent bg-accent/15 text-accent' : 'border-border text-gray-400'}`}
            onClick={() => {
              setMode('bcdnp');
              setDiscover(null);
            }}
          >
            Files from another bcdnp
          </button>
          <button
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${mode === 'bcdnp-full' ? 'border-accent bg-accent/15 text-accent' : 'border-border text-gray-400'}`}
            onClick={() => {
              setMode('bcdnp-full');
              setDiscover(null);
            }}
          >
            Full server migration
          </button>
          <button
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${mode === 's3' ? 'border-accent bg-accent/15 text-accent' : 'border-border text-gray-400'}`}
            onClick={() => {
              setMode('s3');
              setDiscover(null);
            }}
          >
            From S3 storage
          </button>
        </div>

        {mode === 'bcdnp-full' && (
          <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-[11px] leading-relaxed text-gray-300">
            <span className="font-medium text-accent">Full migration</span> imports the <strong>entire</strong> source
            server: vendors, users &amp; logins, API keys, buckets, folders, files, share links, plans, payments,
            settings and audit logs. Vendors are matched by <strong>slug</strong> and merged; files override when
            path+name+size match (byte-identical are skipped); password &amp; API-key hashes carry over so logins and
            keys keep working. Use an <strong>instance-scoped</strong> transfer token from the old server.
          </div>
        )}

        {mode !== 's3' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[11px] text-gray-400">
              Old server URL (or IP)
              <input className="input mt-1" placeholder="https://old.example.com" value={bcdnp.baseUrl} onChange={(e) => { setBcdnp({ ...bcdnp, baseUrl: e.target.value }); setDiscover(null); }} />
            </label>
            <label className="text-[11px] text-gray-400">
              Transfer token (fmt_…)
              <input className="input mt-1" placeholder="fmt_…" value={bcdnp.token} onChange={(e) => { setBcdnp({ ...bcdnp, token: e.target.value }); setDiscover(null); }} />
            </label>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[11px] text-gray-400">S3 endpoint<input className="input mt-1" placeholder="https://s3… or http://ip:9000" value={src.endpoint} onChange={(e) => { setSrc({ ...src, endpoint: e.target.value }); setDiscover(null); }} /></label>
            <label className="text-[11px] text-gray-400">Region<input className="input mt-1" value={src.region} onChange={(e) => setSrc({ ...src, region: e.target.value })} /></label>
            <label className="text-[11px] text-gray-400">Access key<input className="input mt-1" value={src.accessKey} onChange={(e) => setSrc({ ...src, accessKey: e.target.value })} /></label>
            <label className="text-[11px] text-gray-400">Secret key<input className="input mt-1" type="password" value={src.secretKey} onChange={(e) => setSrc({ ...src, secretKey: e.target.value })} /></label>
            <label className="text-[11px] text-gray-400">Bucket<input className="input mt-1" value={src.bucket} onChange={(e) => setSrc({ ...src, bucket: e.target.value })} /></label>
            <label className="text-[11px] text-gray-400">Prefix (optional)<input className="input mt-1" value={src.prefix} onChange={(e) => setSrc({ ...src, prefix: e.target.value })} /></label>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-secondary" disabled={!!busy} onClick={() => call('test')}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
          <button className="btn-secondary" disabled={!!busy} onClick={() => call('discover')}>{busy === 'discover' ? 'Scanning…' : 'Discover'}</button>
          {discover && <span className="chip self-center">{discover.objects} files · {fmtBytes(discover.bytes)}</span>}
        </div>

        {mode !== 'bcdnp-full' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[11px] text-gray-400">
              Target vendor (here)
              <select className="input mt-1" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                {vendors.length === 0 && <option value="">— no vendors —</option>}
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.slug})</option>)}
              </select>
            </label>
            {mode === 's3' && (
              <label className="text-[11px] text-gray-400">Target bucket name<input className="input mt-1" value={bucketName} onChange={(e) => setBucketName(e.target.value)} /></label>
            )}
          </div>
        )}

        <button
          className="btn"
          disabled={
            !!busy ||
            !!running ||
            (mode === 's3'
              ? !src.endpoint || !src.bucket || !vendorId
              : !bcdnp.baseUrl || !bcdnp.token || (mode === 'bcdnp' && !vendorId))
          }
          onClick={() => {
            const m =
              mode === 'bcdnp-full'
                ? 'Start the FULL server migration? This imports all vendors, users, keys, files, links and settings from the source (merging by slug). It keeps running on the server.'
                : 'Start the import? It streams files directly (no zip) and keeps running on the server.';
            if (confirm(m)) call('start');
          }}
        >
          {running ? 'Migration running…' : mode === 'bcdnp-full' ? 'Start full migration' : 'Start transfer'}
        </button>
        {msg && <div className="text-xs text-gray-300">{msg}</div>}
      </section>

      {/* ===== progress ===== */}
      {job && (
        <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">
              Transfer ·{' '}
              <span className={job.status === 'failed' ? 'text-rose-300' : job.status === 'completed' ? 'text-emerald-300' : job.status === 'cancelled' ? 'text-gray-400' : 'text-amber-300'}>{job.status}</span>
            </h2>
            <span className="text-xs text-gray-400">
              {job.done?.objects || 0}/{job.totals?.objects || 0} · {fmtBytes(job.done?.bytes || 0)}
              {job.throughputMbps ? ` · ${job.throughputMbps} MB/s` : ''}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#1c1c20]">
            <div className="h-full bg-accent transition-all" style={{ width: `${job.progress || 0}%` }} />
          </div>
          {job.currentItem && <div className="truncate text-[11px] text-gray-500">{job.currentItem}</div>}
          <div className="flex flex-wrap gap-2">
            {(job.steps || []).map((s: any) => (
              <span key={s.name} className="chip">{s.status === 'completed' ? '✓' : s.status === 'failed' ? '✗' : s.status === 'running' ? '…' : '·'} {s.name}{s.detail ? ` (${s.detail})` : ''}</span>
            ))}
          </div>
          {job.report && Object.keys(job.report).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(job.report).map(([k, v]: any) => (
                <span key={k} className="rounded bg-[#1c1c20] px-2 py-0.5 font-mono text-[10px] text-gray-300">
                  <span className="text-gray-500">{k}:</span> {Object.entries(v || {}).filter(([kk]) => kk !== 'bytes').map(([kk, vv]) => `${vv} ${kk}`).join(' · ')}
                </span>
              ))}
            </div>
          )}
          {(job.done?.skipped > 0 || job.done?.failed > 0) && (
            <div className="text-[11px] text-gray-400">{job.done.skipped} skipped · {job.done.failed} failed</div>
          )}
          <div className="flex gap-2">
            {running && <button className="btn-danger px-3 py-1.5 text-xs" onClick={() => jobAction('cancel')}>Cancel</button>}
            {(job.status === 'failed' || job.status === 'cancelled') && (
              <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => jobAction('resume')}>Resume</button>
            )}
          </div>
          {job.logs?.length > 0 && (
            <pre className="max-h-56 overflow-auto rounded-md border border-border bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-gray-300">
              {job.logs.map((l: any) => `[${l.level}] ${l.message}`).join('\n')}
            </pre>
          )}
        </section>
      )}

      {/* ===== Let another server pull FROM here ===== */}
      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-white">Let another server pull from here</h2>
        <p className="text-xs text-gray-400">
          Generate a time-limited transfer token, then enter it (with this server&apos;s URL) on the NEW
          server&apos;s Migration page. Files stream directly — no zip, no extra disk.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[11px] text-gray-400">
            Valid for
            <select className="input ml-2 inline-block w-28" value={tokHours} onChange={(e) => setTokHours(Number(e.target.value))}>
              <option value={6}>6 hours</option>
              <option value={24}>24 hours</option>
              <option value={72}>3 days</option>
              <option value={168}>7 days</option>
            </select>
          </label>
          <button className="btn" disabled={busy === 'token'} onClick={genToken}>
            {busy === 'token' ? 'Generating…' : 'Generate transfer token'}
          </button>
        </div>
      </section>

      {/* token reveal modal */}
      <Modal
        open={!!newToken}
        onClose={() => setNewToken(null)}
        title="Transfer token created"
        icon={<span className="text-lg">🔑</span>}
        footer={
          <>
            {newToken && <CopyButton text={newToken} className="px-4 py-2 text-sm" />}
            <button className="btn px-4 py-2 text-sm" onClick={() => setNewToken(null)}>I&apos;ve copied it</button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            Copy now — shown once. Enter it on the new server along with this server&apos;s URL.
          </div>
          <code className="block break-all rounded-lg border border-border bg-black/40 p-3 font-mono text-xs text-emerald-300">{newToken}</code>
        </div>
      </Modal>
    </div>
  );
}
