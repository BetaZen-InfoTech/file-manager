import { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { can } from '@/lib/rbac';
import { badRequest, forbidden, jsonOk, safeParseJson, unauthorized } from '@/lib/http';
import { smtpConfigSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { getPublicSmtpConfig, setSmtpConfig } from '@/lib/smtp/config';
import { sendMail, verifyMailer } from '@/lib/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:vendor:read')) return forbidden();
  return jsonOk(await getPublicSmtpConfig());
}

export async function POST(req: NextRequest) {
  const p = await authenticate(req);
  if (!p) return unauthorized();
  if (!can(p, 'admin:maintenance:toggle')) return forbidden();
  const parsed = smtpConfigSchema.safeParse(await safeParseJson(req));
  if (!parsed.success) return badRequest('Invalid input', { issues: parsed.error.issues });
  const { action, testTo, ...patch } = parsed.data;

  // Persist first so a "test" verifies exactly what was saved.
  const config = await setSmtpConfig(patch, p.userId || null);

  if (action === 'test') {
    const verify = await verifyMailer();
    if (!verify.ok) {
      await audit(p, req, { action: 'smtp.test', resourceType: 'platform_setting', meta: { ok: false, reason: verify.reason } });
      return badRequest(`SMTP connection failed: ${verify.reason}`);
    }
    let sent: { ok: boolean; reason?: string } = { ok: true };
    if (testTo) {
      sent = await sendMail({
        to: testTo,
        subject: 'BetaZen CDN — SMTP test email',
        html: '<p>✅ Your SMTP settings are working. This is a test email from the BetaZen CDN admin panel.</p>',
        text: 'Your SMTP settings are working. This is a test email from the BetaZen CDN admin panel.'
      });
    }
    await audit(p, req, { action: 'smtp.test', resourceType: 'platform_setting', meta: { ok: sent.ok, testTo: testTo || null } });
    if (!sent.ok) return badRequest(`Connected, but sending failed: ${sent.reason}`);
    return jsonOk({ ...config, tested: true, sentTo: testTo || null });
  }

  await audit(p, req, { action: 'smtp.config.update', resourceType: 'platform_setting' });
  return jsonOk(config);
}
