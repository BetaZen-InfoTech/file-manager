import { dbConnect } from '../db';
import { PlatformSettings } from '@/models/PlatformSettings';
import { encryptSecret, decryptSecret } from '../crypto';
import { env } from '../env';

export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean; // TLS on connect (port 465)
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}

function envFallback(): SmtpConfig {
  // Seed from the boot-time env so an existing .env-configured mailer keeps working
  // until an admin saves config in the panel.
  const fromRaw = env.MAIL_FROM || '';
  const match = /^(.*?)\s*<([^>]+)>\s*$/.exec(fromRaw);
  return {
    enabled: Boolean(env.MAIL_HOST) && env.MAIL_DRIVER !== 'noop',
    host: env.MAIL_HOST || '',
    port: env.MAIL_PORT || 587,
    secure: env.MAIL_PORT === 465,
    user: env.MAIL_USER || '',
    pass: env.MAIL_PASS || '',
    fromName: match ? match[1].replace(/^"|"$/g, '').trim() : '',
    fromEmail: match ? match[2].trim() : fromRaw
  };
}

/** Server-side config with the decrypted password. Never send to the client. */
export async function getSmtpConfig(): Promise<SmtpConfig> {
  await dbConnect();
  const doc = await PlatformSettings.findOne({ key: 'smtp' }).lean();
  if (!doc?.value) return envFallback();
  const v = doc.value as any;
  const fb = envFallback();
  return {
    enabled: Boolean(v.enabled),
    host: String(v.host || fb.host),
    port: Number(v.port || fb.port || 587),
    secure: v.secure != null ? Boolean(v.secure) : Number(v.port) === 465,
    user: String(v.user || ''),
    pass: decryptSecret(String(v.pass || '')),
    fromName: String(v.fromName || ''),
    fromEmail: String(v.fromEmail || fb.fromEmail || '')
  };
}

/** Redacted config for the admin UI (password shown only as set/unset). */
export async function getPublicSmtpConfig() {
  const c = await getSmtpConfig();
  return {
    enabled: c.enabled,
    host: c.host,
    port: c.port,
    secure: c.secure,
    user: c.user,
    passSet: !!c.pass,
    fromName: c.fromName,
    fromEmail: c.fromEmail
  };
}

export interface SmtpConfigPatch {
  enabled?: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  fromName?: string;
  fromEmail?: string;
}

/** Merge a patch; the password is encrypted and left untouched when omitted/empty. */
export async function setSmtpConfig(patch: SmtpConfigPatch, updatedBy: string | null) {
  await dbConnect();
  const current = await getSmtpConfig();
  const next: SmtpConfig = {
    enabled: patch.enabled ?? current.enabled,
    host: patch.host ?? current.host,
    port: patch.port ?? current.port,
    secure: patch.secure ?? current.secure,
    user: patch.user ?? current.user,
    pass: patch.pass ? patch.pass : current.pass,
    fromName: patch.fromName ?? current.fromName,
    fromEmail: patch.fromEmail ?? current.fromEmail
  };
  const store = { ...next, pass: encryptSecret(next.pass) };
  await PlatformSettings.findOneAndUpdate(
    { key: 'smtp' },
    { $set: { value: store, updatedBy } },
    { upsert: true }
  );
  return getPublicSmtpConfig();
}
