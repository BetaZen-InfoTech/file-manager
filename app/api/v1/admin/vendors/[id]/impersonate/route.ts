import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { dbConnect } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { canImpersonate } from '@/lib/rbac';
import { signSession } from '@/lib/jwt';
import { selectImpersonationTarget } from '@/lib/impersonation';
import { badRequest, forbidden, jsonOk, notFound, unauthorized } from '@/lib/http';
import { audit } from '@/lib/audit';
import { env } from '@/lib/env';
import { Vendor } from '@/models/Vendor';
import { User } from '@/models/User';

export const runtime = 'nodejs';

// Impersonation sessions are short-lived to limit blast radius.
const IMPERSONATION_TTL_MIN = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!canImpersonate(p)) return forbidden('Only super admins can log in as a vendor.');
  // No nested impersonation — the admin must stop the current one first.
  if (p.impersonatorId) {
    return badRequest('Already impersonating — stop the current session first.');
  }

  await dbConnect();
  const vendor = await Vendor.findById(params.id).lean();
  if (!vendor) return notFound('vendor not found');

  const users = await User.find({ vendorId: vendor._id }).lean();
  const target = selectImpersonationTarget(
    users.map((u) => ({ ...u, role: u.role, status: u.status, createdAt: u.createdAt }))
  );
  if (!target) {
    return badRequest('This vendor has no user account to log in as. Create an owner first.');
  }

  const token = await signSession(
    {
      userId: String(target._id),
      vendorId: String(vendor._id),
      role: target.role,
      panel: 'vendor',
      act: { sub: p.userId!, email: p.email || '', role: p.role }
    },
    `${IMPERSONATION_TTL_MIN}m`
  );

  cookies().set(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: IMPERSONATION_TTL_MIN * 60
  });

  await audit(p, req, {
    action: 'admin.impersonate.start',
    resourceType: 'user',
    resourceId: String(target._id),
    vendorId: String(vendor._id),
    meta: { targetEmail: target.email, targetRole: target.role, vendorName: vendor.name }
  });

  return jsonOk({
    ok: true,
    redirect: '/dashboard',
    target: { email: target.email, vendor: vendor.name }
  });
}
