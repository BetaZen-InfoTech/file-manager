import { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { badRequest, forbidden, jsonOk, safeParseJson, unauthorized } from '@/lib/http';
import { checkoutSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { dbConnect } from '@/lib/db';
import { Payment } from '@/models/Payment';
import { getPlan } from '@/lib/payments/plans';
import { getPaymentConfig } from '@/lib/payments/config';
import { getSeo } from '@/lib/seo';
import { createRazorpayOrder } from '@/lib/payments/razorpay';
import { initiatePhonePePayment } from '@/lib/payments/phonepe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  // Only a vendor owner (settings:update) can purchase a plan for their tenant.
  if (!p.vendorId || !can(p, 'settings:update')) return forbidden();

  const body = await safeParseJson(req);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });
  const { planCode, gateway } = parsed.data;

  const plan = await getPlan(planCode);
  if (!plan || !plan.active) return badRequest('plan not available');
  if (plan.priceInr <= 0) return badRequest('this plan is free — no payment required');

  const cfg = await getPaymentConfig();
  const origin = new URL(req.url).origin;

  await dbConnect();
  const payment = await Payment.create({
    vendorId: p.vendorId,
    planCode: plan.code,
    gateway,
    amountInr: plan.priceInr,
    interval: plan.interval,
    status: 'created',
    createdBy: p.userId || null
  });

  try {
    if (gateway === 'razorpay') {
      if (!cfg.razorpay.enabled) return badRequest('Razorpay is not enabled');
      const order = await createRazorpayOrder(
        cfg.razorpay,
        plan.priceInr * 100,
        String(payment._id),
        { planCode: plan.code, vendorId: String(p.vendorId) }
      );
      payment.gatewayOrderId = order.id;
      await payment.save();
      const seo = await getSeo();
      return jsonOk({
        gateway: 'razorpay',
        keyId: cfg.razorpay.keyId,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        name: seo.siteName,
        description: `${plan.name} (${plan.interval})`,
        prefill: { email: p.email || '' }
      });
    }

    // phonepe
    if (!cfg.phonepe.enabled) return badRequest('PhonePe is not enabled');
    const merchantTransactionId = String(payment._id);
    const init = await initiatePhonePePayment(cfg.phonepe, {
      merchantTransactionId,
      merchantUserId: String(p.vendorId),
      amountPaise: plan.priceInr * 100,
      redirectUrl: `${origin}/api/v1/billing/phonepe/redirect?pid=${merchantTransactionId}`,
      callbackUrl: `${origin}/api/v1/billing/phonepe/callback`
    });
    payment.gatewayOrderId = merchantTransactionId;
    await payment.save();
    await audit(p, req, { action: 'billing.checkout', resourceType: 'payment', resourceId: String(payment._id), meta: { gateway, planCode } });
    return jsonOk({ gateway: 'phonepe', redirectUrl: init.redirectUrl });
  } catch (e) {
    payment.status = 'failed';
    await payment.save();
    return badRequest(e instanceof Error ? e.message : 'checkout failed');
  }
}
