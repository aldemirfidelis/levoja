'use client';

import { useMemo, useState } from 'react';
import { Bike, CalendarClock, FileText, ShieldAlert, Store, Wifi, WifiOff } from 'lucide-react';
import { DELIVERY_STATUS_LABELS, DeliveryStatus, formatBRL, ORDER_STATUS_LABELS, OrderStatus, PAYMENT_METHOD_LABELS } from '@levoja/shared';
import { api, Paginated, useApi, useRealtime } from '@levoja/web-kit/client';
import {
  Badge,
  Button,
  cn,
  ChatLauncher,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  formatDateTime,
  Input,
  Pagination,
  SkeletonRows,
  Tabs,
  useToast,
} from '@levoja/web-kit/ui';
import { useCompany } from '@/lib/company';
import type { CompanyOrderView } from '@/components/order-types';

const COLUMNS: { title: string; statuses: OrderStatus[] }[] = [
  { title: 'Novos', statuses: ['NEW'] },
  { title: 'Confirmados', statuses: ['CONFIRMED'] },
  { title: 'Em preparo', statuses: ['PREPARING'] },
  { title: 'Prontos', statuses: ['READY_FOR_PICKUP'] },
  { title: 'Em entrega', statuses: ['DRIVER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'] },
];

const NEXT_ACTION: Partial<Record<OrderStatus, { action: string; label: string }>> = {
  NEW: { action: 'confirm', label: 'Confirmar pedido' },
  CONFIRMED: { action: 'prepare', label: 'Iniciar preparo' },
  PREPARING: { action: 'ready', label: 'Marcar como pronto' },
};

/** Alerta sonoro curto para pedidos novos (Web Audio — sem arquivos externos). */
function beep() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.6);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.6);
  } catch {
    /* áudio indisponível */
  }
}

const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));

