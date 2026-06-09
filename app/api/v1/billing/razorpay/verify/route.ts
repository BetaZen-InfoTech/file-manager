import { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { badRequest, jsonOk, safeParseJson, unauthorized } from '@/lib/http';
import { razorpayVerifySchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { dbConnect } from '@/lib/db';
import { Payment } from '@/models/Payment';
import { getPaymentConfig } from '@/lib/payments/config';
import { verifyRazorpaySignature } from '@/lib/payments/razorpay';
import { activatePaidPayment, markPaymentFailed } from '@/lib/payments/activate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const p = await authenticate(req);
  if (!p || !p.vendorId) return unauthorized();

  const body = await safeParseJson(req);
  const parsed = razorpayVerifySchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = parsed.data;

  await dbConnect();
  const payment = await Payment.findOne({
    gatewayOrderId: razorpayOrderId,
    vendorId: p.vendorId,
    gateway: 'razorpay'
  });
  if (!payment) return badRequest('payment not found');

  const cfg = await getPaymentConfig();
  const valid = verifyRazorpaySignature(
    cfg.razorpay,
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  );
  if (!valid) {
    await markPaymentFailed(String(payment._id));
    await audit(p, req, { action: 'billing.verify.fail', resourceType: 'payment', resourceId: String(payment._id) });
    return badRequest('signature verification failed');
  }

  const result = await activatePaidPayment(String(payment._id), razorpayPaymentId);
  await audit(p, req, { action: 'billing.verify.ok', resourceType: 'payment', resourceId: String(payment._id), meta: { planCode: payment.planCode } });
  return jsonOk(result);
}
