import nodemailer, { Transporter } from 'nodemailer';
import { env } from './env';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (env.MAIL_DRIVER === 'noop' || !env.MAIL_HOST) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    secure: env.MAIL_PORT === 465,
    auth: env.MAIL_USER ? { user: env.MAIL_USER, pass: env.MAIL_PASS } : undefined
  });
  return transporter;
}

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendMail(input: MailInput): Promise<{ ok: boolean; reason?: string }> {
  const t = getTransporter();
  if (!t) return { ok: false, reason: 'mail not configured' };
  try {
    await t.sendMail({
      from: env.MAIL_FROM,
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
