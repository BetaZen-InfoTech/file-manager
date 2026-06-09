import crypto from 'crypto';

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function md5(input: string | Buffer): string {
  return crypto.createHash('md5').update(input).digest('hex');
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function generateApiKey(prefix = 'fmsk'): { plain: string; prefix: string; hash: string } {
  const body = crypto.randomBytes(24).toString('base64url');
  const plain = `${prefix}_${body}`;
  const visiblePrefix = `${prefix}_${body.slice(0, 4)}`;
  return { plain, prefix: visiblePrefix, hash: sha256(plain) };
}

const HMAC = 'sha256';

export function hmacSha256Hex(message: string | Buffer, key: string | Buffer): string {
  return crypto.createHmac(HMAC, key).update(message).digest('hex');
}

function aesKey(): Buffer {
  // 32-byte key derived from the app's JWT secret (no extra env needed).
  const secret = process.env.JWT_SECRET || 'dev-jwt-secret-change-me-in-production-please';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * AES-256-GCM encrypt for secrets at rest (payment gateway keys, etc.).
 * Output format: enc:v1:<iv b64>:<tag b64>:<ciphertext b64>
 */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(blob: string): string {
  if (!blob) return '';
  if (!blob.startsWith('enc:v1:')) return blob; // tolerate legacy/plaintext
  const [, , ivB64, tagB64, ctB64] = blob.split(':');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString(
      'utf8'
    );
  } catch {
    return '';
  }
}
