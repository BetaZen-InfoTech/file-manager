'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface PublicConfig {
  razorpay: { enabled: boolean; keyId: string; keySecretSet: boolean };
  phonepe: {
    enabled: boolean;
    merchantId: string;
    saltKeySet: boolean;
    saltIndex: string;
    env: 'sandbox' | 'prod';
  };
}
interface PlanRow {
  code: string;
  name: string;
  description: string;
  priceInr: number;
  interval: 'month' | 'year';
  active: boolean;
  sortOrder: number;
  storageGb: number;
  maxBuckets: number;
  maxApiKeys: number;
  fileSizeMb: number;
}

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

export default function PaymentsAdmin({ config, plans }: { config: PublicConfig; plans: PlanRow[] }) {
  const router = useRouter();

  // ---- Gateway config ----
  const [rz, setRz] = useState({ enabled: config.razorpay.enabled, keyId: config.razorpay.keyId, keySecret: '' });
  const [pp, setPp] = useState({
    enabled: config.phonepe.enabled,
    merchantId: config.phonepe.merchantId,
    saltKey: '',
    saltIndex: config.phonepe.saltIndex,
    env: config.phonepe.env
  });
  const [cfgBusy, setCfgBusy] = useState(false);
  const [cfgMsg, setCfgMsg] = useState<string | null>(null);

  async function saveConfig() {
    setCfgBusy(true);
    setCfgMsg(null);
    const payload: any = {
      razorpay: { enabled: rz.enabled, keyId: rz.keyId },
      phonepe: { enabled: pp.enabled, merchantId: pp.merchantId, saltIndex: pp.saltIndex, env: pp.env }
    };
    if (rz.keySecret) payload.razorpay.keySecret = rz.keySecret;
    if (pp.saltKey) payload.phonepe.saltKey = pp.saltKey;
    const res = await fetch('/api/v1/admin/payments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    setCfgBusy(false);
    if (res.ok) {
      setCfgMsg('Saved.');
      router.refresh();
    } else {
      const j = await res.json().catch(() => null);
      setCfgMsg(j?.error?.message || 'Failed to save.');
    }
  }

  // ---- Plans ----
  const [rows, setRows] = useState<PlanRow[]>(plans);
  const [planBusy, setPlanBusy] = useState<string | null>(null);
  const [planMsg, setPlanMsg] = useState<string | null>(null);

  function patchRow(i: number, patch: Partial<PlanRow>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  async function savePlan(row: PlanRow) {
    setPlanBusy(row.code);
    setPlanMsg(null);
    const res = await fetch('/api/v1/admin/plans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: row.code,
        name: row.name,
        description: row.description,
        priceInr: Number(row.priceInr),
        interval: row.interval,
        active: row.active,
        sortOrder: Number(row.sortOrder),
        limits: {
          maxStorageBytes: Math.round(Number(row.storageGb) * GB),
          maxBuckets: Number(row.maxBuckets),
          maxApiKeys: Number(row.maxApiKeys),
          maxFileSizeBytes: Math.round(Number(row.fileSizeMb) * MB)
        }
      })
    });
    setPlanBusy(null);
    if (res.ok) {
      setPlanMsg(`Saved ${row.code}.`);
      router.refresh();
    } else {
      const j = await res.json().catch(() => null);
      setPlanMsg(j?.error?.message || 'Failed to save plan.');
    }
  }

  function addPlan() {
    const code = prompt('New plan code (lowercase, e.g. "business")')?.trim().toLowerCase();
    if (!code || !/^[a-z0-9-]+$/.test(code)) return;
    if (rows.some((r) => r.code === code)) return;
    setRows((r) => [
      ...r,
      {
        code,
        name: code,
        description: '',
        priceInr: 0,
        interval: 'month',
        active: true,
        sortOrder: r.length,
        storageGb: 10,
        maxBuckets: 10,
        maxApiKeys: 10,
        fileSizeMb: 500
      }
    ]);
  }

  const Num = (props: { value: number; onChange: (n: number) => void; label: string }) => (
    <label className="flex flex-col gap-1 text-[11px] text-gray-400">
      {props.label}
      <input
        type="number"
        className="input"
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );

  return (
    <div className="space-y-6">
      {/* Gateways */}
      <section className="card space-y-4">
        <h2 className="text-sm font-semibold text-white">Razorpay</h2>
        <label className="flex items-center gap-2 text-sm text-gray-200">
          <input type="checkbox" checked={rz.enabled} onChange={(e) => setRz({ ...rz, enabled: e.target.checked })} />
          Enabled
        </label>
        <input className="input" placeholder="Key ID (rzp_live_…)" value={rz.keyId} onChange={(e) => setRz({ ...rz, keyId: e.target.value })} />
        <input
          className="input"
          placeholder={config.razorpay.keySecretSet ? 'Key secret (set — leave blank to keep)' : 'Key secret'}
          value={rz.keySecret}
          onChange={(e) => setRz({ ...rz, keySecret: e.target.value })}
        />

        <h2 className="pt-2 text-sm font-semibold text-white">PhonePe</h2>
        <label className="flex items-center gap-2 text-sm text-gray-200">
          <input type="checkbox" checked={pp.enabled} onChange={(e) => setPp({ ...pp, enabled: e.target.checked })} />
          Enabled
        </label>
        <input className="input" placeholder="Merchant ID" value={pp.merchantId} onChange={(e) => setPp({ ...pp, merchantId: e.target.value })} />
        <input
          className="input"
          placeholder={config.phonepe.saltKeySet ? 'Salt key (set — leave blank to keep)' : 'Salt key'}
          value={pp.saltKey}
          onChange={(e) => setPp({ ...pp, saltKey: e.target.value })}
        />
        <div className="grid grid-cols-2 gap-3">
          <input className="input" placeholder="Salt index" value={pp.saltIndex} onChange={(e) => setPp({ ...pp, saltIndex: e.target.value })} />
          <select className="input" value={pp.env} onChange={(e) => setPp({ ...pp, env: e.target.value as 'sandbox' | 'prod' })}>
            <option value="sandbox">sandbox</option>
            <option value="prod">prod</option>
          </select>
        </div>

        {cfgMsg && <div className="text-xs text-gray-400">{cfgMsg}</div>}
        <button className="btn w-full" disabled={cfgBusy} onClick={saveConfig}>
          {cfgBusy ? 'Saving…' : 'Save gateway settings'}
        </button>
      </section>

      {/* Plans */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Subscription plans</h2>
          <button className="text-xs text-blue-400" onClick={addPlan}>
            + Add plan
          </button>
        </div>
        {planMsg && <div className="text-xs text-gray-400">{planMsg}</div>}
        {rows.map((row, i) => (
          <div key={row.code} className="card space-y-3">
            <div className="flex items-center justify-between">
              <code className="text-xs text-gray-400">{row.code}</code>
              <label className="flex items-center gap-1 text-xs text-gray-300">
                <input type="checkbox" checked={row.active} onChange={(e) => patchRow(i, { active: e.target.checked })} />
                active
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[11px] text-gray-400">
                Name
                <input className="input" value={row.name} onChange={(e) => patchRow(i, { name: e.target.value })} />
              </label>
              <Num label="Price (₹)" value={row.priceInr} onChange={(n) => patchRow(i, { priceInr: n })} />
            </div>
            <input className="input" placeholder="Description" value={row.description} onChange={(e) => patchRow(i, { description: e.target.value })} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Num label="Storage (GB)" value={row.storageGb} onChange={(n) => patchRow(i, { storageGb: n })} />
              <Num label="Buckets" value={row.maxBuckets} onChange={(n) => patchRow(i, { maxBuckets: n })} />
              <Num label="API keys" value={row.maxApiKeys} onChange={(n) => patchRow(i, { maxApiKeys: n })} />
              <Num label="Max file (MB)" value={row.fileSizeMb} onChange={(n) => patchRow(i, { fileSizeMb: n })} />
            </div>
            <div className="flex items-center gap-3">
              <select className="input w-32" value={row.interval} onChange={(e) => patchRow(i, { interval: e.target.value as 'month' | 'year' })}>
                <option value="month">monthly</option>
                <option value="year">yearly</option>
              </select>
              <button className="btn" disabled={planBusy === row.code} onClick={() => savePlan(row)}>
                {planBusy === row.code ? 'Saving…' : 'Save plan'}
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
