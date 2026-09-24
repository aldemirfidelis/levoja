'use client';

import { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { Bike } from 'lucide-react';
import { PARTNER_STATUS_LABELS, PARTNER_STATUSES, VEHICLE_TYPE_LABELS, VEHICLE_TYPES } from '@levoja/shared';
import { Paginated, useApi } from '@levoja/web-kit/client';
import {
  Badge,
  DataTable,
  EmptyState,
  ErrorState,
  formatDateTime,
  formatPhone,
  PageHeader,
  Pagination,
  PartnerStatusBadge,
  Select,
  SkeletonRows,
} from '@levoja/web-kit/ui';
import { SearchInput, useUrlFilters } from '@/components/list-filters';
import type { DriverListItem } from '@/lib/types';

function DriversList() {
  const router = useRouter();
  const [filters, setFilters] = useUrlFilters({ status: '', vehicleType: '', search: '', page: '1' });
  const { data, error, isLoading, refetch } = useApi<Paginated<DriverListItem>>('admin/drivers', { ...filters, pageSize: 20 });

  return (
    <>
      <PageHeader title="Entregadores" description="Aprovação de cadastro, documentos, veículos e gestão da rede de entregadores." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Buscar por nome, e-mail ou telefone" />
        <Select
          className="sm:w-52"
          value={filters.status}
          onChange={(event) => setFilters({ status: event.target.value })}
          placeholder="Todos os status"
          options={PARTNER_STATUSES.map((status) => ({ value: status, label: PARTNER_STATUS_LABELS[status] }))}
          aria-label="Filtrar por status"
        />
        <Select
          className="sm:w-44"
          value={filters.vehicleType}
          onChange={(event) => setFilters({ vehicleType: event.target.value })}
          placeholder="Todos os veículos"
          options={VEHICLE_TYPES.map((type) => ({ value: type, label: VEHICLE_TYPE_LABELS[type] }))}
          aria-label="Filtrar por veículo"
        />
      </div>

      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && data.data.length === 0 && <EmptyState icon={<Bike className="h-8 w-8" />} title="Nenhum entregador encontrado" />}
      {data && data.data.length > 0 && (
        <>
          <DataTable
            rows={data.data}
            rowKey={(row) => row.id}
            onRowClick={(row) => router.push(`/entregadores/${row.id}`)}
            columns={[
              {
                key: 'name',
                header: 'Entregador',
                cell: (row) => (
                  <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{row.user.name}</p>
                    <p className="truncate text-xs text-muted">{formatPhone(row.user.phone)}</p>
                  </div>
                ),
              },
              {
                key: 'vehicle',
                header: 'Veículo',
                hideOnMobile: true,
                cell: (row) =>
                  row.activeVehicle ? (
                    <span>
                      {VEHICLE_TYPE_LABELS[row.activeVehicle.type]}
                      {row.activeVehicle.plate && <span className="ml-1 text-xs text-muted">{row.activeVehicle.plate}</span>}
                    </span>
                  ) : (
                    '—'
                  ),
              },
              { key: 'city', header: 'Cidade', hideOnMobile: true, cell: (row) => (row.address ? `${row.address.city}/${row.address.state}` : '—') },
              {
                key: 'status',
                header: 'Status',
                cell: (row) => (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <PartnerStatusBadge status={row.status} />
                    {row.fleetType === 'COMPANY' && <Badge tone="brand">Frota própria</Badge>}
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

export default function DriversPage() {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <DriversList />
    </Suspense>
  );
}
