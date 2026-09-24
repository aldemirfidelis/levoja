'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { Radar } from 'lucide-react';
import { RISK_SIGNAL_LABELS, RISK_SIGNAL_TYPES } from '@levoja/shared';
import { Paginated, useApi } from '@levoja/web-kit/client';
import { EmptyState, ErrorState, formatDateTime, PageHeader, Pagination, Select, SkeletonRows } from '@levoja/web-kit/ui';
import { FraudNav } from '@/components/intelligence-nav';
import { useUrlFilters } from '@/components/list-filters';
import { RiskSignalRow, SignalRefs } from '@/components/risk-subject';

type SignalRow = RiskSignalRow & { user: { id: string; name: string; email: string } | null };

function SignalsView() {
  const [filters, setFilters] = useUrlFilters({ type: '', page: '1' });
  const { data, error, isLoading, refetch } = useApi<Paginated<SignalRow>>('admin/intelligence/fraud/signals', { ...filters, pageSize: 30 }, { refetchInterval: 60_000 });
  return (
    <>
      <PageHeader title="Antifraude" description="Todos os indícios registrados, com a evidência de cada um. Cada sinal soma pontos ao score da conta." />
      <FraudNav />
      <Select
        aria-label="Tipo de sinal"
        className="mb-4 sm:w-72"
        value={filters.type}
        onChange={(event) => setFilters({ type: event.target.value })}
        options={[{ value: '', label: 'Todos os tipos' }, ...RISK_SIGNAL_TYPES.map((type) => ({ value: type, label: RISK_SIGNAL_LABELS[type] }))]}
      />
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.data.length === 0 && <EmptyState icon={<Radar className="h-8 w-8" />} title="Nenhum sinal" />}
      <ol className="space-y-3">
        {data?.data.map((signal) => (
          <li key={signal.id} className="rounded-xl border border-border bg-surface p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-fg">
                {RISK_SIGNAL_LABELS[signal.type]} ·{' '}
                {signal.user ? (
                  <Link href={`/antifraude/contas/${signal.user.id}`} className="text-brand-600 hover:underline">
                    {signal.user.name}
                  </Link>
                ) : (
                  'conta removida'
                )}
              </p>
              <span className="text-xs text-muted">
                +{signal.points} pts · {formatDateTime(signal.createdAt)}
              </span>
            </div>
            <p className="mt-1 text-fg">{signal.message}</p>
            <SignalRefs signal={signal} />
          </li>
        ))}
      </ol>
      {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={(page) => setFilters({ page: String(page) })} />}
    </>
  );
}

export default function FraudSignalsPage() {
  return (
    <Suspense>
      <SignalsView />
    </Suspense>
  );
}
