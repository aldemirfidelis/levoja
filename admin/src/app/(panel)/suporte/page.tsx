'use client';

import { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { LifeBuoy } from 'lucide-react';
import { TICKET_CATEGORIES, TICKET_CATEGORY_LABELS, TICKET_PRIORITIES, TICKET_PRIORITY_LABELS, TICKET_STATUSES, TICKET_STATUS_STAFF_LABELS } from '@levoja/shared';
import { Paginated, useApi, useRealtime } from '@levoja/web-kit/client';
import { Checkbox, DataTable, EmptyState, ErrorState, formatDateTime, PageHeader, Pagination, Select, SkeletonRows, StatCard } from '@levoja/web-kit/ui';
import { SearchInput, useUrlFilters } from '@/components/list-filters';
import { PriorityBadge, SlaIndicator, TicketStatusBadge } from '@/components/support-badges';
import type { TicketListItem, TicketStats } from '@/lib/types';

const minutes = (value: number | null) => {
  if (value == null) return '—';
  if (value < 120) return `${value} min`;
  return `${(value / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
};

function SupportQueue() {
  const router = useRouter();
  const [filters, setFilters] = useUrlFilters({ status: 'ACTIVE', priority: '', category: '', assignee: '', breached: '', search: '', page: '1' });
  const { data, error, isLoading, refetch } = useApi<Paginated<TicketListItem>>('admin/support/tickets', { ...filters, pageSize: 25 }, { refetchInterval: 30_000 });
  const { data: stats, refetch: refetchStats } = useApi<TicketStats>('admin/support/tickets/stats', undefined, { refetchInterval: 60_000 });
  useRealtime({
    'support.ticket.created': () => {
      void refetch();
      void refetchStats();
    },
    'support.ticket.updated': () => void refetch(),
    'support.sla.breached': () => {
      void refetch();
      void refetchStats();
    },
  });

  const active = (stats?.byStatus.OPEN ?? 0) + (stats?.byStatus.IN_PROGRESS ?? 0) + (stats?.byStatus.WAITING_REQUESTER ?? 0);
  return (
    <>
      <PageHeader title="Central de atendimento" description="Chamados de clientes, entregadores e empresas, ordenados pelo prazo de resolução." />
      {stats && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Em aberto" value={active} hint={`${stats.unassigned} sem responsável · ${stats.mine} comigo`} />
          <StatCard label="SLA estourado" value={stats.breachedOpen} tone={stats.breachedOpen ? 'danger' : 'success'} hint="Chamados em aberto fora do prazo" />
          <StatCard
            label="Cumprimento de SLA (30 dias)"
            value={stats.last30Days.slaCompliance == null ? '—' : `${stats.last30Days.slaCompliance.toLocaleString('pt-BR')}%`}
            hint={`1ª resposta em ${minutes(stats.last30Days.avgFirstResponseMinutes)} · resolução em ${minutes(stats.last30Days.avgResolutionMinutes)}`}
          />
          <StatCard label="Satisfação (30 dias)" value={stats.last30Days.csat == null ? '—' : `${stats.last30Days.csat.toLocaleString('pt-BR')} / 5`} hint={`${stats.last30Days.ratings} avaliação(ões)`} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Número ou assunto" />
        <Select
          aria-label="Situação"
          className="w-48"
          value={filters.status}
          onChange={(event) => setFilters({ status: event.target.value })}
          options={[{ value: 'ACTIVE', label: 'Em aberto' }, { value: '', label: 'Todas as situações' }, ...TICKET_STATUSES.map((status) => ({ value: status, label: TICKET_STATUS_STAFF_LABELS[status] }))]}
        />
        <Select
          aria-label="Prioridade"
          className="w-40"
          value={filters.priority}
          onChange={(event) => setFilters({ priority: event.target.value })}
          options={[{ value: '', label: 'Toda prioridade' }, ...TICKET_PRIORITIES.map((priority) => ({ value: priority, label: TICKET_PRIORITY_LABELS[priority] }))]}
        />
        <Select
          aria-label="Categoria"
          className="w-44"
          value={filters.category}
          onChange={(event) => setFilters({ category: event.target.value })}
          options={[{ value: '', label: 'Toda categoria' }, ...TICKET_CATEGORIES.map((category) => ({ value: category, label: TICKET_CATEGORY_LABELS[category] }))]}
        />
        <Select
          aria-label="Responsável"
          className="w-44"
          value={filters.assignee}
          onChange={(event) => setFilters({ assignee: event.target.value })}
          options={[
            { value: '', label: 'Qualquer responsável' },
            { value: 'me', label: 'Comigo' },
            { value: 'none', label: 'Sem responsável' },
          ]}
        />
        <Checkbox label="Só SLA estourado" checked={filters.breached === 'true'} onChange={(event) => setFilters({ breached: event.target.checked ? 'true' : '' })} className="pb-2" />
      </div>

      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.data.length === 0 && <EmptyState icon={<LifeBuoy className="h-8 w-8" />} title="Nenhum chamado" description="Nada na fila com esses filtros." />}
      {data && data.data.length > 0 && (
        <>
          <DataTable
            rows={data.data}
            rowKey={(row) => row.id}
            onRowClick={(row) => router.push(`/suporte/${row.id}`)}
            columns={[
              {
                key: 'subject',
                header: 'Chamado',
                cell: (row) => (
                  <div className="min-w-0">
                    <p className="truncate font-medium text-fg">
                      #{row.number} · {row.subject}
                    </p>
                    <p className="text-xs text-muted">
                      {row.requesterName} · {TICKET_CATEGORY_LABELS[row.category as keyof typeof TICKET_CATEGORY_LABELS] ?? row.category}
                    </p>
                  </div>
                ),
              },
              { key: 'priority', header: 'Prioridade', cell: (row) => <PriorityBadge priority={row.priority} /> },
              { key: 'status', header: 'Situação', cell: (row) => <TicketStatusBadge status={row.status} />, hideOnMobile: true },
              { key: 'sla', header: 'SLA', cell: (row) => <SlaIndicator state={row.sla.state} dueAt={row.sla.dueAt} /> },
              { key: 'assignee', header: 'Responsável', cell: (row) => row.assignee ?? <span className="text-muted">—</span>, hideOnMobile: true },
              { key: 'updated', header: 'Atualizado', cell: (row) => formatDateTime(row.updatedAt), hideOnMobile: true },
            ]}
          />
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={(page) => setFilters({ page: String(page) })} />
        </>
      )}
    </>
  );
}

export default function SupportPage() {
  return (
    <Suspense>
      <SupportQueue />
    </Suspense>
  );
}
