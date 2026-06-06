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
