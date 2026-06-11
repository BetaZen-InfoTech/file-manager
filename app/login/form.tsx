'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/Logo';

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
  const [showPw, setShowPw] = useState(false);
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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-12">
      {/* ambient glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-10%] h-[420px] w-[640px] -translate-x-1/2 rounded-full bg-accent/20 blur-[130px]" />
      </div>

      <div className="relative w-full max-w-md">
        {/* brand */}
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo className="h-12 w-12" />
          <h1 className="mt-3 text-xl font-semibold text-white">Welcome back</h1>
          <p className="mt-1 text-sm text-gray-400">Sign in to your admin or vendor account.</p>
        </div>

        <div className="card space-y-5 p-6 shadow-xl shadow-black/30">
          {hasDemo && (
            <div className="space-y-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                Default login
              </div>
              <div className="space-y-0.5 text-[11px] text-gray-400">
                <div>
                  ID: <code className="text-gray-200">{demoEmail}</code>
                </div>
                <div>
                  Password: <code className="text-gray-200">{demoPassword}</code>
                </div>
              </div>
              <button type="button" className="btn w-full" disabled={busy} onClick={fillAndSignIn}>
                {busy ? 'Signing in…' : 'Autofill & sign in'}
              </button>
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-400" htmlFor="email">
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
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-400" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  className="input pr-16"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11px] text-gray-400 hover:text-gray-200"
                  tabIndex={-1}
                >
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </div>
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

        <div className="mt-6 text-center">
          <Link href="/" className="text-xs text-gray-500 transition hover:text-gray-300">
            ← Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
