import Link from 'next/link';
import { Logo } from '@/components/Logo';

export const dynamic = 'force-dynamic';

const features = [
  { title: 'Buckets & RBAC', desc: 'Per-tenant buckets with fine-grained roles and permissions.' },
  { title: '3 link types', desc: 'Public, temporary, and JWT-protected private downloads.' },
  { title: 'API & JWT', desc: 'REST API, scoped API keys, and 3rd-party token issuance.' },
  { title: 'Billing built-in', desc: 'Subscription plans paid via Razorpay or PhonePe.' }
];

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* ambient glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-12%] h-[460px] w-[760px] -translate-x-1/2 rounded-full bg-accent/20 blur-[130px]" />
        <div className="absolute bottom-[-20%] right-[-10%] h-[360px] w-[360px] rounded-full bg-[#8b5cf6]/10 blur-[120px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-6">
        {/* top nav */}
        <header className="flex items-center justify-between py-6">
          <div className="flex items-center gap-2.5">
            <Logo className="h-9 w-9" />
            <span className="text-sm font-semibold text-white">File Manager</span>
          </div>
          <nav className="flex items-center gap-2">
            <a href="/docs" className="btn-secondary px-3 py-1.5 text-xs">
              Docs
            </a>
            <Link href="/login" className="btn px-3 py-1.5 text-xs">
              Sign in
            </Link>
          </nav>
        </header>

        {/* hero */}
        <section className="flex flex-1 flex-col items-center justify-center py-10 text-center sm:py-16">
          <span className="chip mb-6">Multi-tenant · Next.js · MongoDB · MinIO</span>
          <h1 className="bg-gradient-to-br from-white via-white to-gray-500 bg-clip-text text-4xl font-bold leading-[1.1] tracking-tight text-transparent sm:text-6xl">
            Secure files,
            <br />
            shareable links.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-gray-400">
            A self-hosted, multi-tenant file manager — buckets, RBAC, API keys, 3rd-party JWT, and
            public / private / temporary download links, all on your own VPS.
          </p>
          <div className="mt-8 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
            <Link href="/login" className="btn w-full px-6 sm:w-auto">
              Sign in →
            </Link>
            <a href="/docs" className="btn-secondary w-full px-6 sm:w-auto">
              API docs
            </a>
          </div>

          {/* feature grid */}
          <div className="mt-16 grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => (
              <div
                key={f.title}
                className="card text-left transition hover:border-accent/50 hover:bg-[#16161a]"
              >
                <div className="text-sm font-semibold text-white">{f.title}</div>
                <div className="mt-1.5 text-xs leading-relaxed text-gray-400">{f.desc}</div>
              </div>
            ))}
          </div>
        </section>

        <footer className="flex flex-col items-center justify-between gap-2 border-t border-border/60 py-6 text-xs text-gray-500 sm:flex-row">
          <span>© BetaZen InfoTech</span>
          <span>Admin &amp; vendor portals share one login.</span>
        </footer>
      </div>
    </main>
  );
}
