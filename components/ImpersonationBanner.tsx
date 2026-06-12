'use client';

import { useState } from 'react';

export function ImpersonationBanner({
  vendorUserEmail,
  vendorName,
  adminEmail
}: {
  vendorUserEmail: string;
  vendorName: string;
  adminEmail: string;
}) {
  const [busy, setBusy] = useState(false);

  async function stop() {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/impersonate/stop', { method: 'POST' });
      const data = await res.json().catch(() => null);
      // Full navigation so the restored admin cookie is read server-side.
      window.location.href = res.ok ? data?.redirect || '/admin' : '/login';
    } catch {
      window.location.href = '/login';
    }
  }

  return (
    <div className="sticky top-0 z-30 -mx-4 mb-4 flex flex-col gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-amber-200 backdrop-blur sm:flex-row sm:items-center sm:justify-between md:-mx-8 md:px-8">
      <div className="flex items-center gap-2 text-sm">
        <span aria-hidden>🔐</span>
        <span>
          Viewing as <strong className="text-white">{vendorUserEmail}</strong>
          <span className="text-amber-200/70"> · {vendorName}</span>
          <span className="hidden text-amber-200/60 sm:inline"> — impersonated by {adminEmail}</span>
        </span>
      </div>
      <button
        onClick={stop}
        disabled={busy}
        className="self-start rounded-md border border-amber-400/50 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-100 transition hover:bg-amber-400/20 disabled:opacity-60 sm:self-auto"
      >
        {busy ? 'Returning…' : 'Return to admin'}
      </button>
    </div>
  );
}
