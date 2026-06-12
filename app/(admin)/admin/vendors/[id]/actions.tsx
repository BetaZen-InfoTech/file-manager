'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Modal } from '@/components/Modal';

export default function VendorActions({
  vendorId,
  status,
  name
}: {
  vendorId: string;
  status: string;
  name: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showSuspend, setShowSuspend] = useState(false);
  const [showActivate, setShowActivate] = useState(false);
  const [reason, setReason] = useState('');

  async function suspend() {
    setBusy(true);
    await fetch(`/api/v1/admin/vendors/${vendorId}/suspend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    setBusy(false);
    setShowSuspend(false);
    router.refresh();
  }

  async function activate() {
    setBusy(true);
    await fetch(`/api/v1/admin/vendors/${vendorId}/activate`, { method: 'POST' });
    setBusy(false);
    setShowActivate(false);
    router.refresh();
  }

  return (
    <>
      {status === 'suspended' ? (
        <button className="btn" onClick={() => setShowActivate(true)} disabled={busy}>
          Activate vendor
        </button>
      ) : (
        <button className="btn-danger" onClick={() => setShowSuspend(true)} disabled={busy}>
          Suspend vendor
        </button>
      )}

      <Modal
        open={showSuspend}
        onClose={() => setShowSuspend(false)}
        title="Suspend vendor"
        icon={<span className="text-lg">⚠️</span>}
        footer={
          <>
            <button className="btn-secondary px-4 py-2 text-sm" onClick={() => setShowSuspend(false)}>
              Cancel
            </button>
            <button className="btn-danger px-4 py-2 text-sm" onClick={suspend} disabled={busy}>
              {busy ? 'Suspending…' : 'Suspend'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-300">
            Suspend <strong className="text-white">{name}</strong>? Their uploads, downloads, and all
            share links stop working immediately.
          </p>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-400">Reason (optional, shown to the vendor)</label>
            <textarea
              className="input min-h-[70px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Payment overdue"
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={showActivate}
        onClose={() => setShowActivate(false)}
        title="Activate vendor"
        icon={<span className="text-lg">✅</span>}
        size="sm"
        footer={
          <>
            <button className="btn-secondary px-4 py-2 text-sm" onClick={() => setShowActivate(false)}>
              Cancel
            </button>
            <button className="btn px-4 py-2 text-sm" onClick={activate} disabled={busy}>
              {busy ? 'Activating…' : 'Activate'}
            </button>
          </>
        }
      >
        <p className="text-sm text-gray-300">
          Re-activate <strong className="text-white">{name}</strong>? Access and links will resume.
        </p>
      </Modal>
    </>
  );
}
