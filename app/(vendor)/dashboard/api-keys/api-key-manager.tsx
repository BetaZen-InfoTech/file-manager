'use client';

import { useState } from 'react';
import { Modal, CopyButton } from '@/components/Modal';
import { SCOPE_GROUPS, ALL_SCOPES } from '@/lib/api-catalog';

type KeyRow = {
  _id: string;
  name: string;
  prefix: string;
  permissions: string[];
  status: string;
  createdAt: string;
  lastUsedAt?: string | null;
};

function timeAgo(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso).getTime();
  const s = Math.round((Date.now() - d) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function ApiKeyManager({ initial }: { initial: KeyRow[] }) {
  const [items, setItems] = useState<KeyRow[]>(initial);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['file:list', 'file:read', 'file:download']);
  const [busy, setBusy] = useState(false);
  const [plain, setPlain] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<KeyRow | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (scopes.length === 0) {
      setError('Pick at least one scope.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch('/api/v1/api-keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, permissions: scopes })
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data?.error?.message || 'Failed to create key.');
      return;
    }
    setPlain(data.key); // opens the "created" modal
    setItems((prev) => [
      {
        _id: data.id,
        name: data.name,
        prefix: data.prefix,
        permissions: data.permissions,
        status: 'active',
        createdAt: new Date().toISOString()
      },
      ...prev
    ]);
    setName('');
  }

  async function confirmRevoke() {
    if (!revoking) return;
    const id = revoking._id;
    const res = await fetch(`/api/v1/api-keys/${id}`, { method: 'DELETE' });
    if (res.ok) setItems((prev) => prev.map((k) => (k._id === id ? { ...k, status: 'revoked' } : k)));
    setRevoking(null);
  }

  function toggleScope(s: string) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  const activeCount = items.filter((k) => k.status === 'active').length;

  return (
    <div className="space-y-6">
      {/* Create */}
      <form onSubmit={create} className="card space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-400">Key name</label>
          <input
            className="input"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Production API"
          />
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">Scopes</span>
            <div className="flex gap-2 text-[11px]">
              <button type="button" className="text-accent hover:underline" onClick={() => setScopes([...ALL_SCOPES])}>
                All
              </button>
              <button type="button" className="text-gray-500 hover:underline" onClick={() => setScopes([])}>
                None
              </button>
            </div>
          </div>
          <p className="text-[11px] text-gray-500">
            Grant only what the integration needs. A key with no matching scope is rejected for that action.
            The <span className="text-gray-300">file manager</span> and public download links need no specific scope.
          </p>
          {SCOPE_GROUPS.map((grp) => (
            <div key={grp.group} className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">{grp.group}</div>
              <div className="flex flex-wrap gap-2">
                {grp.scopes.map((s) => {
                  const on = scopes.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      title={s.label}
                      onClick={() => toggleScope(s.id)}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] transition ${
                        on
                          ? 'border-accent/60 bg-accent/15 text-accent'
                          : 'border-border text-gray-400 hover:border-gray-500 hover:text-gray-200'
                      }`}
                    >
                      <span className={`flex h-3 w-3 items-center justify-center rounded-full text-[8px] ${on ? 'bg-accent text-white' : 'border border-gray-600'}`}>
                        {on ? '✓' : ''}
                      </span>
                      <span className="font-mono">{s.id}</span>
                      <span className="hidden text-gray-500 sm:inline">· {s.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
        )}
        <button className="btn w-full sm:w-auto" disabled={busy}>
          {busy ? 'Creating…' : '＋ Create key'}
        </button>
      </form>

      {/* List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold text-white">Your keys</h2>
          <span className="text-xs text-gray-500">{activeCount} active</span>
        </div>

        {items.length === 0 ? (
          <div className="card flex flex-col items-center gap-2 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1c1c20] text-gray-500">🔑</div>
            <p className="text-sm text-gray-400">No API keys yet. Create one above to start using the API.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {items.map((k) => (
              <div
                key={k._id}
                className={`card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
                  k.status !== 'active' ? 'opacity-60' : ''
                }`}
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{k.name}</span>
                    {k.status === 'active' ? (
                      <span className="chip-success">active</span>
                    ) : (
                      <span className="chip-danger">revoked</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <code className="rounded bg-[#1c1c20] px-1.5 py-0.5 font-mono text-gray-300">{k.prefix}…</code>
                    <span>· last used {timeAgo(k.lastUsedAt)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {k.permissions.map((p) => (
                      <span key={p} className="rounded bg-[#1c1c20] px-1.5 py-0.5 font-mono text-[10px] text-gray-400">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
                {k.status === 'active' && (
                  <button
                    className="btn-danger shrink-0 px-3 py-1.5 text-xs"
                    onClick={() => setRevoking(k)}
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Created-key modal (shown once) */}
      <Modal
        open={!!plain}
        onClose={() => setPlain(null)}
        title="API key created"
        icon={<span className="text-lg">🔑</span>}
        footer={
          <>
            {plain && <CopyButton text={plain} className="px-4 py-2 text-sm" />}
            <button className="btn px-4 py-2 text-sm" onClick={() => setPlain(null)}>
              I&apos;ve saved it
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            Copy this now — it&apos;s the <strong>only time</strong> the full key is shown.
          </div>
          <code className="block break-all rounded-lg border border-border bg-black/40 p-3 font-mono text-xs text-emerald-300">
            {plain}
          </code>
        </div>
      </Modal>

      {/* Revoke confirm modal */}
      <Modal
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title="Revoke API key"
        icon={<span className="text-lg">⚠️</span>}
        size="sm"
        footer={
          <>
            <button className="btn-secondary px-4 py-2 text-sm" onClick={() => setRevoking(null)}>
              Cancel
            </button>
            <button className="btn-danger px-4 py-2 text-sm" onClick={confirmRevoke}>
              Revoke key
            </button>
          </>
        }
      >
        <p className="text-sm text-gray-300">
          Revoke <strong className="text-white">{revoking?.name}</strong>? Any integration using it will
          immediately stop working. This can&apos;t be undone.
        </p>
      </Modal>
    </div>
  );
}
