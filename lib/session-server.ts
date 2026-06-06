import { cookies } from 'next/headers';
import { dbConnect } from './db';
import { env } from './env';
import { verifySession, type SessionPayload } from './jwt';
import { User } from '@/models/User';
import { Vendor } from '@/models/Vendor';
import { permissionsForRole } from './rbac';

export interface ServerSession {
  payload: SessionPayload;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    permissions: string[];
    vendorId: string | null;
  };
  vendor: {
    id: string;
    name: string;
    status: string;
  } | null;
}

export async function getServerSession(): Promise<ServerSession | null> {
  const c = cookies().get(env.SESSION_COOKIE_NAME);
  if (!c?.value) return null;
  const payload = await verifySession(c.value);
  if (!payload) return null;
  await dbConnect();
  const user = await User.findById(payload.userId).lean();
  if (!user || user.status !== 'active') return null;
  let vendor: ServerSession['vendor'] = null;
  if (user.vendorId) {
    const v = await Vendor.findById(user.vendorId).lean();
    if (!v) return null;
    vendor = { id: String(v._id), name: v.name, status: v.status };
  }
  return {
    payload,
    user: {
      id: String(user._id),
      email: user.email,
      name: user.name || user.email,
      role: user.role,
      permissions:
        user.permissions?.length > 0 ? (user.permissions as string[]) : permissionsForRole(user.role),
      vendorId: user.vendorId ? String(user.vendorId) : null
    },
    vendor
  };
}
