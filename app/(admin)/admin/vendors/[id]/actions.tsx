'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Modal } from '@/components/Modal';

export default function VendorActions({
  vendorId,
  status,
  name,
  canImpersonate = false
}: {
  vendorId: string;
  status: string;
  name: string;
  canImpersonate?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showSuspend, setShowSuspend] = useState(false);
  const [showActivate, setShowActivate] = useState(false);
  const [showImpersonate, setShowImpersonate] = useState(false);
  const [reason, setReason] = useState('');
  const [impersonateError, setImpersonateError] = useState<string | null>(null);

  async function loginAs() {
    setBusy(true);
    setImpersonateError(null);
    try {
      const res = await fetch(`/api/v1/admin/vendors/${vendorId}/impersonate`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setImpersonateError(data?.error?.message || 'Could not log in as this vendor.');
        setBusy(false);
        return;
      }
      // Full navigation so the server-rendered vendor layout reads the new cookie.
      window.location.href = data?.redirect || '/dashboard';
    } catch (err: any) {
      setImpersonateError(err?.message || 'Network error');
      setBusy(false);
    }
  }

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
      <div className="flex items-center gap-2">
        {canImpersonate && (
          <button
            className="btn-secondary"
            onClick={() => {
              setImpersonateError(null);
              setShowImpersonate(true);
            }}
            disabled={busy}
          >
            Log in as
          </button>
        )}
        {status === 'suspended' ? (
          <button className="btn" onClick={() => setShowActivate(true)} disabled={busy}>
            Activate vendor
          </button>
        ) : (
          <button className="btn-danger" onClick={() => setShowSuspend(true)} disabled={busy}>
            Suspend vendor
          </button>
        )}
      </div>

      <Modal
        open={showImpersonate}
        onClose={() => setShowImpersonate(false)}
        title="Log in as this vendor"
        icon={<span className="text-lg">🔐</span>}
        footer={
          <>
            <button className="btn-secondary px-4 py-2 text-sm" onClick={() => setShowImpersonate(false)}>
              Cancel
            </button>
            <button className="btn px-4 py-2 text-sm" onClick={loginAs} disabled={busy}>
              {busy ? 'Switching…' : 'Continue'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-300">
            You&apos;ll be signed in as <strong className="text-white">{name}</strong>&apos;s account and
            see exactly what they see. Your admin session pauses for up to 60 minutes — use{' '}
            <strong className="text-white">Return to admin</strong> in the top banner to come back.
          </p>
          <p className="text-xs text-gray-500">
            This action is logged, and everything you do is attributed to you in the audit trail.
          </p>
          {impersonateError && <div className="text-xs text-danger">{impersonateError}</div>}
        </div>
      </Modal>

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
