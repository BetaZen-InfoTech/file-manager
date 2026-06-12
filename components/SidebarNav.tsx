'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, IconName } from './Icon';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

function activeHref(items: NavItem[], pathname: string): string {
  // Longest-prefix match so "/admin/vendors" wins over "/admin".
  let best = '';
  for (const it of items) {
    const match = pathname === it.href || pathname.startsWith(it.href + '/');
    if (match && it.href.length > best.length) best = it.href;
  }
  return best;
}

export function SidebarNav({ items, variant = 'side' }: { items: NavItem[]; variant?: 'side' | 'bottom' }) {
  const pathname = usePathname() || '';
  const current = activeHref(items, pathname);

  if (variant === 'bottom') {
    return (
      <nav className="fixed inset-x-0 bottom-0 z-10 flex gap-1 overflow-x-auto border-t border-border bg-panel px-2 py-2 safe-pad-bottom md:hidden">
        {items.map((it) => {
          const active = it.href === current;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`flex min-w-[60px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] transition ${
                active ? 'bg-accent/15 text-accent' : 'text-gray-400 hover:bg-[#1c1c20]'
              }`}
            >
              <Icon name={it.icon} className="h-[18px] w-[18px]" />
              <span className="truncate">{it.label}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((it) => {
        const active = it.href === current;
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
              active
                ? 'bg-accent/15 font-medium text-white'
                : 'text-gray-400 hover:bg-[#1c1c20] hover:text-gray-100'
            }`}
          >
            <Icon
              name={it.icon}
              className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-accent' : 'text-gray-500 group-hover:text-gray-300'}`}
            />
            <span className="truncate">{it.label}</span>
            {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
          </Link>
        );
      })}
    </nav>
  );
}
