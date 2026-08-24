import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { sha256 } from '@/lib/crypto';
import { hashPassword } from '@/lib/auth';
import { badRequest, jsonOk, safeParseJson, internalError, dbUnavailable, isDbConnectionError } from '@/lib/http';
import { resetPasswordSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { User } from '@/models/User';
import { PasswordReset } from '@/models/PasswordReset';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
  const body = await safeParseJson(req);
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });

  await dbConnect();
  const tokenHash = sha256(parsed.data.token);
  const reset = await PasswordReset.findOne({
    tokenHash,
    used: false,
    expiresAt: { $gt: new Date() }
  });
  if (!reset) return badRequest('This reset link is invalid or has expired. Request a new one.');

  const user = await User.findById(reset.userId);
  if (!user) return badRequest('Account not found.');

  // Targeted update (not user.save(), which re-validates the whole document and would
  // crash the recovery flow on any legacy/migrated field — see auth/login/route.ts).
  const passwordHash = await hashPassword(parsed.data.password);
  await User.updateOne({ _id: user._id }, { $set: { passwordHash } });

  // Single-use: burn this token and any other outstanding ones for the user.
  await PasswordReset.updateMany({ userId: user._id, used: false }, { $set: { used: true } });

  await audit(null, req, { action: 'auth.password.reset', resourceType: 'user', resourceId: String(user._id) });
  return jsonOk({ ok: true, message: 'Password updated. You can now sign in.' });
  } catch (err) {
    if (isDbConnectionError(err)) {
      console.error('auth.reset-password DB unavailable', err);
      return dbUnavailable();
    }
    console.error('auth.reset-password failed', err);
    return internalError();
  }
}
