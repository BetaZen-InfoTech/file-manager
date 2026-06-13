'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Reconcile cached storage counters to the real files. With a vendorId, syncs
 * just that vendor; without, syncs every vendor. Refreshes the page on success.
 */
export default function SyncUsageButton({
  vendorId,
  label = 'Sync usage',
  compact = false
}: {
  vendorId?: string;
  label?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  async function sync() {
    setState('busy');
    try {
      const r = await fetch('/api/v1/admin/usage/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(vendorId ? { vendorId } : {})
      });
      if (!r.ok) {
        setState('error');
        return;
      }
      setState('done');
      router.refresh();
      setTimeout(() => setState('idle'), 2500);
    } catch {
      setState('error');
    }
  }

  const cls = compact ? 'btn-secondary px-3 py-1.5 text-xs' : 'btn-secondary';
  const title = vendorId
    ? 'Recalculate usage and mirror this vendor’s bucket files into the File Manager'
    : 'Recalculate storage usage for every vendor from the actual stored files';
  return (
    <button className={cls} disabled={state === 'busy'} onClick={sync} title={title}>
      {state === 'busy' ? 'Syncing…' : state === 'done' ? '✓ Synced' : state === 'error' ? '⚠ Retry' : `⟳ ${label}`}
    </button>
  );
}
