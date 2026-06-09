import { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { jsonOk, unauthorized } from '@/lib/http';
import { listPlans } from '@/lib/payments/plans';
import { getPublicPaymentConfig } from '@/lib/payments/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Active plans + which gateways are available, for the vendor billing page.
export async function GET(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  const [plans, cfg] = await Promise.all([listPlans(true), getPublicPaymentConfig()]);
  return jsonOk({
    plans,
    gateways: { razorpay: cfg.razorpay.enabled, phonepe: cfg.phonepe.enabled }
  });
}
