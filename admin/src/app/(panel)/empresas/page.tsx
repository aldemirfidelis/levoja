'use client';

import { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { PARTNER_STATUS_LABELS, PARTNER_STATUSES } from '@levoja/shared';
import { Paginated, useApi } from '@levoja/web-kit/client';
import {
  Badge,
  DataTable,
  EmptyState,
  ErrorState,
  formatDateTime,
  PageHeader,
  Pagination,
  PartnerStatusBadge,
  Select,
  SkeletonRows,
} from '@levoja/web-kit/ui';
import { SearchInput, useUrlFilters } from '@/components/list-filters';
import type { CompanyListItem } from '@/lib/types';

function CompaniesList() {
  const router = useRouter();
  const [filters, setFilters] = useUrlFilters({ status: '', search: '', page: '1' });
  const { data, error, isLoading, refetch } = useApi<Paginated<CompanyListItem>>('admin/companies', {
    status: filters.status,
    search: filters.search,
    page: filters.page,
    pageSize: 20,
  });

  return (
    <>
      <PageHeader title="Empresas" description="Cadastro, análise documental e gestão de estabelecimentos. Os mais antigos na fila aparecem primeiro." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Buscar por nome, CNPJ ou e-mail" />
        <Select
          className="sm:w-56"
          value={filters.status}
          onChange={(event) => setFilters({ status: event.target.value })}
          placeholder="Todos os status"
          options={PARTNER_STATUSES.map((status) => ({ value: status, label: PARTNER_STATUS_LABELS[status] }))}
          aria-label="Filtrar por status"
        />
      </div>

      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && data.data.length === 0 && (
        <EmptyState icon={<Building2 className="h-8 w-8" />} title="Nenhuma empresa encontrada" description="Ajuste os filtros ou aguarde novos cadastros." />
      )}
      {data && data.data.length > 0 && (
        <>
          <DataTable
            rows={data.data}
            rowKey={(row) => row.id}
            onRowClick={(row) => router.push(`/empresas/${row.id}`)}
            columns={[
              {
                key: 'name',
                header: 'Empresa',
                cell: (row) => (
                  <div className="flex items-center gap-3">
                    {row.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={row.logoUrl} alt="" className="h-9 w-9 rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-2 text-sm font-bold text-muted">{row.tradeName[0]}</div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium text-fg">{row.tradeName}</p>
                      <p className="truncate text-xs text-muted">{row.cnpj}</p>
                    </div>
                  </div>
                ),
              },
              {
                key: 'segment',
                header: 'Segmento',
                hideOnMobile: true,
                cell: (row) => (
                  <span className="flex items-center gap-2">
                    {row.segment.name}
                    {row.segment.isRegulated && <Badge tone="warning">Regulado</Badge>}
                  </span>
                ),
              },
              { key: 'city', header: 'Cidade', hideOnMobile: true, cell: (row) => (row.address ? `${row.address.city}/${row.address.state}` : '—') },
              {
                key: 'status',
                header: 'Status',
                cell: (row) => (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <PartnerStatusBadge status={row.status} />
                    {row.pendingDocuments > 0 && row.status === 'UNDER_REVIEW' && <Badge tone="info">{row.pendingDocuments} doc.</Badge>}
                  </div>
                ),
              },
              { key: 'submitted', header: 'Enviado em', hideOnMobile: true, cell: (row) => formatDateTime(row.submittedAt) },
            ]}
          />
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={(page) => setFilters({ page: String(page) })} />
        </>
      )}
    </>
  );
}

export default function CompaniesPage() {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <CompaniesList />
    </Suspense>
  );
}
