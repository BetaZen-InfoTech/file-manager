import { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/session-server';

export const dynamic = 'force-dynamic';

const nav = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/vendors', label: 'Vendors' },
  { href: '/admin/usage', label: 'Usage' },
  { href: '/admin/audit-logs', label: 'Audit' },
  { href: '/admin/seo', label: 'SEO' },
  { href: '/admin/maintenance', label: 'Maintenance' }
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect('/login');
  if (!['super_admin', 'platform_staff'].includes(session.user.role)) redirect('/dashboard');

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="hidden border-r border-border bg-panel md:flex md:w-60 md:flex-col">
        <div className="border-b border-border px-5 py-4">
          <div className="text-sm font-semibold text-white">Admin Panel</div>
          <div className="text-xs text-gray-400">{session.user.email}</div>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="rounded-md px-3 py-2 text-sm text-gray-300 hover:bg-[#1c1c20]"
            >
              {n.label}
            </Link>
          ))}
          <form action="/api/v1/auth/logout" method="post" className="mt-2">
            <button className="w-full rounded-md px-3 py-2 text-left text-sm text-danger hover:bg-[#1c1c20]">
              Sign out
            </button>
          </form>
        </nav>
      </aside>

      <header className="flex items-center justify-between border-b border-border bg-panel px-4 py-3 md:hidden">
        <div className="text-sm font-semibold text-white">Admin</div>
        <form action="/api/v1/auth/logout" method="post">
          <button className="text-xs text-danger">Sign out</button>
        </form>
      </header>

      <main className="flex-1 px-4 py-5 md:px-8 md:py-8">
        {children}
        <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-6 gap-1 border-t border-border bg-panel px-2 py-2 safe-pad-bottom md:hidden">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="flex flex-col items-center justify-center rounded-md px-1 py-1 text-[11px] text-gray-300 hover:bg-[#1c1c20]"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="h-16 md:hidden" />
      </main>
    </div>
  );
}
