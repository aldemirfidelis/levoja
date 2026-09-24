'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@levoja/web-kit/ui';
import { useSession } from '@/lib/session';

function SectionNav({ items, label, isActive }: { items: readonly { href: string; label: string; permission: string }[]; label: string; isActive: (href: string) => boolean }) {
  const { can } = useSession();
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border" aria-label={label}>
      {items
        .filter((item) => can(item.permission))
        .map((item) => {
          const active = isActive(item.href);
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

const FRAUD_ITEMS = [
  { href: '/antifraude', label: 'Casos', permission: 'fraud.read' },
  { href: '/antifraude/sinais', label: 'Sinais', permission: 'fraud.read' },
  { href: '/antifraude/regras', label: 'Regras e score', permission: 'fraud.read' },
] as const;

export function FraudNav() {
  const pathname = usePathname();
  return (
    <SectionNav
      items={FRAUD_ITEMS}
      label="Antifraude"
      isActive={(href) => (href === '/antifraude' ? pathname === '/antifraude' || pathname.startsWith('/antifraude/casos') || pathname.startsWith('/antifraude/contas') : pathname.startsWith(href))}
    />
  );
}

const INTELLIGENCE_ITEMS = [
  { href: '/inteligencia', label: 'Previsão de demanda', permission: 'operations.view' },
  { href: '/inteligencia/anomalias', label: 'Anomalias', permission: 'operations.view' },
  { href: '/inteligencia/tempo-de-entrega', label: 'Tempo de entrega', permission: 'operations.view' },
  { href: '/inteligencia/precos', label: 'Preço dinâmico', permission: 'pricing.read' },
  { href: '/inteligencia/avaliacoes', label: 'Avaliações', permission: 'reviews.moderate' },
  { href: '/inteligencia/ia', label: 'IA assistiva', permission: 'settings.manage' },
] as const;

export function IntelligenceNav() {
  const pathname = usePathname();
  return <SectionNav items={INTELLIGENCE_ITEMS} label="Inteligência" isActive={(href) => (href === '/inteligencia' ? pathname === '/inteligencia' : pathname.startsWith(href))} />;
}

export const RISK_LEVEL_TONE = { LOW: 'neutral', MEDIUM: 'warning', HIGH: 'danger' } as const;
export const RISK_CASE_TONE = { OPEN: 'warning', IN_REVIEW: 'info', DISMISSED: 'neutral', CONFIRMED: 'danger' } as const;
export const ANOMALY_TONE = { OPEN: 'danger', ACKNOWLEDGED: 'warning', RESOLVED: 'neutral' } as const;
export const SENTIMENT_TONE = { POSITIVE: 'success', NEUTRAL: 'neutral', NEGATIVE: 'danger' } as const;

/** Cidade normalizada ("sao paulo/sp") → rótulo legível quando não há o nome original. */
export function cityLabel(key: string | null | undefined, cities?: { key: string; label: string }[]) {
  if (!key) return 'Todas as cidades';
  const known = cities?.find((city) => city.key === key);
  if (known) return known.label;
  const [city, state] = key.split('/');
  return `${city.replace(/\b\w/g, (letter) => letter.toUpperCase())}${state ? `/${state.toUpperCase()}` : ''}`;
}

export const percent = (value: number | null | undefined, digits = 0) => (value == null ? '—' : `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: digits })}%`);
export const bpsLabel = (bps: number) => `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
