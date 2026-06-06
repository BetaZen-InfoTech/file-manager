'use client';

import { useState } from 'react';

const SCOPES = [
  'file:read',
  'file:download',
  'file:upload',
  'file:list',
  'bucket:read'
];

export default function JwtIssuer() {
  const [subject, setSubject] = useState('');
  const [scopes, setScopes] = useState<string[]>(['file:download']);
  const [expiresIn, setExpiresIn] = useState(3600);
  const [result, setResult] = useState<{ token: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch('/api/v1/jwt/issue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject, scopes, expiresIn })
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data?.error?.message || 'Failed');
      return;
    }
    setResult({ token: data.token, expiresAt: data.expiresAt });
  }

  function toggle(s: string) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  return (
    <form onSubmit={issue} className="card space-y-3">
      <div className="space-y-1">
        <label className="text-xs text-gray-400">Subject (who you're issuing it to)</label>
        <input
          className="input"
          required
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="partner-crm"
        />
      </div>
      <div>
        <div className="mb-1 text-xs text-gray-400">Scopes</div>
        <div className="flex flex-wrap gap-2">
          {SCOPES.map((s) => (
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
                onChange={() => toggle(s)}
              />
              {s}
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-gray-400">Expires in (seconds)</label>
        <input
          className="input"
          type="number"
          min={60}
          value={expiresIn}
          onChange={(e) => setExpiresIn(Number(e.target.value))}
        />
      </div>
      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}
      <button className="btn" disabled={busy}>
        {busy ? 'Issuing…' : 'Issue JWT'}
      </button>
      {result && (
        <div className="space-y-1 rounded-md border border-success/40 bg-success/10 p-3 text-xs">
          <div className="font-semibold text-success">Token issued (expires {result.expiresAt})</div>
          <textarea
            readOnly
            className="input min-h-[80px] font-mono"
            value={result.token}
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          />
        </div>
      )}
    </form>
  );
}
