'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/Logo';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const j = await res.json().catch(() => null);
      setBusy(false);
      if (res.ok) setSent(true);
      else setError(j?.error?.message || 'Something went wrong.');
    } catch (err: any) {
      setBusy(false);
      setError(err?.message || 'Network error');
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-12">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-10%] h-[420px] w-[640px] -translate-x-1/2 rounded-full bg-accent/20 blur-[130px]" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo className="h-12 w-12" />
          <h1 className="mt-3 text-xl font-semibold text-white">Forgot password</h1>
          <p className="mt-1 text-sm text-gray-400">We&apos;ll email you a link to reset it.</p>
        </div>

        <div className="card space-y-5 p-6 shadow-xl shadow-black/30">
          {sent ? (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
                ✓
              </div>
              <p className="text-sm text-gray-300">
                If an account exists for <strong className="text-white">{email}</strong>, a reset link
                is on its way. The link is valid for 1 hour.
              </p>
              <Link href="/login" className="btn w-full">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
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
              {error && (
                <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {error}
                </div>
              )}
              <button type="submit" className="btn w-full" disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}
        </div>

        <div className="mt-6 text-center">
          <Link href="/login" className="text-xs text-gray-500 transition hover:text-gray-300">
            ← Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
