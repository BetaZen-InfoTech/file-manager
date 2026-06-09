import { hmacSha256Hex, timingSafeEqual } from '../crypto';
import type { RazorpayConfig } from './config';

const API = 'https://api.razorpay.com/v1';

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  status: string;
}

/** Create a Razorpay order. amountPaise is in the smallest unit (paise). */
export async function createRazorpayOrder(
  cfg: RazorpayConfig,
  amountPaise: number,
  receipt: string,
  notes: Record<string, string> = {}
): Promise<RazorpayOrder> {
  if (!cfg.keyId || !cfg.keySecret) throw new Error('Razorpay is not configured');
  const auth = Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64');
  const res = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Razorpay order failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as RazorpayOrder;
}

/**
 * Verify the checkout signature returned to the browser:
 *   HMAC_SHA256(order_id + "|" + payment_id, key_secret) === razorpay_signature
 */
export function verifyRazorpaySignature(
  cfg: RazorpayConfig,
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  if (!cfg.keySecret || !orderId || !paymentId || !signature) return false;
  const expected = hmacSha256Hex(`${orderId}|${paymentId}`, cfg.keySecret);
  return timingSafeEqual(expected, signature);
}
