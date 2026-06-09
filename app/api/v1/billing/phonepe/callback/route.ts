import { NextRequest } from 'next/server';
import { jsonOk, safeParseJson } from '@/lib/http';
import { dbConnect } from '@/lib/db';
import { Payment } from '@/models/Payment';
import { getPaymentConfig } from '@/lib/payments/config';
import { checkPhonePeStatus } from '@/lib/payments/phonepe';
import { activatePaidPayment } from '@/lib/payments/activate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Server-to-server callback from PhonePe. We trust nothing in the body beyond
// the transaction id; the real verification is a status call. Always 200 so
// PhonePe doesn't retry endlessly — activation is idempotent.
export async function POST(req: NextRequest) {
  try {
    const body = await safeParseJson<{ response?: string }>(req);
    let merchantTransactionId = '';
    if (body?.response) {
      const decoded = JSON.parse(Buffer.from(body.response, 'base64').toString('utf8'));
      merchantTransactionId = decoded?.data?.merchantTransactionId || '';
    }
    if (merchantTransactionId) {
      await dbConnect();
      const payment = await Payment.findOne({
        gatewayOrderId: merchantTransactionId,
        gateway: 'phonepe'
      });
      if (payment && payment.status !== 'paid') {
        const cfg = await getPaymentConfig();
        const st = await checkPhonePeStatus(cfg.phonepe, merchantTransactionId);
        if (st.paid) await activatePaidPayment(String(payment._id), st.transactionId);
      }
    }
  } catch {
    /* swallow — respond 200 regardless */
  }
  return jsonOk({ ok: true });
}
