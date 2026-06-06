import crypto from 'crypto';

export function verifyGithubSignature(secret: string, payload: string, signature: string): boolean {
  if (!secret || !signature || !payload) return false;
  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
