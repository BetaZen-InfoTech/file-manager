'use client';

import { useEffect, useState } from 'react';

interface Cfg {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  passSet: boolean;
  fromName: string;
  fromEmail: string;
}

const PRESETS: Record<string, { host: string; port: number; secure: boolean }> = {
  Gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
  'Brevo (Sendinblue)': { host: 'smtp-relay.brevo.com', port: 587, secure: false },
  Mailgun: { host: 'smtp.mailgun.org', port: 587, secure: false },
  SendGrid: { host: 'smtp.sendgrid.net', port: 587, secure: false },
  'Amazon SES': { host: 'email-smtp.us-east-1.amazonaws.com', port: 587, secure: false },
  Zoho: { host: 'smtp.zoho.com', port: 465, secure: true }
};

export default function SmtpClient({ canEdit }: { canEdit: boolean }) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [pass, setPass] = useState('');
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/v1/admin/smtp')
      .then((r) => r.json())
      .then((d) => {
        setCfg(d);
        setTestTo((t) => t);
      })
      .catch(() => setMsg({ kind: 'err', text: 'Could not load settings' }));
  }, []);

  function patch(p: Partial<Cfg>) {
    setCfg((c) => (c ? { ...c, ...p } : c));
  }

  async function submit(action: 'save' | 'test') {
    if (!cfg) return;
    setBusy(true);
    setMsg(null);
    const body: any = {
      action,
      enabled: cfg.enabled,
      host: cfg.host,
      port: Number(cfg.port),
      secure: cfg.secure,
      user: cfg.user,
      fromName: cfg.fromName,
      fromEmail: cfg.fromEmail
    };
    if (pass) body.pass = pass;
    if (action === 'test' && testTo) body.testTo = testTo;
    try {
      const r = await fetch('/api/v1/admin/smtp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setMsg({ kind: 'err', text: d?.error?.message || 'Failed' });
      } else {
        setCfg(d);
        setPass('');
        setMsg({
          kind: 'ok',
          text: action === 'test' ? (d?.sentTo ? `Test email sent to ${d.sentTo} ✅` : 'SMTP connection OK ✅') : 'Saved ✅'
        });
      }
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Network error' });
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) return <div className="card text-sm text-gray-500">Loading…</div>;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="card space-y-4">
        <label className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-white">Enable email sending</div>
            <div className="text-xs text-gray-500">When off, emails are silently skipped.</div>
          </div>
          <input
            type="checkbox"
            checked={cfg.enabled}
            disabled={!canEdit}
            onChange={(e) => patch({ enabled: e.target.checked })}
            className="h-5 w-5 accent-accent"
          />
        </label>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-400">Quick preset</label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(PRESETS).map(([name, p]) => (
              <button
                key={name}
                disabled={!canEdit}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-gray-300 hover:bg-[#1c1c20] disabled:opacity-50"
                onClick={() => patch({ host: p.host, port: p.port, secure: p.secure })}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-400">SMTP host</label>
            <input className="input" value={cfg.host} disabled={!canEdit} onChange={(e) => patch({ host: e.target.value })} placeholder="smtp.gmail.com" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">Port</label>
            <input className="input" type="number" value={cfg.port} disabled={!canEdit} onChange={(e) => patch({ port: Number(e.target.value) })} placeholder="587" />
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input type="checkbox" checked={cfg.secure} disabled={!canEdit} onChange={(e) => patch({ secure: e.target.checked })} />
          Use TLS on connect (SSL) — enable for port 465; leave off for 587 (STARTTLS)
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">Username</label>
            <input className="input" value={cfg.user} disabled={!canEdit} onChange={(e) => patch({ user: e.target.value })} placeholder="apikey or user@domain" autoComplete="off" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">
              Password {cfg.passSet && <span className="text-emerald-400">· set</span>}
            </label>
            <input className="input" type="password" value={pass} disabled={!canEdit} onChange={(e) => setPass(e.target.value)} placeholder={cfg.passSet ? '•••••• (leave blank to keep)' : 'app password / API key'} autoComplete="new-password" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">From name</label>
            <input className="input" value={cfg.fromName} disabled={!canEdit} onChange={(e) => patch({ fromName: e.target.value })} placeholder="BetaZen CDN" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-400">From email</label>
            <input className="input" type="email" value={cfg.fromEmail} disabled={!canEdit} onChange={(e) => patch({ fromEmail: e.target.value })} placeholder="no-reply@betazeninfotech.com" />
          </div>
        </div>
      </div>

      <div className="card space-y-3">
        <div className="text-sm font-medium text-white">Send a test email</div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="input flex-1" type="email" value={testTo} disabled={!canEdit} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
          <button className="btn-secondary whitespace-nowrap" disabled={!canEdit || busy} onClick={() => submit('test')}>
            {busy ? 'Testing…' : 'Save & send test'}
          </button>
        </div>
        <p className="text-xs text-gray-500">Saves the settings, verifies the connection, then sends a test message.</p>
      </div>

      {msg && (
        <div className={`rounded-md border px-3 py-2 text-sm ${msg.kind === 'ok' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-danger/40 bg-danger/10 text-danger'}`}>
          {msg.text}
        </div>
      )}

      {canEdit && (
        <div className="flex justify-end">
          <button className="btn" disabled={busy} onClick={() => submit('save')}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      )}
      {!canEdit && <p className="text-xs text-gray-500">Read-only — only super admins can change SMTP settings.</p>}
    </div>
  );
}
