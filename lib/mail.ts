import nodemailer, { Transporter } from 'nodemailer';
import { getSmtpConfig, type SmtpConfig } from './smtp/config';

// Cache the transporter, rebuilding only when the saved SMTP config changes, so
// admin edits in the panel take effect without a restart.
let cached: { sig: string; transporter: Transporter; from: string } | null = null;

function buildFrom(cfg: SmtpConfig): string {
  if (!cfg.fromEmail) return '';
  return cfg.fromName ? `"${cfg.fromName.replace(/"/g, '')}" <${cfg.fromEmail}>` : cfg.fromEmail;
}

async function getMailer(ignoreEnabled = false): Promise<{ transporter: Transporter; from: string } | null> {
  const cfg = await getSmtpConfig();
  // `ignoreEnabled` lets the admin "test" verify/send before flipping sending on.
  if (!cfg.host) return null;
  if (!ignoreEnabled && !cfg.enabled) return null;
  const sig = JSON.stringify([cfg.host, cfg.port, cfg.encryption, cfg.user, cfg.pass, cfg.fromName, cfg.fromEmail]);
  if (cached && cached.sig === sig) return { transporter: cached.transporter, from: cached.from };
  // Map the encryption mode to nodemailer transport options:
  //   tls      → implicit TLS on connect (SMTPS, port 465)
  //   starttls → plain connect, then require STARTTLS upgrade (port 587)
  //   none     → no TLS at all (plaintext — dev/relay only)
  const opts: Record<string, unknown> = {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.encryption === 'tls',
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined
  };
  if (cfg.encryption === 'starttls') opts.requireTLS = true;
  if (cfg.encryption === 'none') opts.ignoreTLS = true;
  const transporter = nodemailer.createTransport(opts as any);
  const from = buildFrom(cfg);
  cached = { sig, transporter, from };
  return { transporter, from };
}

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendMail(
  input: MailInput,
  opts: { force?: boolean } = {}
): Promise<{ ok: boolean; reason?: string }> {
  // force = send even when sending is toggled off (used by the admin test).
  const m = await getMailer(!!opts.force);
  if (!m) return { ok: false, reason: 'set an SMTP host first' };
  try {
    await m.transporter.sendMail({
      from: m.from || undefined,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text
    });
    return { ok: true };
  } catch (err: any) {
    console.error('mail send failed', err);
    return { ok: false, reason: err?.message || 'send failed' };
  }
}

/** Verify SMTP connectivity for the admin "test" action (regardless of the enabled toggle). */
export async function verifyMailer(): Promise<{ ok: boolean; reason?: string }> {
  const m = await getMailer(true);
  if (!m) return { ok: false, reason: 'set an SMTP host first' };
  try {
    await m.transporter.verify();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'verify failed' };
  }
}

export const MailTemplates = {
  welcome(name: string, panelUrl: string): MailInput {
    return {
      to: '',
      subject: 'Welcome to File Manager',
      html: `<p>Hi ${name},</p><p>Your account is ready. Sign in at <a href="${panelUrl}">${panelUrl}</a>.</p>`,
      text: `Hi ${name}, your account is ready. Sign in at ${panelUrl}`
    };
  },
  suspended(vendorName: string, reason: string): MailInput {
    return {
      to: '',
      subject: 'Your account has been suspended',
      html: `<p>Hello,</p><p>The account <strong>${vendorName}</strong> has been suspended.</p><p>Reason: ${reason || 'not provided'}</p>`,
      text: `Account ${vendorName} has been suspended. Reason: ${reason || 'not provided'}`
    };
  },
  quotaWarning(vendorName: string, pct: number): MailInput {
    return {
      to: '',
      subject: 'Storage quota warning',
      html: `<p>Storage usage for <strong>${vendorName}</strong> has reached ${pct.toFixed(0)}%.</p>`,
      text: `Storage usage for ${vendorName} has reached ${pct.toFixed(0)}%`
    };
  },
  passwordReset(resetUrl: string, name?: string): MailInput {
    const safeName = name || 'there';
    return {
      to: '',
      subject: 'Reset your File Manager password',
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#111">Reset your password</h2>
          <p>Hi ${safeName},</p>
          <p>We received a request to reset your password. Click the button below to choose a new one. This link is valid for <strong>1 hour</strong> and can be used once.</p>
          <p style="margin:24px 0">
            <a href="${resetUrl}" style="background:#6366f1;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Reset password</a>
          </p>
          <p style="color:#666;font-size:13px">Or paste this link into your browser:<br><a href="${resetUrl}">${resetUrl}</a></p>
          <p style="color:#666;font-size:13px">If you didn't request this, you can safely ignore this email — your password won't change.</p>
        </div>`,
      text: `Reset your password (valid 1 hour, single use): ${resetUrl}\n\nIf you didn't request this, ignore this email.`
    };
  }
};
