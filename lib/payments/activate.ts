import { dbConnect } from '../db';
import { Payment } from '@/models/Payment';
import { Vendor } from '@/models/Vendor';
import { getPlan } from './plans';

const ENUM_PLANS = ['free', 'pro', 'enterprise'];

/**
 * Mark a payment paid and apply its plan to the vendor (limits + subscription
 * window). Idempotent — a payment already marked paid is a no-op.
 */
export async function activatePaidPayment(
  paymentId: string,
  gatewayPaymentId?: string
): Promise<{ ok: boolean; message: string }> {
  await dbConnect();
  const payment = await Payment.findById(paymentId);
  if (!payment) return { ok: false, message: 'payment not found' };
  if (payment.status === 'paid') return { ok: true, message: 'already activated' };

  const plan = await getPlan(payment.planCode);
  if (!plan) return { ok: false, message: 'plan not found' };

  const now = new Date();
  const end = new Date(now);
  if (payment.interval === 'year') end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);

  payment.status = 'paid';
  payment.periodStart = now;
  payment.periodEnd = end;
  if (gatewayPaymentId) payment.gatewayPaymentId = gatewayPaymentId;
  await payment.save();

  const lim = plan.limits || {
    maxStorageBytes: 10 * 1024 * 1024 * 1024,
    maxBuckets: 10,
    maxApiKeys: 10,
    maxFileSizeBytes: 500 * 1024 * 1024
  };
  const vendor = await Vendor.findById(payment.vendorId);
  if (vendor) {
    if (ENUM_PLANS.includes(plan.code)) (vendor as any).plan = plan.code;
    (vendor as any).limits = {
      maxStorageBytes: lim.maxStorageBytes,
      maxBuckets: lim.maxBuckets,
      maxApiKeys: lim.maxApiKeys,
      maxFileSizeBytes: lim.maxFileSizeBytes
    };
    (vendor as any).subscription = {
      planCode: plan.code,
      status: 'active',
      gateway: payment.gateway,
      currentPeriodEnd: end,
      lastPaymentId: payment._id
    };
    await vendor.save();
  }

  return { ok: true, message: `Activated ${plan.name} until ${end.toISOString().slice(0, 10)}` };
}

export async function markPaymentFailed(paymentId: string): Promise<void> {
  await dbConnect();
  await Payment.updateOne(
    { _id: paymentId, status: 'created' },
    { $set: { status: 'failed' } }
  );
}
