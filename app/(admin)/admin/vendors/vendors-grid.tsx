'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Modal } from '@/components/Modal';
import SyncUsageButton from '@/components/SyncUsageButton';

interface VendorDTO {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  storageBytes: number;
  fileCount: number;
  maxStorageBytes: number;
  folderPath: string;
}

function fmtBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n,
    i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

const planClass: Record<string, string> = {
  free: 'bg-[#1c1c20] text-gray-300',
  pro: 'bg-accent/15 text-accent',
  enterprise: 'bg-emerald-500/15 text-emerald-300'
};

export default function VendorsGrid({
  vendors,
  canImpersonate
}: {
  vendors: VendorDTO[];
  canImpersonate: boolean;
}) {
  const [target, setTarget] = useState<VendorDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loginAs() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/vendors/${target.id}/impersonate`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message || 'Could not log in as this vendor.');
        setBusy(false);
        return;
      }
      window.location.href = data?.redirect || '/dashboard';
    } catch (e: any) {
      setError(e?.message || 'Network error');
      setBusy(false);
    }
  }

  if (vendors.length === 0) {
    return <div className="card py-10 text-center text-sm text-gray-500">No vendors yet.</div>;
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {vendors.map((v) => {
          const pct = v.maxStorageBytes > 0 ? Math.min(100, (v.storageBytes / v.maxStorageBytes) * 100) : 0;
          return (
            <div
              key={v.id}
              className="card flex flex-col gap-4 transition hover:border-accent/40 hover:bg-[#161619]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/admin/vendors/${v.id}`} className="truncate text-base font-semibold text-white hover:text-accent">
                      {v.name}
                    </Link>
                    <span
                      className={
                        v.status === 'active'
                          ? 'chip-success'
                          : v.status === 'suspended'
                            ? 'chip-danger'
                            : 'chip-warning'
                      }
                    >
                      {v.status}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-xs text-gray-500">{v.slug}</div>
                </div>
                <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold capitalize ${planClass[v.plan] || 'bg-[#1c1c20] text-gray-300'}`}>
                  {v.plan}
                </span>
              </div>

              {/* usage */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">{v.fileCount} files</span>
                  <span className="font-mono text-gray-400">
                    {fmtBytes(v.storageBytes)}
                    {v.maxStorageBytes > 0 && <span className="text-gray-600"> / {fmtBytes(v.maxStorageBytes)}</span>}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1c1c20]">
                  <div
                    className={`h-full rounded-full ${pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-accent'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              {/* actions */}
              <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <Link href={`/admin/vendors/${v.id}`} className="btn-secondary px-3 py-1.5 text-xs">
                  Manage
                </Link>
                {canImpersonate && (
                  <>
                    <button
                      className="btn-secondary px-3 py-1.5 text-xs"
                      onClick={() => {
                        setError(null);
                        setTarget(v);
                      }}
                    >
                      Log in as
                    </button>
                    <Link
                      href={`/admin/files?path=${encodeURIComponent(v.folderPath)}`}
                      className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs"
                    >
                      📁 Open folder
                    </Link>
                    <SyncUsageButton vendorId={v.id} label="Sync" compact />
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={!!target}
        onClose={() => setTarget(null)}
        title="Log in as this vendor"
        icon={<span className="text-lg">🔐</span>}
        footer={
          <>
            <button className="btn-secondary px-4 py-2 text-sm" onClick={() => setTarget(null)}>
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
            You&apos;ll be signed in as <strong className="text-white">{target?.name}</strong>&apos;s account
            and see exactly what they see. Use <strong className="text-white">Return to admin</strong> in the
            top banner to come back (auto-expires in 60 minutes).
          </p>
          <p className="text-xs text-gray-500">This action is logged and attributed to you.</p>
          {error && <div className="text-xs text-danger">{error}</div>}
        </div>
      </Modal>
    </>
  );
}
