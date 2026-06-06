import { NextRequest } from 'next/server';
import argon2 from 'argon2';
import { dbConnect } from './db';
import { env } from './env';
import { sha256 } from './crypto';
import { verifySession } from './jwt';
import { permissionsForRole, type Principal, type Permission } from './rbac';
import { User } from '@/models/User';
import { Vendor } from '@/models/Vendor';
import { ApiKey } from '@/models/ApiKey';

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

function getSessionToken(req: NextRequest): string | null {
  const cookieVal = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  if (cookieVal) return cookieVal;
  const header = req.headers.get('authorization');
  if (header && header.toLowerCase().startsWith('session ')) {
    return header.slice(8).trim();
  }
  return null;
}

function getApiKey(req: NextRequest): string | null {
  const xkey = req.headers.get('x-api-key');
  if (xkey) return xkey.trim();
  const auth = req.headers.get('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    if (token.startsWith('fmsk_')) return token;
  }
  return null;
}

function getBearerJwt(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    if (!token.startsWith('fmsk_')) return token;
  }
  return null;
}

async function principalFromSession(token: string): Promise<Principal | null> {
  const payload = await verifySession(token);
  if (!payload) return null;
  await dbConnect();
  const user = await User.findById(payload.userId).lean();
  if (!user || user.status !== 'active') return null;
  let vendorStatus: Principal['vendorStatus'] = 'none';
  if (user.vendorId) {
    const vendor = await Vendor.findById(user.vendorId).lean();
    if (!vendor) return null;
    vendorStatus = vendor.status;
  }
  return {
    kind: 'session',
    userId: String(user._id),
    vendorId: user.vendorId ? String(user.vendorId) : null,
    vendorStatus,
    role: user.role,
    panel: payload.panel,
    permissions: (user.permissions?.length ? user.permissions : permissionsForRole(user.role)) as Permission[],
    email: user.email
  };
}

async function principalFromApiKey(plainKey: string): Promise<Principal | null> {
  await dbConnect();
  const keyHash = sha256(plainKey);
  const apiKey = await ApiKey.findOne({ keyHash }).lean();
  if (!apiKey || apiKey.status !== 'active') return null;
  if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) return null;
  const vendor = await Vendor.findById(apiKey.vendorId).lean();
  if (!vendor) return null;
  // Touch lastUsedAt (best-effort, non-blocking)
  ApiKey.updateOne({ _id: apiKey._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
  return {
    kind: 'apikey',
    apiKeyId: String(apiKey._id),
    vendorId: String(apiKey.vendorId),
    vendorStatus: vendor.status,
    role: 'vendor_member',
    panel: 'vendor',
    permissions: apiKey.permissions as Permission[],
    bucketIds: (apiKey.bucketIds || []).map((b) => String(b))
  };
}

export async function authenticate(req: NextRequest): Promise<Principal | null> {
  const apiKey = getApiKey(req);
  if (apiKey) {
    const p = await principalFromApiKey(apiKey);
    if (p) return p;
  }
  const session = getSessionToken(req);
  if (session) {
    const p = await principalFromSession(session);
    if (p) return p;
  }
  return null;
}

export function getBearerToken(req: NextRequest): string | null {
  return getBearerJwt(req);
}
