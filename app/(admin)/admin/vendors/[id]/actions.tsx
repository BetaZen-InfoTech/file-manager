'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function VendorActions({
  vendorId,
  status
}: {
  vendorId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function suspend() {
    const reason = window.prompt('Suspension reason (optional)?') || '';
    setBusy(true);
    await fetch(`/api/v1/admin/vendors/${vendorId}/suspend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    setBusy(false);
    router.refresh();
  }

  async function activate() {
    setBusy(true);
    await fetch(`/api/v1/admin/vendors/${vendorId}/activate`, { method: 'POST' });
    setBusy(false);
    router.refresh();
  }

  if (status === 'suspended') {
    return (
      <button className="btn" onClick={activate} disabled={busy}>
        {busy ? 'Working…' : 'Activate'}
      </button>
    );
  }
  return (
    <button className="btn-danger" onClick={suspend} disabled={busy}>
      {busy ? 'Working…' : 'Suspend'}
    </button>
  );
}
