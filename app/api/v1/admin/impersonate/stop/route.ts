import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { dbConnect } from '@/lib/db';
import { verifySession, signSession } from '@/lib/jwt';
import { canRestoreAdmin } from '@/lib/impersonation';
import { badRequest, jsonOk, unauthorized } from '@/lib/http';
import { audit } from '@/lib/audit';
import { env } from '@/lib/env';
import { User } from '@/models/User';
import type { Role } from '@/models/User';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const cookieVal = cookies().get(env.SESSION_COOKIE_NAME)?.value;
  const payload = cookieVal ? await verifySession(cookieVal) : null;
  if (!payload?.act?.sub) return badRequest('Not impersonating.');

  await dbConnect();
  const admin = await User.findById(payload.act.sub).lean();
  if (!canRestoreAdmin(admin)) {
    // The original admin account vanished or was demoted — drop the session entirely.
    cookies().delete(env.SESSION_COOKIE_NAME);
    return unauthorized('Original admin account is no longer available. Please sign in again.');
  }

  const token = await signSession({
    userId: String(admin!._id),
    vendorId: null,
    role: admin!.role,
    panel: 'admin'
  });

  cookies().set(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: env.SESSION_TTL_HOURS * 3600
  });

  await audit(
    {
      kind: 'session',
      userId: String(admin!._id),
      vendorId: null,
      vendorStatus: 'none',
      role: admin!.role as Role,
      panel: 'admin',
      permissions: [],
      email: admin!.email
    },
    req,
    {
      action: 'admin.impersonate.stop',
      resourceType: 'user',
      resourceId: String(payload.userId),
      vendorId: payload.vendorId,
      meta: { fromUserId: payload.userId }
    }
  );

  return jsonOk({ ok: true, redirect: '/admin' });
}
