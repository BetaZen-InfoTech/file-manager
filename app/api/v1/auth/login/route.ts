import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { dbConnect } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { signSession } from '@/lib/jwt';
import { permissionsForRole } from '@/lib/rbac';
import { loginSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { env } from '@/lib/env';
import { badRequest, jsonOk, unauthorized, maintenance, safeParseJson, internalError } from '@/lib/http';
import { getMaintenance } from '@/lib/maintenance';
import { User } from '@/models/User';
import { Vendor } from '@/models/Vendor';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
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

  // Stamp last-login (and backfill permissions if empty) with a TARGETED update.
  // NOTE: never `user.save()` here — save() re-validates the ENTIRE document, so a
  // single legacy/migrated field (e.g. an old `role` value no longer in the enum)
  // would throw a ValidationError and crash login with an opaque empty 500. A
  // scoped $set touches only these fields and never blocks a valid credential.
  const update: Record<string, unknown> = { lastLoginAt: new Date() };
  if (!user.permissions || user.permissions.length === 0) {
    update.permissions = permissionsForRole(user.role);
  }
  await User.updateOne({ _id: user._id }, { $set: update });

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
  } catch (err) {
    // Any unexpected failure (DB hiccup, cast/validation error, etc.) must return a
    // proper JSON error — never an empty body, which the client can't parse ("Unexpected
    // end of JSON input") and which hides the real cause.
    console.error('auth.login failed', err);
    return internalError();
  }
}
