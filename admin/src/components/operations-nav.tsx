'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@levoja/web-kit/ui';

const ITEMS = [
  { href: '/operacao', label: 'Torre de controle' },
  { href: '/operacao/mapa-de-calor', label: 'Mapa de calor' },
] as const;

export function OperationsNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border" aria-label="Operação">
      {ITEMS.map((item) => {
        const active = pathname === item.href;
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

/** Filtro de cidade compartilhado pelas telas de operação. */
export interface CityOption {
  city: string;
  state: string | null;
  deliveries: number;
}
