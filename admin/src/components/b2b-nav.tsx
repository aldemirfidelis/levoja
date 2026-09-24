'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@levoja/web-kit/ui';
import { useSession } from '@/lib/session';

const ITEMS = [
  { href: '/b2b', label: 'Contratos', permission: 'contracts.read' },
  { href: '/b2b/faturas', label: 'Faturas', permission: 'invoices.read' },
] as const;

export function B2bNav() {
  const pathname = usePathname();
  const { can } = useSession();
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border" aria-label="Corporativo">
      {ITEMS.filter((item) => can(item.permission)).map((item) => {
        const active = item.href === '/b2b' ? pathname === '/b2b' || pathname.startsWith('/b2b/contratos') : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors', active ? 'border-brand-500 text-brand-600' : 'border-transparent text-muted hover:text-fg')}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export const CONTRACT_TONE = { DRAFT: 'neutral', ACTIVE: 'success', SUSPENDED: 'warning', ENDED: 'neutral' } as const;
export const INVOICE_TONE = { ISSUED: 'warning', PAID: 'success', OVERDUE: 'danger', CANCELED: 'neutral' } as const;
