'use client';

import { useState } from 'react';

export default function DatabaseForm({
  maskedUri,
  connected
}: {
  maskedUri: string;
  connected: boolean;
}) {
  const [uri, setUri] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tested, setTested] = useState<{ ok: boolean; hasSuperAdmin: boolean } | null>(null);

  async function call(action: 'test' | 'apply') {
    if (!uri.trim()) {
      setMsg('Enter a MongoDB URI first.');
      return;
    }
    setBusy(action);
    setMsg(null);
    const res = await fetch('/api/v1/admin/database', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, uri: uri.trim() })
    });
    const j = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) {
      setTested(null);
      setMsg(j?.error?.message || 'Failed.');
      return;
    }
    if (action === 'test') {
      setTested({ ok: j.ok, hasSuperAdmin: j.hasSuperAdmin });
      setMsg(
        j.ok
          ? `✓ ${j.message}${j.hasSuperAdmin ? ' (has super_admin)' : ' — ⚠ no super_admin in that DB'}`
          : `✗ ${j.message}`
      );
    } else {
      setMsg(j.message || 'Applied. Reloading…');
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            connected ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'
          }`}
        >
          {connected ? '✓ connected' : '✗ disconnected'}
        </span>
        <code className="truncate text-xs text-gray-400">{maskedUri || '(not set)'}</code>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-gray-400">New MONGODB_URI</label>
        <input
          className="input"
          placeholder="mongodb://user:pass@host:27017/db?authSource=admin"
          value={uri}
          onChange={(e) => {
            setUri(e.target.value);
            setTested(null);
          }}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={!!busy} onClick={() => call('test')}>
          {busy === 'test' ? 'Testing…' : 'Test connection'}
        </button>
        <button
          className="btn"
          disabled={!!busy || !tested?.ok}
          onClick={() => {
            const warn = tested && !tested.hasSuperAdmin;
            if (
              confirm(
                `Apply this MongoDB URI and reload the panel?${
                  warn ? '\n\n⚠ The target database has NO super_admin — you could be locked out.' : ''
                }`
              )
            )
              call('apply');
          }}
        >
          {busy === 'apply' ? 'Applying…' : 'Apply & reload'}
        </button>
      </div>

      {msg && <div className="text-xs text-gray-300">{msg}</div>}
      <p className="text-[11px] text-gray-500">
        Apply is enabled only after a successful test. The previous <code>.env</code> is backed up
        automatically. If the panel doesn&apos;t come back, fix it from the server with{' '}
        <code>sudo bcdnp</code> (option 7).
      </p>
    </div>
  );
}
