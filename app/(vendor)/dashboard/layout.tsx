import { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/session-server';
import { ImpersonationBanner } from '@/components/ImpersonationBanner';
import { appVersion } from '@/lib/version';
import { Logo } from '@/components/Logo';
import { Icon } from '@/components/Icon';
import { SidebarNav, NavItem } from '@/components/SidebarNav';

export const dynamic = 'force-dynamic';

const nav: NavItem[] = [
  { href: '/dashboard', label: 'Home', icon: 'home' },
  { href: '/dashboard/buckets', label: 'Buckets', icon: 'folder' },
  { href: '/dashboard/files', label: 'Files', icon: 'files' },
  { href: '/dashboard/api-keys', label: 'API keys', icon: 'key' },
  { href: '/dashboard/jwt', label: 'JWT', icon: 'token' },
  { href: '/dashboard/billing', label: 'Billing', icon: 'card' },
  { href: '/dashboard/trash', label: 'Trash', icon: 'trash' }
];

export default async function VendorLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect('/login');
  if (['super_admin', 'platform_staff'].includes(session.user.role)) redirect('/admin');

  const suspended = session.vendor?.status === 'suspended';
  const vendorName = session.vendor?.name || 'Vendor';

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="hidden border-r border-border bg-panel md:flex md:w-64 md:flex-col">
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
          <Logo className="h-9 w-9" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">{vendorName}</div>
            <div className="truncate text-xs text-gray-400">{session.user.email}</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <SidebarNav items={nav} />
        </div>

        <div className="border-t border-border p-3">
          <form action="/api/v1/auth/logout" method="post">
            <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-danger transition hover:bg-danger/10">
              <Icon name="logout" className="h-[18px] w-[18px]" />
              Sign out
            </button>
          </form>
          <div className="px-3 pt-2 font-mono text-[11px] text-gray-600">v{appVersion()}</div>
        </div>
      </aside>

      {/* mobile top bar */}
      <header className="flex items-center justify-between border-b border-border bg-panel px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <Logo className="h-7 w-7" />
          <span className="truncate text-sm font-semibold text-white">{vendorName}</span>
        </div>
        <form action="/api/v1/auth/logout" method="post">
          <button className="text-xs text-danger">Sign out</button>
        </form>
      </header>

      <main className="flex-1 px-4 py-5 md:px-8 md:py-8">
        {session.impersonator && (
          <ImpersonationBanner
            vendorUserEmail={session.user.email}
            vendorName={vendorName}
            adminEmail={session.impersonator.email}
          />
        )}
        {suspended && (
          <div className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            Your account is suspended. Uploads, downloads, and link access are blocked.
          </div>
        )}
        {children}
        <SidebarNav items={nav} variant="bottom" />
        <div className="h-20 md:hidden" />
      </main>
    </div>
  );
}
