import { dbConnect } from '../db';
import { PlatformSettings } from '@/models/PlatformSettings';
import { encryptSecret, decryptSecret } from '../crypto';

export interface RazorpayConfig {
  enabled: boolean;
  keyId: string;
  keySecret: string;
}
export interface PhonePeConfig {
  enabled: boolean;
  merchantId: string;
  saltKey: string;
  saltIndex: string;
  env: 'sandbox' | 'prod';
}
export interface PaymentConfig {
  razorpay: RazorpayConfig;
  phonepe: PhonePeConfig;
}

function defaults(): PaymentConfig {
  return {
    razorpay: { enabled: false, keyId: '', keySecret: '' },
    phonepe: { enabled: false, merchantId: '', saltKey: '', saltIndex: '1', env: 'sandbox' }
  };
}

/** Server-side config with decrypted secrets. Never send this to the client. */
export async function getPaymentConfig(): Promise<PaymentConfig> {
  await dbConnect();
  const doc = await PlatformSettings.findOne({ key: 'payments' }).lean();
  const v = (doc?.value || {}) as any;
  const d = defaults();
  return {
    razorpay: {
      enabled: Boolean(v?.razorpay?.enabled),
      keyId: String(v?.razorpay?.keyId || ''),
      keySecret: decryptSecret(String(v?.razorpay?.keySecret || ''))
    },
    phonepe: {
      enabled: Boolean(v?.phonepe?.enabled),
      merchantId: String(v?.phonepe?.merchantId || ''),
      saltKey: decryptSecret(String(v?.phonepe?.saltKey || '')),
      saltIndex: String(v?.phonepe?.saltIndex || '1'),
      env: (v?.phonepe?.env === 'prod' ? 'prod' : 'sandbox') as 'sandbox' | 'prod'
    }
  };
}

/** Redacted config safe to expose to the admin UI (secrets shown as set/unset). */
export async function getPublicPaymentConfig() {
  const c = await getPaymentConfig();
  return {
    razorpay: { enabled: c.razorpay.enabled, keyId: c.razorpay.keyId, keySecretSet: !!c.razorpay.keySecret },
    phonepe: {
      enabled: c.phonepe.enabled,
      merchantId: c.phonepe.merchantId,
      saltKeySet: !!c.phonepe.saltKey,
      saltIndex: c.phonepe.saltIndex,
      env: c.phonepe.env
    }
  };
}

export interface PaymentConfigPatch {
  razorpay?: Partial<RazorpayConfig>;
  phonepe?: Partial<PhonePeConfig>;
}

/**
 * Merge a patch into stored config. Secret fields are encrypted; an empty/omitted
 * secret leaves the existing value untouched (so the UI never has to re-enter it).
 */
export async function setPaymentConfig(patch: PaymentConfigPatch, updatedBy: string | null) {
  await dbConnect();
  const current = await getPaymentConfig();

  const razorpay = {
    enabled: patch.razorpay?.enabled ?? current.razorpay.enabled,
    keyId: patch.razorpay?.keyId ?? current.razorpay.keyId,
    keySecret: patch.razorpay?.keySecret ? patch.razorpay.keySecret : current.razorpay.keySecret
  };
  const phonepe = {
    enabled: patch.phonepe?.enabled ?? current.phonepe.enabled,
    merchantId: patch.phonepe?.merchantId ?? current.phonepe.merchantId,
    saltKey: patch.phonepe?.saltKey ? patch.phonepe.saltKey : current.phonepe.saltKey,
    saltIndex: patch.phonepe?.saltIndex ?? current.phonepe.saltIndex,
    env: (patch.phonepe?.env ?? current.phonepe.env) as 'sandbox' | 'prod'
  };

  const store = {
    razorpay: { enabled: razorpay.enabled, keyId: razorpay.keyId, keySecret: encryptSecret(razorpay.keySecret) },
    phonepe: {
      enabled: phonepe.enabled,
      merchantId: phonepe.merchantId,
      saltKey: encryptSecret(phonepe.saltKey),
      saltIndex: phonepe.saltIndex,
      env: phonepe.env
    }
  };

  await PlatformSettings.findOneAndUpdate(
    { key: 'payments' },
    { $set: { value: store, updatedBy } },
    { upsert: true }
  );
  return getPublicPaymentConfig();
}
