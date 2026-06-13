import { dbConnect } from '../db';
import { PlatformSettings } from '@/models/PlatformSettings';
import { encryptSecret, decryptSecret } from '../crypto';
import { env } from '../env';

export type SmtpEncryption = 'none' | 'starttls' | 'tls';

export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  encryption: SmtpEncryption; // none = plaintext, starttls = upgrade (587), tls = implicit SMTPS (465)
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}

// Map a stored doc to an encryption mode, tolerating the older `secure` boolean.
function deriveEncryption(v: any, port: number): SmtpEncryption {
  if (v?.encryption === 'none' || v?.encryption === 'starttls' || v?.encryption === 'tls') return v.encryption;
  if (v?.secure === true) return 'tls';
  if (v?.secure === false) return 'starttls';
  return port === 465 ? 'tls' : 'starttls';
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
    encryption: env.MAIL_PORT === 465 ? 'tls' : 'starttls',
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
  const port = Number(v.port || fb.port || 587);
  return {
    enabled: Boolean(v.enabled),
    host: String(v.host || fb.host),
    port,
    encryption: deriveEncryption(v, port),
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
    encryption: c.encryption,
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
  encryption?: SmtpEncryption;
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
    encryption: patch.encryption ?? current.encryption,
    user: patch.user ?? current.user,
    pass: patch.pass ? patch.pass : current.pass,
    fromName: patch.fromName ?? current.fromName,
    fromEmail: patch.fromEmail ?? current.fromEmail
  };
  // Persist `secure` too (derived) so any older reader stays consistent.
  const store = { ...next, secure: next.encryption === 'tls', pass: encryptSecret(next.pass) };
  await PlatformSettings.findOneAndUpdate(
    { key: 'smtp' },
    { $set: { value: store, updatedBy } },
    { upsert: true }
  );
  return getPublicSmtpConfig();
}
