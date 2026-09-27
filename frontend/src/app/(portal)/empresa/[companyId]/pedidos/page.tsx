'use client';

import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Bell, BellRing, Bike, CalendarClock, ChefHat, CircleCheck, Clock, FileText, MessageSquareText, Package, PackageCheck, Printer, ShieldAlert, Store, TriangleAlert, Volume2, VolumeX } from 'lucide-react';
import { DELIVERY_STATUS_LABELS, DeliveryStatus, formatBRL, ORDER_STATUS_LABELS, OrderStatus, PAYMENT_METHOD_LABELS } from '@levoja/shared';
import { api, Paginated, useApi } from '@levoja/web-kit/client';
import {
  Badge,
  Button,
  cn,
  ChatLauncher,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  formatDateTime,
  Input,
  Pagination,
  SkeletonRows,
  Tabs,
  useToast,
} from '@levoja/web-kit/ui';
import { useCompany } from '@/lib/company';
import type { CompanyOrderView } from '@/components/order-types';
import { PlanAwareError } from '@/components/plan-gate';
import { useOrderAlerts } from '@/components/order-alerts';
import { useOrderLabelPrinter } from '@/components/order-labels';
import { DISPATCH_STATUSES } from '@/lib/order-printing';
import { useBrowserNotifications } from '@/components/pwa';

const COLUMNS: { key: string; title: string; statuses: OrderStatus[]; icon: LucideIcon; accent: string; empty: string }[] = [
  { key: 'new', title: 'Novos', statuses: ['NEW'], icon: BellRing, accent: 'text-success', empty: 'Aguardando pedidos...' },
  { key: 'confirmed', title: 'Confirmados', statuses: ['CONFIRMED'], icon: CircleCheck, accent: 'text-info', empty: 'Nenhum pedido confirmado' },
  { key: 'preparing', title: 'Em preparo', statuses: ['PREPARING'], icon: ChefHat, accent: 'text-warning', empty: 'Nada em preparo' },
  { key: 'ready', title: 'Prontos', statuses: ['READY_FOR_PICKUP'], icon: PackageCheck, accent: 'text-brand-500', empty: 'Nenhum pedido pronto' },
  { key: 'delivery', title: 'Em entrega', statuses: ['DRIVER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'], icon: Bike, accent: 'text-muted', empty: 'Nenhuma entrega em curso' },
];

const NEXT_ACTION: Partial<Record<OrderStatus, { action: string; label: string }>> = {
  NEW: { action: 'confirm', label: 'Confirmar pedido' },
  CONFIRMED: { action: 'prepare', label: 'Iniciar preparo' },
  PREPARING: { action: 'ready', label: 'Marcar como pronto' },
};

const minutesSince = (iso: string, now = Date.now()) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));

