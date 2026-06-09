import { getPublicPaymentConfig } from '@/lib/payments/config';
import { listPlans } from '@/lib/payments/plans';
import PaymentsAdmin from './client';

export const dynamic = 'force-dynamic';

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

export default async function PaymentsPage() {
  const [config, plans] = await Promise.all([getPublicPaymentConfig(), listPlans(false)]);
  const planList = plans.map((p: any) => {
    const lim = p.limits || {};
    return {
      code: p.code as string,
      name: p.name as string,
      description: (p.description || '') as string,
      priceInr: p.priceInr as number,
      interval: (p.interval || 'month') as 'month' | 'year',
      active: Boolean(p.active),
      sortOrder: (p.sortOrder || 0) as number,
      storageGb: Math.round((lim.maxStorageBytes || 0) / GB),
      maxBuckets: lim.maxBuckets || 0,
      maxApiKeys: lim.maxApiKeys || 0,
      fileSizeMb: Math.round((lim.maxFileSizeBytes || 0) / MB)
    };
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Payments</h1>
        <p className="text-sm text-gray-400">
          Configure Razorpay / PhonePe and manage subscription plans. Secrets are encrypted at rest;
          leave a secret blank to keep the stored value.
        </p>
      </div>
      <PaymentsAdmin config={config} plans={planList} />
    </div>
  );
}
