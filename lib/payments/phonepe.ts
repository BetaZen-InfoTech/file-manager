import crypto from 'crypto';
import type { PhonePeConfig } from './config';

function host(cfg: PhonePeConfig): string {
  return cfg.env === 'prod'
    ? 'https://api.phonepe.com/apis/hermes'
    : 'https://api-preprod.phonepe.com/apis/pg-sandbox';
}

function xVerify(base64Body: string, path: string, cfg: PhonePeConfig): string {
  const hash = crypto.createHash('sha256').update(base64Body + path + cfg.saltKey).digest('hex');
  return `${hash}###${cfg.saltIndex}`;
}

export interface PhonePeInitResult {
  redirectUrl: string;
}

/**
 * Initiate a PhonePe PAY_PAGE payment. amountPaise is in paise.
 * Returns the hosted-checkout redirect URL to send the browser to.
 */
export async function initiatePhonePePayment(
  cfg: PhonePeConfig,
  opts: {
    merchantTransactionId: string;
    merchantUserId: string;
    amountPaise: number;
    redirectUrl: string;
    callbackUrl: string;
  }
): Promise<PhonePeInitResult> {
  if (!cfg.merchantId || !cfg.saltKey) throw new Error('PhonePe is not configured');
  const payload = {
    merchantId: cfg.merchantId,
    merchantTransactionId: opts.merchantTransactionId,
    merchantUserId: opts.merchantUserId,
    amount: opts.amountPaise,
    redirectUrl: opts.redirectUrl,
    redirectMode: 'REDIRECT',
    callbackUrl: opts.callbackUrl,
    paymentInstrument: { type: 'PAY_PAGE' }
  };
  const base64Body = Buffer.from(JSON.stringify(payload)).toString('base64');
  const path = '/pg/v1/pay';
  const res = await fetch(`${host(cfg)}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-VERIFY': xVerify(base64Body, path, cfg) },
    body: JSON.stringify({ request: base64Body })
  });
  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok || !json?.success) {
    throw new Error(`PhonePe init failed: ${json?.message || res.status}`);
  }
  const url = json?.data?.instrumentResponse?.redirectInfo?.url;
  if (!url) throw new Error('PhonePe did not return a redirect URL');
  return { redirectUrl: url };
}

export interface PhonePeStatus {
  paid: boolean;
  state: string;
  transactionId: string;
}

/** Server-to-server status check after the user returns / on callback. */
export async function checkPhonePeStatus(
  cfg: PhonePeConfig,
  merchantTransactionId: string
): Promise<PhonePeStatus> {
  const path = `/pg/v1/status/${cfg.merchantId}/${merchantTransactionId}`;
  const hash = crypto.createHash('sha256').update(path + cfg.saltKey).digest('hex');
  const res = await fetch(`${host(cfg)}${path}`, {
    method: 'GET',
    headers: {
      'content-type': 'application/json',
      'X-VERIFY': `${hash}###${cfg.saltIndex}`,
      'X-MERCHANT-ID': cfg.merchantId
    }
  });
  const json = (await res.json().catch(() => null)) as any;
  const state = String(json?.data?.state || json?.code || 'UNKNOWN');
  return {
    paid: json?.success === true && state === 'COMPLETED',
    state,
    transactionId: String(json?.data?.transactionId || '')
  };
}
