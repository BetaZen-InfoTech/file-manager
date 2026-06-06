'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function MaintenanceForm({
  initialEnabled,
  initialMessage
}: {
  initialEnabled: boolean;
  initialMessage: string;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    const res = await fetch('/api/v1/admin/maintenance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled, message })
    });
    setBusy(false);
    if (res.ok) {
      setStatus('Saved.');
      router.refresh();
    } else {
      setStatus('Failed to save.');
    }
  }

  return (
    <form onSubmit={save} className="card space-y-4">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span className="text-sm text-gray-200">Maintenance mode enabled</span>
      </label>
      <div className="space-y-1">
        <label className="text-xs text-gray-400">Message shown to users</label>
        <textarea
          className="input min-h-[80px]"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>
      {status && <div className="text-xs text-gray-400">{status}</div>}
      <button className="btn w-full" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