function OrderDetail({ order, onClose, onChanged }: { order: CompanyOrderView; onClose: () => void; onChanged: () => void }) {
  const { company, can } = useCompany();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [code, setCode] = useState('');
  const base = `companies/${company.id}/orders/${order.id}`;
  const next = NEXT_ACTION[order.status];
  const manage = can('company.orders.manage');
  const cancellable = !['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELED'].includes(order.status);

  const run = async (path: string, body?: unknown, message = 'Pedido atualizado.') => {
    setBusy(true);
    try {
      await api.post(`${base}/${path}`, body);
      toast.success(message);
      onChanged();
      onClose();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`Pedido #${order.number}`}
      description={`${ORDER_STATUS_LABELS[order.status]} · recebido ${formatDateTime(order.createdAt)}`}
      footer={
        manage && (
          <div className="flex w-full flex-wrap justify-between gap-2">
            {cancellable ? (
              <Button variant="ghost" className="text-danger" onClick={() => setCanceling(true)}>
                Cancelar pedido
              </Button>
            ) : (
              <span />
            )}
            {next && (
              <Button loading={busy} onClick={() => run(next.action)}>
                {next.label}
              </Button>
            )}
          </div>
        )
      }
    >
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge tone={order.fulfillment === 'PICKUP' ? 'info' : 'brand'}>{order.fulfillment === 'PICKUP' ? 'Retirada no balcão' : 'Entrega'}</Badge>
          {order.scheduledFor && <Badge tone="warning">Agendado para {formatDateTime(order.scheduledFor)}</Badge>}
          {order.requiresIdCheck && <Badge tone="danger">Conferir documento (idade mínima)</Badge>}
          {order.hasPrescription && <Badge tone="warning">Com receita</Badge>}
        </div>

        <ul className="divide-y divide-border rounded-lg border border-border">
          {order.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3 p-3">
              <div>
                <p className="font-medium">
                  {item.quantity}× {item.name}
                </p>
                {item.options?.length ? <p className="text-xs text-muted">{item.options.map((option) => option.option).join(', ')}</p> : null}
                {item.notes && <p className="text-xs text-warning">Obs.: {item.notes}</p>}
              </div>
              <span className="tabular-nums">{formatBRL(item.totalCents)}</span>
            </li>
          ))}
        </ul>

        <dl className="grid grid-cols-2 gap-2">
          <dt className="text-muted">Subtotal</dt>
          <dd className="text-right tabular-nums">{formatBRL(order.subtotalCents)}</dd>
          {order.deliveryFeeCents > 0 && (
            <>
              <dt className="text-muted">Entrega</dt>
              <dd className="text-right tabular-nums">{formatBRL(order.deliveryFeeCents)}</dd>
            </>
          )}
          <dt className="font-semibold">Total</dt>
          <dd className="text-right font-semibold tabular-nums">{formatBRL(order.totalCents)}</dd>
          <dt className="text-muted">Pagamento</dt>
          <dd className="text-right">
            {PAYMENT_METHOD_LABELS[order.paymentMethod]}
            {order.changeForCents ? ` (troco para ${formatBRL(order.changeForCents)})` : ''}
          </dd>
        </dl>

        {order.delivery && (
          <div className="rounded-lg border border-border p-3">
            <p className="font-medium">
              Entrega {order.delivery.code} · {DELIVERY_STATUS_LABELS[order.delivery.status as DeliveryStatus] ?? order.delivery.status}
            </p>
            {order.delivery.driver ? (
              <p className="text-muted">
                Entregador: {order.delivery.driver.name}
                {order.delivery.driver.vehicle && ` · ${order.delivery.driver.vehicle.model ?? ''} ${order.delivery.driver.vehicle.color ?? ''} ${order.delivery.driver.vehicle.plate ?? ''}`}
              </p>
            ) : (
              <p className="text-muted">{order.status === 'READY_FOR_PICKUP' ? 'Procurando entregador...' : 'O entregador será chamado quando o pedido estiver pronto.'}</p>
            )}
          </div>
        )}

        {/* Conversas com o cliente e com o entregador (sem expor telefones). */}
        <ChatLauncher orderId={order.id} deliveryId={order.delivery?.id} />

        <div className="rounded-lg bg-surface-2 p-3">
          <p className="font-medium">Cliente: {order.customer.firstName}</p>
          {order.deliveryAddress && (
            <p className="text-muted">
              {order.deliveryAddress.street}, {order.deliveryAddress.number}
              {order.deliveryAddress.complement ? ` - ${order.deliveryAddress.complement}` : ''} — {order.deliveryAddress.district}
            </p>
          )}
          {order.notes && <p className="mt-1">Obs. do pedido: {order.notes}</p>}
        </div>

        {order.hasPrescription && (
          <a href={api.fileUrl(`companies/${company.id}/orders/${order.id}/prescription`)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-brand-600 hover:underline">
            <FileText className="h-4 w-4" /> Ver receita
          </a>
        )}

        {manage && order.fulfillment === 'PICKUP' && order.status === 'READY_FOR_PICKUP' && (
          <div className="flex max-w-sm items-end gap-2">
            <Input label="Código informado pelo cliente" inputMode="numeric" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <Button disabled={code.length !== 4} loading={busy} onClick={() => run('handoff', { code }, 'Pedido entregue ao cliente.')}>
              Entregar
            </Button>
          </div>
        )}

        <ol className="space-y-1 text-xs text-muted">
          {order.timeline.map((entry, index) => (
            <li key={index}>
              {formatDateTime(entry.at)} — {ORDER_STATUS_LABELS[entry.status]}
              {entry.reason ? ` (${entry.reason})` : ''}
            </li>
          ))}
        </ol>
      </div>
      {canceling && (
        <ConfirmDialog
          open
          onClose={() => setCanceling(false)}
          onConfirm={(reason) => run('cancel', { reason }, 'Pedido cancelado.')}
          title={`Cancelar pedido #${order.number}?`}
          description="O cliente será notificado e o estoque dos itens será devolvido."
          confirmLabel="Cancelar pedido"
          tone="danger"
          reason={{ label: 'Motivo (o cliente verá esta mensagem)', required: true }}
        />
      )}
    </Dialog>
  );
}

