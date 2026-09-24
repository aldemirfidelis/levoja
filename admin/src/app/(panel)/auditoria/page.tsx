'use client';

import { Suspense, useState } from 'react';
import { FileClock } from 'lucide-react';
import { Paginated, useApi } from '@levoja/web-kit/client';
import { Button, Dialog, EmptyState, ErrorState, formatDateTime, Input, PageHeader, Pagination, SkeletonRows } from '@levoja/web-kit/ui';
import { useUrlFilters } from '@/components/list-filters';
import type { AuditEntry } from '@/lib/types';

function Json({ value }: { value: unknown }) {
  if (value == null) return <span className="text-muted">—</span>;
  return <pre className="max-h-64 overflow-auto rounded-lg bg-surface-2 p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

function AuditList() {
  const [filters, setFilters] = useUrlFilters({ action: '', entityType: '', entityId: '', actorId: '', from: '', to: '', page: '1' });
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const { data, error, isLoading, refetch } = useApi<Paginated<AuditEntry>>('admin/audit-logs', {
    ...filters,
    from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : undefined,
    to: filters.to ? new Date(`${filters.to}T23:59:59`).toISOString() : undefined,
    pageSize: 50,
  });

  return (
    <>
      <PageHeader title="Auditoria" description="Registro imutável das operações críticas: quem, quando, de onde, o que mudou." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Input label="Ação (prefixo)" placeholder="ex.: company." value={filters.action} onChange={(e) => setFilters({ action: e.target.value })} />
        <Input label="Entidade" placeholder="ex.: Company" value={filters.entityType} onChange={(e) => setFilters({ entityType: e.target.value })} />
        <Input label="ID do registro" value={filters.entityId} onChange={(e) => setFilters({ entityId: e.target.value })} />
        <Input label="De" type="date" value={filters.from} onChange={(e) => setFilters({ from: e.target.value })} />
        <Input label="Até" type="date" value={filters.to} onChange={(e) => setFilters({ to: e.target.value })} />
      </div>
      {filters.actorId && (
        <p className="mb-4 text-sm text-muted">
          Filtrando por usuário {filters.actorId}.{' '}
          <button className="text-brand-600 hover:underline" onClick={() => setFilters({ actorId: '' })}>
            Remover filtro
          </button>
        </p>
      )}

      {isLoading && <SkeletonRows rows={10} />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && data.data.length === 0 && <EmptyState icon={<FileClock className="h-8 w-8" />} title="Nenhum registro encontrado" />}
      {data && data.data.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-2 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Quando</th>
                  <th className="px-4 py-3 font-medium">Ação</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Usuário</th>
                  <th className="hidden px-4 py-3 font-medium lg:table-cell">Registro</th>
                  <th className="hidden px-4 py-3 font-medium lg:table-cell">IP</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.data.map((entry) => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">{formatDateTime(entry.createdAt)}</td>
                    <td className="px-4 py-2.5">
                      <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{entry.action}</code>
                    </td>
                    <td className="hidden px-4 py-2.5 md:table-cell">{entry.actor?.name ?? <span className="text-muted">sistema/anônimo</span>}</td>
                    <td className="hidden max-w-56 truncate px-4 py-2.5 text-xs text-muted lg:table-cell">
                      {entry.entityType ? `${entry.entityType} ${entry.entityId?.slice(0, 8) ?? ''}` : '—'}
                    </td>
                    <td className="hidden px-4 py-2.5 text-xs text-muted lg:table-cell">{entry.ip ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setSelected(entry)}>
                        Detalhes
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={(page) => setFilters({ page: String(page) })} />
        </>
      )}

      <Dialog open={!!selected} onClose={() => setSelected(null)} title={selected?.action ?? ''} size="lg">
        {selected && (
          <div className="space-y-4 text-sm">
            <p className="text-muted">
              {formatDateTime(selected.createdAt)} · {selected.actor ? `${selected.actor.name} (${selected.actor.email})` : 'sistema/anônimo'} · IP {selected.ip ?? '—'}
            </p>
            <p>
              Registro: <code>{selected.entityType ?? '—'}</code> <code className="text-xs">{selected.entityId}</code>
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1 font-medium">Valor anterior</p>
                <Json value={selected.before} />
              </div>
              <div>
                <p className="mb-1 font-medium">Valor novo</p>
                <Json value={selected.after} />
              </div>
            </div>
            {selected.metadata && (
              <div>
                <p className="mb-1 font-medium">Metadados</p>
                <Json value={selected.metadata} />
              </div>
            )}
            <p className="text-xs text-muted">ID da requisição: {selected.requestId ?? '—'}</p>
          </div>
        )}
      </Dialog>
    </>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <AuditList />
    </Suspense>
  );
}
