'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@levoja/web-kit/ui';
import { useSession } from '@/lib/session';

const ITEMS = [
  { href: '/financeiro', label: 'Visão geral', permission: 'finance.reports' },
  { href: '/financeiro/pagamentos', label: 'Pagamentos', permission: 'payments.read' },
  { href: '/financeiro/saques', label: 'Saques', permission: 'payouts.read' },
  { href: '/financeiro/carteiras', label: 'Carteiras', permission: 'payments.read' },
  { href: '/financeiro/comissoes', label: 'Comissões', permission: 'pricing.read' },
] as const;

/** Navegação entre as telas do financeiro (respeita as permissões do usuário). */
export function FinanceNav() {
  const pathname = usePathname();
  const { can } = useSession();
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border" aria-label="Financeiro">
      {ITEMS.filter((item) => can(item.permission)).map((item) => {
        const active = item.href === '/financeiro' ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              active ? 'border-brand-500 text-brand-600' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
