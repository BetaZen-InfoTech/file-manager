import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/session-server';
import { dbConnect } from '@/lib/db';
import { Vendor } from '@/models/Vendor';
import BillingClient from './client';

export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  const session = await getServerSession();
  if (!session) redirect('/login');
  if (!session.user.vendorId) redirect('/dashboard');

  await dbConnect();
  const v: any = await Vendor.findById(session.user.vendorId).lean();
  const sub = v?.subscription || null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-2xl font-semibold text-white">Billing &amp; plan</h1>
      <BillingClient
        currentPlanCode={v?.plan || 'free'}
        subscription={
          sub
            ? {
                planCode: sub.planCode || 'free',
                status: sub.status || 'none',
                currentPeriodEnd: sub.currentPeriodEnd
                  ? new Date(sub.currentPeriodEnd).toISOString()
                  : null
              }
            : null
        }
        canPurchase={session.user.permissions.includes('settings:update')}
        email={session.user.email}
      />
    </div>
  );
}
