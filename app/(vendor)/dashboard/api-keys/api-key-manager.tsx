'use client';

import { useState } from 'react';

type KeyRow = {
  _id: string;
  name: string;
  prefix: string;
  permissions: string[];
  status: string;
  createdAt: string;
  lastUsedAt?: string | null;
};

const SCOPE_OPTIONS = [
  'bucket:read',
  'file:upload',
  'file:read',
  'file:download',
  'file:list',
  'file:delete',
  'publicurl:create',
  'publicurl:revoke'
];

export default function ApiKeyManager({ initial }: { initial: KeyRow[] }) {
  const [items, setItems] = useState<KeyRow[]>(initial);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['file:read', 'file:download']);
  const [busy, setBusy] = useState(false);
  const [plain, setPlain] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setPlain(null);
    const res = await fetch('/api/v1/api-keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, permissions: scopes })
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data?.error?.message || 'Failed');
      return;
    }
    setPlain(data.key);
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

  async function revoke(id: string) {
    if (!confirm('Revoke this key?')) return;
    const res = await fetch(`/api/v1/api-keys/${id}`, { method: 'DELETE' });
    if (res.ok) setItems((prev) => prev.map((k) => (k._id === id ? { ...k, status: 'revoked' } : k)));
  }

  function toggleScope(s: string) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="card space-y-3">
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Key name</label>
          <input
            className="input"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Production API"
          />
        </div>
        <div>
          <div className="mb-1 text-xs text-gray-400">Scopes</div>
          <div className="flex flex-wrap gap-2">
            {SCOPE_OPTIONS.map((s) => (
              <label
                key={s}
                className={`cursor-pointer rounded-md border px-2 py-1 text-xs ${
                  scopes.includes(s)
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-gray-300'
                }`}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={scopes.includes(s)}
                  onChange={() => toggleScope(s)}
                />
                {s}
              </label>
            ))}
          </div>
        </div>
        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}
        <button className="btn" disabled={busy}>
          {busy ? 'Creating…' : 'Create key'}
        </button>
        {plain && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
            <div className="mb-1 font-semibold text-warning">
              Copy now — this is the only time we show the plain key.
            </div>
            <code className="break-all">{plain}</code>
          </div>
        )}
      </form>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th className="hidden sm:table-cell">Scopes</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((k) => (
              <tr key={k._id}>
                <td className="font-medium">{k.name}</td>
                <td className="font-mono text-xs">{k.prefix}…</td>
                <td className="hidden sm:table-cell font-mono text-[11px]">
                  {k.permissions.join(', ')}
                </td>
                <td>
                  {k.status === 'active' ? (
                    <span className="chip-success">active</span>
                  ) : (
                    <span className="chip-danger">revoked</span>
                  )}
                </td>
                <td>
                  {k.status === 'active' && (
                    <button
                      className="text-xs text-danger hover:underline"
                      onClick={() => revoke(k._id)}
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
