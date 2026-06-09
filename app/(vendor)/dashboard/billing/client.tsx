'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Plan {
  code: string;
  name: string;
  description: string;
  priceInr: number;
  interval: 'month' | 'year';
}
interface Gateways {
  razorpay: boolean;
  phonepe: boolean;
}

declare global {
  interface Window {
    Razorpay?: any;
  }
}

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export default function BillingClient({
  currentPlanCode,
  subscription,
  canPurchase,
  email
}: {
  currentPlanCode: string;
  subscription: { planCode: string; status: string; currentPeriodEnd: string | null } | null;
  canPurchase: boolean;
  email: string;
}) {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [gateways, setGateways] = useState<Gateways>({ razorpay: false, phonepe: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/plans')
      .then((r) => r.json())
      .then((d) => {
        setPlans(d.plans || []);
        setGateways(d.gateways || { razorpay: false, phonepe: false });
      })
      .catch(() => setMsg('Could not load plans.'));
    const sp = new URLSearchParams(window.location.search).get('status');
    if (sp === 'success') setMsg('Payment successful — your plan is active.');
    if (sp === 'failed') setMsg('Payment was not completed.');
  }, []);

  async function checkout(planCode: string, gateway: 'razorpay' | 'phonepe') {
    setBusy(`${planCode}:${gateway}`);
    setMsg(null);
    const res = await fetch('/api/v1/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planCode, gateway })
    });
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      setBusy(null);
      setMsg(d?.error?.message || 'Checkout failed.');
      return;
    }

    if (d.gateway === 'phonepe') {
      window.location.href = d.redirectUrl;
      return;
    }

    // Razorpay modal
    const ok = await loadRazorpay();
    if (!ok) {
      setBusy(null);
      setMsg('Could not load Razorpay.');
      return;
    }
    const rzp = new window.Razorpay({
      key: d.keyId,
      order_id: d.orderId,
      amount: d.amount,
      currency: d.currency,
      name: d.name,
      description: d.description,
      prefill: d.prefill,
      handler: async (resp: any) => {
        const v = await fetch('/api/v1/billing/razorpay/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            razorpayOrderId: resp.razorpay_order_id,
            razorpayPaymentId: resp.razorpay_payment_id,
            razorpaySignature: resp.razorpay_signature
          })
        });
        setBusy(null);
        if (v.ok) {
          setMsg('Payment successful — your plan is active.');
          router.refresh();
        } else {
          const j = await v.json().catch(() => null);
          setMsg(j?.error?.message || 'Verification failed.');
        }
      },
      modal: { ondismiss: () => setBusy(null) }
    });
    rzp.open();
  }

  const noGateway = !gateways.razorpay && !gateways.phonepe;

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="text-sm text-gray-400">Current plan</div>
        <div className="text-lg font-semibold text-white capitalize">{currentPlanCode}</div>
        {subscription?.currentPeriodEnd && subscription.status === 'active' && (
          <div className="text-xs text-gray-400">
            Renews/expires on {subscription.currentPeriodEnd.slice(0, 10)}
          </div>
        )}
      </div>

      {msg && <div className="rounded-md border border-border bg-panel px-3 py-2 text-sm text-gray-200">{msg}</div>}
      {!canPurchase && (
        <div className="text-xs text-yellow-400">Only the vendor owner can change the plan.</div>
      )}
      {canPurchase && noGateway && (
        <div className="text-xs text-yellow-400">
          No payment gateway is configured yet. Ask a platform admin to enable Razorpay or PhonePe.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = p.code === currentPlanCode;
          return (
            <div key={p.code} className="card flex flex-col gap-2">
              <div className="text-base font-semibold text-white">{p.name}</div>
              <div className="text-2xl font-bold text-white">
                {p.priceInr === 0 ? 'Free' : `₹${p.priceInr}`}
                {p.priceInr > 0 && <span className="text-xs text-gray-400">/{p.interval}</span>}
              </div>
              <p className="flex-1 text-xs text-gray-400">{p.description}</p>
              {isCurrent ? (
                <span className="rounded-md bg-green-900/40 px-3 py-2 text-center text-xs text-green-300">
                  Current plan
                </span>
              ) : p.priceInr === 0 ? (
                <span className="text-center text-xs text-gray-500">Default plan</span>
              ) : (
                <div className="flex flex-col gap-2">
                  {gateways.razorpay && (
                    <button
                      className="btn"
                      disabled={!canPurchase || !!busy}
                      onClick={() => checkout(p.code, 'razorpay')}
                    >
                      {busy === `${p.code}:razorpay` ? 'Opening…' : 'Pay with Razorpay'}
                    </button>
                  )}
                  {gateways.phonepe && (
                    <button
                      className="btn"
                      disabled={!canPurchase || !!busy}
                      onClick={() => checkout(p.code, 'phonepe')}
                    >
                      {busy === `${p.code}:phonepe` ? 'Redirecting…' : 'Pay with PhonePe'}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
