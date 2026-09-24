'use client';

import { Suspense, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { formatBRL, ORDER_STATUS_LABELS, ORDER_STATUSES, OrderStatus, PAYMENT_METHOD_LABELS, PaymentMethod } from '@levoja/shared';
import { api, Paginated, useApi } from '@levoja/web-kit/client';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  formatDateTime,
  PageHeader,
  Pagination,
  Select,
  SkeletonRows,
  Tone,
  useToast,
} from '@levoja/web-kit/ui';
import { SearchInput, useUrlFilters } from '@/components/list-filters';
import { useSession } from '@/lib/session';

interface AdminOrder {
  id: string;
  number: number;
  status: OrderStatus;
  fulfillment: 'DELIVERY' | 'PICKUP';
  company: { id: string; tradeName: string };
  customer: { id: string; name: string };
  items: { id: string; name: string; quantity: number; totalCents: number }[];
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  tipCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod;
  paymentStatus: string;
  distanceKm: number | null;
  cancelReason: string | null;
  canceledBy: string | null;
  timeline: { status: OrderStatus; at: string; actorType: string; reason: string | null }[];
  createdAt: string;
}

const ORDER_TONE: Record<OrderStatus, Tone> = {
  PENDING_PAYMENT: 'neutral',
  NEW: 'warning',
  CONFIRMED: 'info',
  PREPARING: 'info',
  READY_FOR_PICKUP: 'brand',
  DRIVER_ASSIGNED: 'brand',
  PICKED_UP: 'brand',
  IN_TRANSIT: 'brand',
  DELIVERED: 'success',
  CANCELED: 'danger',
};

const ACTORS: Record<string, string> = { CUSTOMER: 'cliente', COMPANY: 'loja', DRIVER: 'entregador', PLATFORM: 'plataforma', SYSTEM: 'sistema' };

function OrderDetail({ order, onClose, onChanged }: { order: AdminOrder; onClose: () => void; onChanged: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const [canceling, setCanceling] = useState(false);
  const final = ['DELIVERED', 'CANCELED'].includes(order.status);
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`Pedido #${order.number}`}
      description={`${order.company.tradeName} · ${order.customer.name}`}
      footer={
        can('orders.manage') &&
        !final && (
          <Button variant="danger" onClick={() => setCanceling(true)}>
            Cancelar pedido
          </Button>
        )
      }
    >
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge tone={ORDER_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
          <Badge>{order.fulfillment === 'PICKUP' ? 'Retirada' : `Entrega${order.distanceKm ? ` · ${order.distanceKm} km` : ''}`}</Badge>
          <Badge>{PAYMENT_METHOD_LABELS[order.paymentMethod]}</Badge>
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {order.items.map((item) => (
            <li key={item.id} className="flex justify-between p-3">
              <span>
                {item.quantity}× {item.name}
              </span>
              <span className="tabular-nums">{formatBRL(item.totalCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="grid grid-cols-2 gap-1">
          <dt className="text-muted">Produtos</dt>
          <dd className="text-right tabular-nums">{formatBRL(order.subtotalCents)}</dd>
          <dt className="text-muted">Entrega</dt>
          <dd className="text-right tabular-nums">{formatBRL(order.deliveryFeeCents)}</dd>
          <dt className="text-muted">Taxa de serviço</dt>
          <dd className="text-right tabular-nums">{formatBRL(order.serviceFeeCents)}</dd>
          <dt className="text-muted">Gorjeta</dt>
          <dd className="text-right tabular-nums">{formatBRL(order.tipCents)}</dd>
          <dt className="font-semibold">Total</dt>
          <dd className="text-right font-semibold tabular-nums">{formatBRL(order.totalCents)}</dd>
        </dl>
        <ol className="relative space-y-2 border-l border-border pl-4">
          {order.timeline.map((entry, index) => (
            <li key={index}>
              <p className="font-medium">{ORDER_STATUS_LABELS[entry.status]}</p>
              <p className="text-xs text-muted">
                {formatDateTime(entry.at)} · por {ACTORS[entry.actorType] ?? entry.actorType}
                {entry.reason ? ` — ${entry.reason}` : ''}
              </p>
            </li>
          ))}
        </ol>
      </div>
      {canceling && (
        <ConfirmDialog
          open
          onClose={() => setCanceling(false)}
          onConfirm={async (reason) => {
            await api.post(`admin/orders/${order.id}/cancel`, { reason });
            toast.success('Pedido cancelado pela plataforma.');
            onChanged();
            onClose();
          }}
          title={`Cancelar pedido #${order.number}`}
          description="Cliente e loja serão notificados; o estoque é devolvido."
          confirmLabel="Cancelar pedido"
          tone="danger"
          reason={{ label: 'Motivo', required: true }}
        />
      )}
    </Dialog>
  );
}

function OrdersList() {
  const [filters, setFilters] = useUrlFilters({ status: '', scope: '', search: '', page: '1' });
  const [selected, setSelected] = useState<AdminOrder | null>(null);
  const { data, error, isLoading, refetch } = useApi<Paginated<AdminOrder>>('admin/orders', { ...filters, pageSize: 25 }, { refetchInterval: 30_000 });

  return (
    <>
      <PageHeader title="Pedidos" description="Acompanhamento de todos os pedidos da plataforma (atualiza a cada 30 s)." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Número do pedido" />
        <Select
          className="sm:w-48"
          aria-label="Situação"
          value={filters.scope}
          placeholder="Todos"
          options={[
            { value: 'active', label: 'Em andamento' },
            { value: 'finished', label: 'Finalizados' },
          ]}
          onChange={(e) => setFilters({ scope: e.target.value })}
        />
        <Select
          className="sm:w-56"
          aria-label="Status"
          value={filters.status}
          placeholder="Qualquer status"
          options={ORDER_STATUSES.map((status) => ({ value: status, label: ORDER_STATUS_LABELS[status] }))}
          onChange={(e) => setFilters({ status: e.target.value })}
        />
      </div>
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.data.length === 0 && <EmptyState icon={<ShoppingBag className="h-8 w-8" />} title="Nenhum pedido encontrado" />}
      {!!data?.data.length && (
        <>
          <DataTable
            rows={data.data}
            rowKey={(row) => row.id}
            onRowClick={setSelected}
            columns={[
              { key: 'number', header: 'Pedido', cell: (row) => <span className="font-semibold">#{row.number}</span> },
              { key: 'company', header: 'Loja', cell: (row) => row.company.tradeName },
              { key: 'customer', header: 'Cliente', hideOnMobile: true, cell: (row) => row.customer.name },
              { key: 'status', header: 'Status', cell: (row) => <Badge tone={ORDER_TONE[row.status]}>{ORDER_STATUS_LABELS[row.status]}</Badge> },
              { key: 'total', header: 'Total', className: 'text-right', cell: (row) => formatBRL(row.totalCents) },
              { key: 'date', header: 'Criado em', hideOnMobile: true, cell: (row) => formatDateTime(row.createdAt) },
            ]}
          />
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={(page) => setFilters({ page: String(page) })} />
        </>
      )}
      {selected && <OrderDetail order={selected} onClose={() => setSelected(null)} onChanged={() => refetch()} />}
    </>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <OrdersList />
    </Suspense>
  );
}
