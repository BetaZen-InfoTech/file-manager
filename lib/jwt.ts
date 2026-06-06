import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import crypto from 'crypto';
import { env } from './env';

const SECRET = new TextEncoder().encode(env.JWT_SECRET);

export interface SessionPayload extends JWTPayload {
  userId: string;
  vendorId: string | null;
  role: string;
  panel: 'admin' | 'vendor';
}

export async function signSession(payload: Omit<SessionPayload, 'exp' | 'iat'>): Promise<string> {
  return new SignJWT(payload as JWTPayload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${env.SESSION_TTL_HOURS}h`)
    .setIssuer('filemanager-saas')
    .sign(SECRET);
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, { issuer: 'filemanager-saas' });
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export interface ThirdPartyPayload extends JWTPayload {
  vendorId: string;
  sub: string;
  scopes: string[];
  bucketIds?: string[];
}

export async function issueThirdPartyJwt(
  payload: Omit<ThirdPartyPayload, 'exp' | 'iat' | 'jti'>,
  expiresInSeconds: number
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const jti = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
  const token = await new SignJWT(payload as JWTPayload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setJti(jti)
    .setExpirationTime(`${expiresInSeconds}s`)
    .setIssuer('filemanager-saas')
    .sign(SECRET);
  return { token, jti, expiresAt };
}

export async function verifyThirdPartyJwt(token: string): Promise<ThirdPartyPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, { issuer: 'filemanager-saas' });
    if (!payload.vendorId || !Array.isArray(payload.scopes)) return null;
    return payload as ThirdPartyPayload;
  } catch {
    return null;
  }
}
