import { NextRequest } from 'next/server';
import { dbConnect } from '@/lib/db';
import { env } from '@/lib/env';
import { randomToken, sha256 } from '@/lib/crypto';
import { badRequest, jsonOk, safeParseJson } from '@/lib/http';
import { forgotPasswordSchema } from '@/lib/validation';
import { sendMail, MailTemplates } from '@/lib/mail';
import { audit } from '@/lib/audit';
import { User } from '@/models/User';
import { PasswordReset } from '@/models/PasswordReset';

export const runtime = 'nodejs';

// Always returns 200 with the same message whether or not the email exists, so
// the endpoint can't be used to discover which emails are registered.
const GENERIC = { ok: true, message: 'If an account exists for that email, a reset link has been sent.' };

export async function POST(req: NextRequest) {
  const body = await safeParseJson(req);
  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });

  await dbConnect();
  const email = parsed.data.email.toLowerCase();
  const user = await User.findOne({ email, status: 'active' });
  if (!user) return jsonOk(GENERIC);

  // Invalidate any prior unused tokens for this user, then mint a fresh one.
  await PasswordReset.updateMany({ userId: user._id, used: false }, { $set: { used: true } });

  const plain = randomToken(32);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await PasswordReset.create({ userId: user._id, tokenHash: sha256(plain), expiresAt });

  const base = (env.APP_URL || '').replace(/\/+$/, '');
  const resetUrl = `${base}/reset-password?token=${plain}`;

  const tmpl = MailTemplates.passwordReset(resetUrl, user.name || undefined);
  const res = await sendMail({ ...tmpl, to: user.email });
  if (!res.ok) {
    // Mail not configured / send failed: surface the link in server logs so the
    // operator can still complete the flow. (Set MAIL_DRIVER=smtp for delivery.)
    console.warn(`[forgot-password] could not email ${user.email} (${res.reason}). Reset link: ${resetUrl}`);
  }

  await audit(null, req, { action: 'auth.password.forgot', resourceType: 'user', resourceId: String(user._id) });
  return jsonOk(GENERIC);
}
