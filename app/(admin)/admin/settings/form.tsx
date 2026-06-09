'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SslStatus } from '@/lib/server-control';

export default function ServerForm({
  initialDomain,
  initialStatus,
  adminEmail
}: {
  initialDomain: string;
  initialStatus: SslStatus;
  adminEmail: string;
}) {
  const router = useRouter();
  const [domain, setDomain] = useState(initialDomain);
  const [email, setEmail] = useState(adminEmail);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const s = initialStatus;

  async function call(action: string, body: Record<string, unknown>) {
    setBusy(action);
    setStatus(null);
    const res = await fetch('/api/v1/admin/server', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...body })
    });
    const j = await res.json().catch(() => null);
    setBusy(null);
    if (res.ok) {
      setStatus(j?.data?.message || 'Done.');
      router.refresh();
    } else {
      setStatus(j?.error?.message ? `Failed: ${j.error.message}` : 'Failed.');
    }
  }

  const Badge = ({ ok, label }: { ok: boolean; label: string }) => (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] ${
        ok ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'
      }`}
    >
      {ok ? '✓ ' : '✗ '}
      {label}
    </span>
  );

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="text-sm font-medium text-white">Current status — {s.domain || '(unset)'}</div>
        {s.available ? (
          <div className="flex flex-wrap gap-2">
            <Badge ok={s.certPresent} label="SSL certificate" />
            <Badge ok={s.redirectEnabled} label="HTTPS redirect" />
            <Badge ok={s.nginxOk} label="nginx config" />
            {s.certExpiry && (
              <span className="rounded-full bg-[#1c1c20] px-2 py-0.5 text-[11px] text-gray-300">
                expires {s.certExpiry}
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-yellow-400">
            Server helper unavailable: {s.error}. (Expected in local dev; works on the VPS after
            install.)
          </p>
        )}
      </div>

      <div className="card space-y-3">
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Domain</label>
          <input className="input" value={domain} onChange={(e) => setDomain(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Email (for Let&apos;s Encrypt)</label>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <button
            className="btn"
            disabled={!!busy}
            onClick={() => call('issue-ssl', { domain, email })}
          >
            {busy === 'issue-ssl' ? 'Issuing…' : 'Issue / renew SSL'}
          </button>
          <button
            className="btn"
            disabled={!!busy}
            onClick={() => call('force-https', { domain })}
          >
            {busy === 'force-https' ? 'Applying…' : 'Force HTTPS'}
          </button>
          <button
            className="btn"
            disabled={!!busy}
            onClick={() => {
              if (confirm(`Point the panel's nginx vhost at ${domain}? Issue SSL afterwards.`))
                call('set-domain', { domain });
            }}
          >
            {busy === 'set-domain' ? 'Setting…' : 'Set domain'}
          </button>
        </div>
        {status && <div className="text-xs text-gray-300">{status}</div>}
        <p className="text-[11px] text-gray-500">
          Note: changing the domain rewrites the nginx vhost and the panel&apos;s canonical URL. To
          also change the app&apos;s <code>APP_URL</code> env, run <code>sudo bcdnp domain</code>
          and reload, or edit <code>.env</code>.
        </p>
      </div>
    </div>
  );
}
