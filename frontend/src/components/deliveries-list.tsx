'use client';

import { useState } from 'react';
import { Truck } from 'lucide-react';
import { DELIVERY_STATUS_LABELS, DeliveryStatus, formatBRL } from '@levoja/shared';
import { Paginated, useApi } from '@levoja/web-kit/client';
import { Badge, DataTable, EmptyState, ErrorState, formatDateTime, Pagination, SkeletonRows, Tabs, Tone } from '@levoja/web-kit/ui';
import type { DeliveryView } from './delivery-types';

export const DELIVERY_TONE: Record<DeliveryStatus, Tone> = {
  PENDING: 'neutral',
  SCHEDULED: 'info',
  SEARCHING_DRIVER: 'warning',
  DRIVER_ASSIGNED: 'brand',
  AT_PICKUP: 'brand',
  PICKED_UP: 'brand',
  IN_TRANSIT: 'brand',
  AT_DROPOFF: 'brand',
  DELIVERED: 'success',
  FAILED: 'danger',
  CANCELED: 'danger',
};

export function DeliveriesList({ path, onOpen, emptyAction }: { path: string; onOpen: (delivery: DeliveryView) => void; emptyAction?: React.ReactNode }) {
  const [scope, setScope] = useState<'active' | 'finished'>('active');
  const [page, setPage] = useState(1);
  const { data, error, isLoading, refetch } = useApi<Paginated<DeliveryView>>(path, { scope, page, pageSize: 20 }, { refetchInterval: 20_000 });
  return (
    <>
      <Tabs
        value={scope}
        onChange={(value) => {
          setScope(value);
          setPage(1);
        }}
        items={[
          { value: 'active', label: 'Em andamento' },
          { value: 'finished', label: 'Finalizadas' },
        ]}
      />
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.data.length === 0 && <EmptyState icon={<Truck className="h-8 w-8" />} title="Nenhuma entrega" action={emptyAction} />}
      {!!data?.data.length && (
        <>
          <DataTable
            rows={data.data}
            rowKey={(row) => row.id}
            onRowClick={onOpen}
            columns={[
              { key: 'code', header: 'Entrega', cell: (row) => <span className="font-mono font-semibold">{row.code}</span> },
              { key: 'to', header: 'Destino', cell: (row) => `${row.dropoff.street}, ${row.dropoff.number}` },
              { key: 'status', header: 'Status', cell: (row) => <Badge tone={DELIVERY_TONE[row.status]}>{DELIVERY_STATUS_LABELS[row.status]}</Badge> },
              { key: 'kind', header: 'Tipo', hideOnMobile: true, cell: (row) => (row.order ? `Pedido #${row.order.number}` : 'Avulsa') },
              { key: 'fee', header: 'Valor', hideOnMobile: true, className: 'text-right', cell: (row) => formatBRL(row.feeCents + row.tipCents) },
              { key: 'date', header: 'Criada em', hideOnMobile: true, cell: (row) => formatDateTime(row.createdAt) },
            ]}
          />
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={setPage} />
        </>
      )}
    </>
  );
}
