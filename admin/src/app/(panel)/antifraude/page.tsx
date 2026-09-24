'use client';

import { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { RISK_CASE_STATUS_LABELS, RISK_LEVEL_LABELS, RISK_SIGNAL_LABELS, type RiskCaseStatus, type RiskLevel, type RiskSignalType } from '@levoja/shared';
import { Paginated, useApi } from '@levoja/web-kit/client';
import { Badge, BarList, Card, DataTable, EmptyState, ErrorState, formatDateTime, PageHeader, Pagination, Select, SkeletonRows, StatCard } from '@levoja/web-kit/ui';
import { FraudNav, RISK_CASE_TONE, RISK_LEVEL_TONE } from '@/components/intelligence-nav';
import { SearchInput, useUrlFilters } from '@/components/list-filters';

interface CaseRow {
  id: string;
  number: number;
  status: RiskCaseStatus;
  level: RiskLevel;
  score: number;
  summary: string;
  signals: number;
  createdAt: string;
  updatedAt: string;
  user: { id: string; name: string; email: string; customerId: string | null; driverId: string | null } | null;
}

interface Overview {
  cases: Partial<Record<RiskCaseStatus, number>>;
  openByLevel: Partial<Record<RiskLevel, number>>;
  signalsLast7Days: { type: RiskSignalType; count: number }[];
}

function CasesView() {
  const router = useRouter();
  const [filters, setFilters] = useUrlFilters({ status: '', level: '', search: '', page: '1' });
  const overview = useApi<Overview>('admin/intelligence/fraud/overview');
  const { data, error, isLoading, refetch } = useApi<Paginated<CaseRow>>('admin/intelligence/fraud/cases', { ...filters, pageSize: 25 }, { refetchInterval: 60_000 });
  const open = (overview.data?.cases.OPEN ?? 0) + (overview.data?.cases.IN_REVIEW ?? 0);

  return (
    <>
      <PageHeader
        title="Antifraude"
        description="Casos abertos quando o score de risco passa do limite. Nada é bloqueado automaticamente: a equipe analisa as evidências e decide."
      />
      <FraudNav />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Casos para revisar" value={open} hint={`${overview.data?.cases.IN_REVIEW ?? 0} em análise`} tone={open ? 'warning' : 'neutral'} />
        <StatCard label="Risco alto em aberto" value={overview.data?.openByLevel.HIGH ?? 0} tone={overview.data?.openByLevel.HIGH ? 'danger' : 'neutral'} />
        <StatCard label="Fraudes confirmadas" value={overview.data?.cases.CONFIRMED ?? 0} />
        <StatCard label="Descartados (falso positivo)" value={overview.data?.cases.DISMISSED ?? 0} />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <div className="mb-4 flex flex-wrap gap-3">
            <SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Nome, e-mail ou nº do caso" />
            <Select
              aria-label="Situação"
              className="w-48"
              value={filters.status}
              onChange={(event) => setFilters({ status: event.target.value })}
              options={[{ value: '', label: 'Abertos e em análise' }, ...Object.entries(RISK_CASE_STATUS_LABELS).map(([value, label]) => ({ value, label }))]}
            />
            <Select
              aria-label="Nível"
              className="w-40"
              value={filters.level}
              onChange={(event) => setFilters({ level: event.target.value })}
              options={[{ value: '', label: 'Todos os níveis' }, ...Object.entries(RISK_LEVEL_LABELS).map(([value, label]) => ({ value, label: `Risco ${label.toLowerCase()}` }))]}
            />
          </div>
          {isLoading && <SkeletonRows />}
          {error && <ErrorState error={error} onRetry={() => refetch()} />}
          {data?.data.length === 0 && <EmptyState icon={<ShieldAlert className="h-8 w-8" />} title="Nenhum caso" description="Quando uma conta acumular sinais acima do limite configurado, o caso aparece aqui." />}
          {data && data.data.length > 0 && (
            <>
              <DataTable
                rows={data.data}
                rowKey={(row) => row.id}
                onRowClick={(row) => router.push(`/antifraude/casos/${row.id}`)}
                columns={[
                  {
                    key: 'case',
                    header: 'Caso',
                    cell: (row) => (
                      <div>
                        <p className="font-medium">
                          #{row.number} · {row.user?.name ?? 'Conta removida'}
                        </p>
                        <p className="max-w-md truncate text-xs text-muted">{row.summary}</p>
                      </div>
                    ),
                  },
                  { key: 'score', header: 'Score', className: 'text-right tabular-nums', cell: (row) => row.score },
                  { key: 'level', header: 'Nível', cell: (row) => <Badge tone={RISK_LEVEL_TONE[row.level]}>{RISK_LEVEL_LABELS[row.level]}</Badge> },
                  { key: 'signals', header: 'Sinais', className: 'text-right tabular-nums', cell: (row) => row.signals, hideOnMobile: true },
                  { key: 'status', header: 'Situação', cell: (row) => <Badge tone={RISK_CASE_TONE[row.status]}>{RISK_CASE_STATUS_LABELS[row.status]}</Badge> },
                  { key: 'created', header: 'Aberto em', cell: (row) => formatDateTime(row.createdAt), hideOnMobile: true },
                ]}
              />
              <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={(page) => setFilters({ page: String(page) })} />
            </>
          )}
        </div>
        <Card title="Sinais nos últimos 7 dias">
          {overview.data && overview.data.signalsLast7Days.length > 0 ? (
            <BarList
              title="Sinais de risco por tipo nos últimos 7 dias"
              format={(value) => value.toLocaleString('pt-BR')}
              rows={overview.data.signalsLast7Days.map((row) => ({ label: RISK_SIGNAL_LABELS[row.type], value: row.count }))}
            />
          ) : (
            <p className="text-sm text-muted">Nenhum sinal registrado.</p>
          )}
        </Card>
      </div>
    </>
  );
}

export default function FraudCasesPage() {
  return (
    <Suspense>
      <CasesView />
    </Suspense>
  );
}
