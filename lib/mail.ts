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
  }
};
