'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';

export default function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password })
      });
      const j = await res.json().catch(() => null);
      setBusy(false);
      if (res.ok) {
        setDone(true);
        setTimeout(() => router.push('/login'), 1800);
      } else {
        setError(j?.error?.message || 'Could not reset password.');
      }
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
          <h1 className="mt-3 text-xl font-semibold text-white">Set a new password</h1>
          <p className="mt-1 text-sm text-gray-400">Choose a strong password you don&apos;t use elsewhere.</p>
        </div>

        <div className="card space-y-5 p-6 shadow-xl shadow-black/30">
          {!token ? (
            <div className="space-y-3 text-center text-sm text-gray-300">
              <p>This reset link is missing its token. Please use the link from your email, or request a new one.</p>
              <Link href="/forgot-password" className="btn w-full">
                Request a new link
              </Link>
            </div>
          ) : done ? (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
                ✓
              </div>
              <p className="text-sm text-gray-300">Password updated. Redirecting to sign in…</p>
              <Link href="/login" className="btn w-full">
                Sign in now
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-400" htmlFor="password">
                  New password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    className="input pr-16"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
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
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-400" htmlFor="confirm">
                  Confirm password
                </label>
                <input
                  id="confirm"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  className="input"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter password"
                />
              </div>
              {error && (
                <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {error}
                </div>
              )}
              <button type="submit" className="btn w-full" disabled={busy}>
                {busy ? 'Updating…' : 'Update password'}
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