function waitingLabel(minutes: number): string {
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  return `há ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Relógio que atualiza a tela periodicamente (tempo de espera dos cards). */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

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
  const { print, printed } = useOrderLabelPrinter();

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
        <div className="flex w-full flex-wrap justify-between gap-2">
          {manage && cancellable ? (
            <Button variant="ghost" className="text-danger" onClick={() => setCanceling(true)}>
              Cancelar pedido
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => void print(order)}>
              {printed.has(order.id) ? 'Reimprimir etiqueta' : 'Imprimir etiqueta'}
            </Button>
            {manage && next && (
              <Button loading={busy} onClick={() => run(next.action)}>
                {next.label}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge tone={order.fulfillment === 'PICKUP' ? 'info' : 'brand'}>{order.fulfillment === 'PICKUP' ? 'Retirada no balcão' : 'Entrega'}</Badge>
          {order.scheduledFor && <Badge tone="warning">Agendado para {formatDateTime(order.scheduledFor)}</Badge>}
          {order.requiresIdCheck && <Badge tone="danger">Conferir documento (idade mínima)</Badge>}
          {order.hasPrescription && <Badge tone="warning">Com receita</Badge>}
        </div>

        {/* Itens em destaque, com a foto do produto: na correria a cozinha confere pela imagem. */}
        <section aria-label="Itens do pedido" className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted">
            Itens do pedido ({order.items.reduce((sum, item) => sum + item.quantity, 0)})
          </h3>
          <ul className="space-y-2">
            {order.items.map((item) => (
              <li key={item.id} className="flex gap-4 rounded-xl border-2 border-border bg-surface p-3">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt="" className="h-24 w-24 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted" aria-hidden>
                    <Package className="h-8 w-8" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-extrabold leading-snug text-fg">
                    <span className={cn('mr-2 inline-flex min-w-10 justify-center rounded-lg px-2 py-0.5 text-lg font-black text-white', item.quantity > 1 ? 'bg-danger' : 'bg-noite dark:bg-fg dark:text-bg')}>
                      {item.quantity}×
                    </span>
                    {item.name}
                  </p>
                  {item.options?.length ? (
                    <ul className="mt-1.5 space-y-0.5 text-base text-fg">
                      {item.options.map((option, index) => (
                        <li key={index}>
                          <span className="text-muted">{option.group}:</span> <strong>{option.option}</strong>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {item.notes && (
                    <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-warning/15 px-2.5 py-1.5 text-base font-bold text-warning">
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {item.notes}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-base font-bold tabular-nums">{formatBRL(item.totalCents)}</span>
              </li>
            ))}
          </ul>
          {order.notes && (
            <p className="flex items-start gap-2 rounded-xl border-2 border-warning/50 bg-warning/10 px-3 py-2.5 text-base font-bold text-fg">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
              <span>Observação do pedido: {order.notes}</span>
            </p>
          )}
        </section>

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

/** Etiqueta pequena dentro do card (agendado, documento, receita, observação). */
function Flag({ icon: Icon, tone, children }: { icon: LucideIcon; tone: 'warning' | 'danger' | 'info'; children: React.ReactNode }) {
  const tones = { warning: 'bg-warning/10 text-warning', danger: 'bg-danger/10 text-danger', info: 'bg-info/10 text-info' };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold', tones[tone])}>
      <Icon className="h-3 w-3" aria-hidden />
      {children}
    </span>
  );
}

function OrderCard({
  order,
  now,
  manage,
  busy,
  printed,
  onOpen,
  onAdvance,
  onPrint,
}: {
  order: CompanyOrderView;
  now: number;
  manage: boolean;
  busy: boolean;
  printed: boolean;
  onOpen: () => void;
  onAdvance: () => void;
  onPrint: () => void;
}) {
  const waiting = minutesSince(order.createdAt, now);
  const isNew = order.status === 'NEW';
  const late = isNew && waiting >= 5;
  const next = NEXT_ACTION[order.status];
  const shown = order.items.slice(0, 3);
  const hidden = order.items.length - shown.length;
  const driver = order.delivery?.driver;

  return (
    <article className={cn('rounded-xl border bg-surface shadow-sm transition', isNew ? 'lj-new-order border-success' : 'border-border hover:border-brand-400')}>
      <button type="button" onClick={onOpen} className="block w-full rounded-xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40" aria-label={`Abrir pedido #${order.number}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <span className="text-base font-black text-fg">#{order.number}</span>
            {isNew && <span className="rounded-full bg-success px-1.5 py-px text-[10px] font-black uppercase tracking-wide text-white">Novo</span>}
          </span>
          <span className={cn('flex shrink-0 items-center gap-1 text-xs tabular-nums', late ? 'font-bold text-danger' : 'text-muted')} title={`Recebido às ${timeOf(order.createdAt)}`}>
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {waitingLabel(waiting)}
          </span>
        </div>
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
          {order.fulfillment === 'PICKUP' ? <Store className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <Bike className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          <span className="truncate">
            {order.customer.firstName} · {order.fulfillment === 'PICKUP' ? 'Retirada' : 'Entrega'}
          </span>
        </p>

        <ul className="mt-2 space-y-0.5 text-sm text-fg">
          {shown.map((item) => (
            <li key={item.id} className="truncate">
              <span className="font-bold">{item.quantity}×</span> {item.name}
            </li>
          ))}
          {hidden > 0 && <li className="text-xs text-muted">+ {hidden === 1 ? '1 item' : `${hidden} itens`}</li>}
        </ul>

        {(order.scheduledFor || order.requiresIdCheck || order.hasPrescription || order.notes || order.items.some((item) => item.notes)) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {order.scheduledFor && (
              <Flag icon={CalendarClock} tone="warning">
                Agendado {timeOf(order.scheduledFor)}
              </Flag>
            )}
            {order.requiresIdCheck && (
              <Flag icon={ShieldAlert} tone="danger">
                Conferir documento
              </Flag>
            )}
            {order.hasPrescription && (
              <Flag icon={FileText} tone="warning">
                Receita
              </Flag>
            )}
            {(order.notes || order.items.some((item) => item.notes)) && (
              <Flag icon={MessageSquareText} tone="info">
                Observação
              </Flag>
            )}
          </div>
        )}

        {order.delivery && ['READY_FOR_PICKUP', 'DRIVER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'].includes(order.status) && (
          <p className="mt-2 truncate text-xs text-muted">
            {driver ? `${driver.name} · ${DELIVERY_STATUS_LABELS[order.delivery.status as DeliveryStatus] ?? order.delivery.status}` : 'Procurando entregador...'}
          </p>
        )}

        <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
          <span className="truncate text-xs text-muted">{PAYMENT_METHOD_LABELS[order.paymentMethod]}</span>
          <span className="text-sm font-black tabular-nums text-fg">{formatBRL(order.totalCents)}</span>
        </div>
      </button>

      {manage && next && (
        <div className="px-3 pb-3">
          <Button size="sm" variant={isNew ? 'success' : 'secondary'} className="w-full" loading={busy} onClick={onAdvance}>
            {next.label}
          </Button>
        </div>
      )}
      {manage && order.status === 'READY_FOR_PICKUP' && order.fulfillment === 'PICKUP' && (
        <div className="px-3 pb-3">
          <Button size="sm" variant="secondary" className="w-full" onClick={onOpen}>
            Entregar ao cliente
          </Button>
        </div>
      )}
      {/* Etiqueta para grampear no pacote: pronta para sair e já em entrega (reimpressão). */}
      {(order.status === 'READY_FOR_PICKUP' || DISPATCH_STATUSES.includes(order.status)) && (
        <div className="px-3 pb-3">
          <Button size="sm" variant={printed ? 'ghost' : 'dark'} className="w-full" icon={<Printer className="h-3.5 w-3.5" />} onClick={onPrint}>
            {printed ? 'Etiqueta impressa · reimprimir' : 'Imprimir etiqueta'}
          </Button>
        </div>
      )}
    </article>
  );
}

