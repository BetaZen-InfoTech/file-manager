'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginForm({
  demoEmail,
  demoPassword
}: {
  demoEmail: string;
  demoPassword: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasDemo = Boolean(demoEmail && demoPassword);

  async function doLogin(em: string, pw: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: em, password: pw })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message || 'Login failed');
        return;
      }
      router.push(data.user.panel === 'admin' ? '/admin' : '/dashboard');
      router.refresh();
    } catch (err: any) {
      setError(err?.message || 'Network error');
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    doLogin(email, password);
  }

  function fillAndSignIn() {
    setEmail(demoEmail);
    setPassword(demoPassword);
    doLogin(demoEmail, demoPassword); // autofill + enter
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <div className="card space-y-5">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-white">Sign in</h1>
          <p className="text-sm text-gray-400">Use your admin or vendor account.</p>
        </div>

        {hasDemo && (
          <div className="space-y-2 rounded-md border border-border bg-[#1c1c20] px-3 py-3">
            <div className="text-xs font-medium text-gray-300">Default login</div>
            <div className="text-[11px] text-gray-400">
              <div>
                ID: <code className="text-gray-200">{demoEmail}</code>
              </div>
              <div>
                Password: <code className="text-gray-200">{demoPassword}</code>
              </div>
            </div>
            <button
              type="button"
              className="btn w-full"
              disabled={busy}
              onClick={fillAndSignIn}
            >
              {busy ? 'Signing in…' : 'Autofill & sign in'}
            </button>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-gray-400" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-400" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <button type="submit" className="btn w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
