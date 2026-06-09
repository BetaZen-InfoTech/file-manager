import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { Payment } from '@/models/Payment';
import { getPaymentConfig } from '@/lib/payments/config';
import { checkPhonePeStatus } from '@/lib/payments/phonepe';
import { activatePaidPayment, markPaymentFailed } from '@/lib/payments/activate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PhonePe sends the user's browser back here after the hosted checkout.
// We confirm via a server-to-server status check (the source of truth), then
// bounce to the billing page with a status flag.
export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;
  const pid = new URL(req.url).searchParams.get('pid') || '';
  const done = (status: string) =>
    NextResponse.redirect(`${origin}/dashboard/billing?status=${status}`, 303);

  if (!pid) return done('failed');
  await dbConnect();
  const payment = await Payment.findById(pid);
  if (!payment || payment.gateway !== 'phonepe') return done('failed');
  if (payment.status === 'paid') return done('success');

  try {
    const cfg = await getPaymentConfig();
    const st = await checkPhonePeStatus(cfg.phonepe, payment.gatewayOrderId);
    if (st.paid) {
      await activatePaidPayment(String(payment._id), st.transactionId);
      return done('success');
    }
    await markPaymentFailed(String(payment._id));
    return done('failed');
  } catch {
    return done('failed');
  }
}