function Board() {
  const { company, can } = useCompany();
  const toast = useToast();
  const alerts = useOrderAlerts();
  const notifications = useBrowserNotifications();
  const now = useNow(30_000);
  const manage = can('company.orders.manage');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { orders, connected, refetch } = alerts;
  const labels = useOrderLabelPrinter();
  // O detalhe acompanha a lista (tempo real) em vez de ficar com uma cópia antiga do pedido.
  const selected = orders.find((order) => order.id === selectedId) ?? null;

  const byColumn = useMemo(
    () =>
      COLUMNS.map((column) => ({
        ...column,
        orders: orders.filter((order) => column.statuses.includes(order.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      })),
    [orders],
  );

  const advance = async (order: CompanyOrderView) => {
    const next = NEXT_ACTION[order.status];
    if (!next) return;
    setBusyId(order.id);
    try {
      await api.post(`companies/${company.id}/orders/${order.id}/${next.action}`);
      toast.success(`Pedido #${order.number}: ${next.label.toLowerCase()} — feito.`);
      await refetch();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusyId(null);
    }
  };

  if (!alerts.enabled) return <EmptyState title="Pedidos indisponíveis" description="O quadro de pedidos fica disponível depois que a empresa é aprovada." />;
  if (alerts.isLoading) return <SkeletonRows rows={4} />;
  if (alerts.error) return <PlanAwareError error={alerts.error} onRetry={() => refetch()} />;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border bg-surface px-4 py-3">
        <span className={cn('flex items-center gap-2 text-sm font-bold', connected ? 'text-success' : 'text-muted')}>
          <span className="relative flex h-2.5 w-2.5">
            {connected && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />}
            <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', connected ? 'bg-success' : 'bg-muted')} />
          </span>
          {connected ? 'Ao vivo' : 'Reconectando...'}
        </span>
        <span className="text-sm text-muted">{connected ? 'Pedidos novos chegam na hora, com alerta sonoro.' : 'Enquanto isso, a lista é atualizada a cada 15 segundos.'}</span>
        {!company.isOpen && <Badge tone="warning">Loja pausada — novos pedidos bloqueados</Badge>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {notifications.permission === 'default' && (
            <Button size="sm" variant="ghost" icon={<Bell className="h-4 w-4" />} onClick={() => void notifications.request()}>
              Avisar com a aba minimizada
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={alerts.testSound} disabled={!alerts.sound}>
            Testar som
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={alerts.sound ? <Volume2 className="h-4 w-4 text-success" /> : <VolumeX className="h-4 w-4 text-danger" />}
            onClick={() => alerts.setSound(!alerts.sound)}
            aria-pressed={alerts.sound}
          >
            {alerts.sound ? 'Som ligado' : 'Som desligado'}
          </Button>
        </div>
      </div>
      {alerts.sound && !alerts.audioReady && (
        <p className="mb-4 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-fg" role="status">
          Clique em qualquer lugar da página para liberar o som dos pedidos novos (o navegador só toca som depois de um clique).
        </p>
      )}

      {/* Colunas lado a lado; em telas estreitas o quadro rola na horizontal em vez de espremer os cards. */}
      <div className="grid auto-cols-[minmax(13rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-3 [scrollbar-width:thin]">
        {byColumn.map((column) => {
          const hot = column.key === 'new' && column.orders.length > 0;
          return (
            <section key={column.key} className={cn('flex min-h-[20rem] flex-col rounded-2xl p-2.5', hot ? 'bg-success/10' : 'bg-surface-2')} aria-label={`${column.title}: ${column.orders.length}`}>
              <header className="mb-2.5 flex items-center gap-2 px-1">
                <column.icon className={cn('h-4 w-4', column.accent)} aria-hidden />
                <h2 className="text-sm font-extrabold text-fg">{column.title}</h2>
                <span className={cn('ml-auto min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-black tabular-nums', hot ? 'bg-success text-white' : 'bg-surface text-muted')}>{column.orders.length}</span>
              </header>
              <div className="flex flex-1 flex-col gap-2.5">
                {column.orders.length ? (
                  column.orders.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      now={now}
                      manage={manage}
                      busy={busyId === order.id}
                      printed={labels.printed.has(order.id)}
                      onOpen={() => setSelectedId(order.id)}
                      onAdvance={() => void advance(order)}
                      onPrint={() => void labels.print(order)}
                    />
                  ))
                ) : (
                  <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border px-2 py-8 text-center text-xs text-muted">{column.empty}</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {selected && <OrderDetail order={selected} onClose={() => setSelectedId(null)} onChanged={() => refetch()} />}
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
