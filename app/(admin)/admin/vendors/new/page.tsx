'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewVendorPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    slug: '',
    plan: 'free',
    ownerEmail: '',
    ownerPassword: ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/v1/admin/vendors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form)
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message || 'Failed');
      setBusy(false);
      return;
    }
    router.push(`/admin/vendors/${data.vendor._id}`);
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="text-2xl font-semibold text-white">New vendor</h1>
      <form onSubmit={onSubmit} className="card space-y-4">
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Name</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Slug (lowercase, a-z 0-9 -)</label>
          <input
            className="input"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            pattern="^[a-z0-9-]+$"
            required
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Plan</label>
          <select
            className="input"
            value={form.plan}
            onChange={(e) => setForm({ ...form, plan: e.target.value })}
          >
            <option value="free">free</option>
            <option value="pro">pro</option>
            <option value="enterprise">enterprise</option>
          </select>
        </div>
        <hr className="border-border" />
        <p className="text-xs text-gray-400">Optionally create the vendor owner now.</p>
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Owner email</label>
          <input
            type="email"
            className="input"
            value={form.ownerEmail}
            onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Owner password (≥ 8 chars)</label>
          <input
            type="password"
            className="input"
            value={form.ownerPassword}
            onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })}
            minLength={8}
          />
        </div>
        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
        <button className="btn w-full" disabled={busy}>
          {busy ? 'Creating…' : 'Create vendor'}
        </button>
      </form>
    </div>
  );
}