function Board() {
  const { company } = useCompany();
  const toast = useToast();
  const { data, error, isLoading, refetch } = useApi<Paginated<CompanyOrderView>>(`companies/${company.id}/orders`, { scope: 'active', pageSize: 100 });
  const [selected, setSelected] = useState<CompanyOrderView | null>(null);
  const { connected } = useRealtime({
    'order.new': (payload: { number: number }) => {
      beep();
      toast.info(`Novo pedido #${payload.number}!`);
      void refetch();
    },
    'order.updated': () => void refetch(),
    'delivery.updated': () => void refetch(),
  });

  const byColumn = useMemo(() => COLUMNS.map((column) => ({ ...column, orders: (data?.data ?? []).filter((order) => column.statuses.includes(order.status)) })), [data]);

  if (isLoading) return <SkeletonRows rows={4} />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <>
      <p className={cn('mb-3 flex items-center gap-2 text-xs', connected ? 'text-success' : 'text-muted')}>
        {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
        {connected ? 'Recebendo pedidos em tempo real' : 'Conectando ao tempo real...'}
        {!company.isOpen && <Badge tone="warning">Loja pausada — novos pedidos bloqueados</Badge>}
      </p>
      <div className="grid gap-4 overflow-x-auto pb-2 md:grid-cols-5">
        {byColumn.map((column) => (
          <section key={column.title} className="min-w-56 rounded-xl bg-surface-2 p-3">
            <h2 className="mb-3 flex items-center justify-between text-sm font-semibold">
              {column.title}
              <span className="rounded-full bg-surface px-2 text-xs">{column.orders.length}</span>
            </h2>
            <div className="space-y-2">
              {column.orders.map((order) => {
                const waiting = minutesSince(order.createdAt);
                return (
                  <button
                    key={order.id}
                    onClick={() => setSelected(order)}
                    className={cn(
                      'w-full rounded-lg border bg-surface p-3 text-left text-sm shadow-sm transition hover:border-brand-400',
                      order.status === 'NEW' && waiting >= 5 ? 'border-danger' : 'border-border',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold">#{order.number}</span>
                      <span className={cn('text-xs', order.status === 'NEW' && waiting >= 5 ? 'font-semibold text-danger' : 'text-muted')}>há {waiting} min</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted">{order.items.map((item) => `${item.quantity}× ${item.name}`).join(', ')}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="flex items-center gap-1 text-xs text-muted">
                        {order.fulfillment === 'PICKUP' ? <Store className="h-3.5 w-3.5" /> : <Bike className="h-3.5 w-3.5" />}
                        {order.scheduledFor && <CalendarClock className="h-3.5 w-3.5 text-warning" />}
                        {order.requiresIdCheck && <ShieldAlert className="h-3.5 w-3.5 text-danger" />}
                      </span>
                      <span className="font-semibold tabular-nums">{formatBRL(order.totalCents)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {data?.data.length === 0 && <EmptyState title="Nenhum pedido em andamento" description="Novos pedidos aparecem aqui automaticamente, com alerta sonoro." />}
      {selected && <OrderDetail order={selected} onClose={() => setSelected(null)} onChanged={() => refetch()} />}
    </>
  );
}

function History() {
  const { company } = useCompany();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CompanyOrderView | null>(null);
  const { data, isLoading, refetch } = useApi<Paginated<CompanyOrderView>>(`companies/${company.id}/orders`, { scope: 'finished', page, pageSize: 20 });
  if (isLoading) return <SkeletonRows />;
  if (!data?.data.length) return <EmptyState title="Nenhum pedido finalizado" />;
  return (
    <>
      <DataTable
        rows={data.data}
        rowKey={(row) => row.id}
        onRowClick={setSelected}
        columns={[
          { key: 'number', header: 'Pedido', cell: (row) => <span className="font-semibold">#{row.number}</span> },
          { key: 'date', header: 'Data', cell: (row) => formatDateTime(row.createdAt) },
          { key: 'status', header: 'Status', cell: (row) => <Badge tone={row.status === 'DELIVERED' ? 'success' : 'danger'}>{ORDER_STATUS_LABELS[row.status]}</Badge> },
          { key: 'total', header: 'Total', className: 'text-right', cell: (row) => formatBRL(row.totalCents) },
        ]}
      />
      <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={setPage} />
      {selected && <OrderDetail order={selected} onClose={() => setSelected(null)} onChanged={() => refetch()} />}
    </>
  );
}

export default function OrdersPage() {
  const [tab, setTab] = useState<'board' | 'history'>('board');
  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'board', label: 'Em andamento' },
          { value: 'history', label: 'Histórico' },
        ]}
      />
      {tab === 'board' ? <Board /> : <History />}
    </>
  );
}
