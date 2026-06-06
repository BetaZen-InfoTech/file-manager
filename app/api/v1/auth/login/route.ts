import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { dbConnect } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { signSession } from '@/lib/jwt';
import { permissionsForRole } from '@/lib/rbac';
import { loginSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { env } from '@/lib/env';
import { badRequest, jsonOk, unauthorized, maintenance, safeParseJson } from '@/lib/http';
import { getMaintenance } from '@/lib/maintenance';
import { User } from '@/models/User';
import { Vendor } from '@/models/Vendor';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await safeParseJson(req);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });

  await dbConnect();
  const user = await User.findOne({ email: parsed.data.email.toLowerCase() });
  if (!user || user.status !== 'active') return unauthorized('Invalid credentials');
  const ok = await verifyPassword(user.passwordHash, parsed.data.password);
  if (!ok) return unauthorized('Invalid credentials');

  const isAdmin = ['super_admin', 'platform_staff'].includes(user.role);

  const m = await getMaintenance();
  if (m.enabled && !isAdmin) return maintenance(m.message);

  if (user.vendorId) {
    const v = await Vendor.findById(user.vendorId).lean();
    if (!v) return unauthorized('Vendor not found');
    if (v.status === 'suspended') {
      return NextResponse.json(
        { error: { code: 'VENDOR_SUSPENDED', message: 'This vendor is suspended.' } },
        { status: 403 }
      );
    }
  }

  const panel: 'admin' | 'vendor' = isAdmin ? 'admin' : 'vendor';
  const token = await signSession({
    userId: String(user._id),
    vendorId: user.vendorId ? String(user.vendorId) : null,
    role: user.role,
    panel
  });

  user.lastLoginAt = new Date();
  if (!user.permissions || user.permissions.length === 0) {
    user.permissions = permissionsForRole(user.role);
  }
  await user.save();

  cookies().set(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: env.SESSION_TTL_HOURS * 3600
  });

  await audit(
    {
      kind: 'session',
      userId: String(user._id),
      vendorId: user.vendorId ? String(user.vendorId) : null,
      vendorStatus: user.vendorId ? 'active' : 'none',
      role: user.role,
      panel,
      permissions: [],
      email: user.email
    },
    req,
    { action: 'auth.login' }
  );

  return jsonOk({
    user: {
      id: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role,
      panel,
      vendorId: user.vendorId ? String(user.vendorId) : null
    }
  });
}
