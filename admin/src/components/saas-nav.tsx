'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@levoja/web-kit/ui';

const ITEMS = [
  { href: '/planos', label: 'Planos' },
  { href: '/planos/assinaturas', label: 'Assinaturas' },
  { href: '/planos/cobrancas', label: 'Cobranças' },
] as const;

export function SaasNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border" aria-label="Planos SaaS">
      {ITEMS.map((item) => {
        const active = item.href === '/planos' ? pathname === '/planos' : pathname.startsWith(item.href);
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

export const SUBSCRIPTION_TONE = { TRIALING: 'info', ACTIVE: 'success', PAST_DUE: 'danger', CANCELED: 'neutral' } as const;
export const SUBSCRIPTION_INVOICE_TONE = { OPEN: 'warning', PAID: 'success', VOID: 'neutral' } as const;
export const CITY_TONE = { PREPARING: 'info', ACTIVE: 'success', PAUSED: 'warning' } as const;

/** Limite em texto ("sem limite" para null). */
export const limitLabel = (value: number | null | undefined) => (value == null ? 'Sem limite' : value.toLocaleString('pt-BR'));
