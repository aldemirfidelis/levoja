'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Download, Route } from 'lucide-react';
import { BATCH_ITEM_STATUS_LABELS, BATCH_STATUS_LABELS, DELIVERY_STATUS_LABELS, formatBRL, ROUTE_STATUS_LABELS, VEHICLE_TYPE_LABELS, type DeliveryStatus } from '@levoja/shared';
import { api, Paginated, useApi, useRealtime } from '@levoja/web-kit/client';
import { Badge, Button, Card, ConfirmDialog, DataTable, formatDateTime, Input, Pagination, Skeleton, StatCard, Tabs, useToast } from '@levoja/web-kit/ui';
import { BATCH_TONE, type BatchView } from '@/components/b2b';
import { useCompany } from '@/lib/company';
import { PlanAwareError } from '@/components/plan-gate';

interface BatchDetail extends BatchView {
  pickup: { name: string | null; street: string; number: string; city: string };
  error: string | null;
  progress: (BatchView['progress'] & { byStatus: Partial<Record<DeliveryStatus, number>> }) | null;
  routes: { id?: string; sequence: number; status: keyof typeof ROUTE_STATUS_LABELS; vehicleType: keyof typeof VEHICLE_TYPE_LABELS; stopsCount: number; distanceKm: number; durationMin: number; driver: string | null }[];
  individual: number;
}

interface BatchItem {
  id: string;
  row: number;
  externalRef: string | null;
  status: keyof typeof BATCH_ITEM_STATUS_LABELS;
  errors: string[];
  recipient: string | null;
  address: string;
  feeCents: number | null;
  distanceKm: number | null;
  delivery: { id: string; code: string; status: DeliveryStatus; routeSequence: number | null; failReason: string | null; cancelReason: string | null } | null;
}

type ItemFilter = '' | 'VALID' | 'INVALID' | 'CREATED';

export default function BatchPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const { company, can } = useCompany();
  const toast = useToast();
  const base = `companies/${company.id}/delivery-batches/${batchId}`;
  const { data, error, isLoading, refetch } = useApi<BatchDetail>(base, undefined, {
    refetchInterval: (query) => (query.state.data?.status === 'VALIDATING' || (query.state.data?.status === 'CONFIRMED' && !query.state.data.completedAt) ? 4_000 : false),
  });
  const [filter, setFilter] = useState<ItemFilter>('');
  const [page, setPage] = useState(1);
  const items = useApi<Paginated<BatchItem>>(data && data.status !== 'VALIDATING' ? `${base}/items` : null, { status: filter || undefined, page, pageSize: 50 });
  useRealtime({ 'delivery.updated': () => void refetch() });
  const [confirming, setConfirming] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [when, setWhen] = useState('');

  if (error) return <PlanAwareError error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-96" />;
  const manage = can('company.deliveries.request');

  const confirm = async () => {
    try {
      await api.post(`${base}/confirm`, when ? { scheduledFor: new Date(when).toISOString() } : data.scheduledFor && new Date(data.scheduledFor) < new Date() ? { scheduledFor: null } : {});
      toast.success('Lote confirmado: as entregas foram criadas.');
      setConfirming(false);
      await Promise.all([refetch(), items.refetch()]);
    } catch (err) {
      toast.error(err);
    }
  };

  const cancel = async (reason: string) => {
    try {
      await api.post(`${base}/cancel`, { reason });
      toast.success('Lote cancelado.');
      setCanceling(false);
      await Promise.all([refetch(), items.refetch()]);
    } catch (err) {
      toast.error(err);
    }
  };

  const progress = data.progress;
  const finishedShare = progress && progress.total ? progress.finished / progress.total : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`/empresa/${company.id}/corporativo/lotes`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" /> Lotes
          </Link>
          <h2 className="mt-1 text-xl font-bold">
            Lote #{data.number}
            {data.name ? ` · ${data.name}` : ''}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge tone={BATCH_TONE[data.status]}>{data.completedAt ? 'Concluído' : BATCH_STATUS_LABELS[data.status]}</Badge>
            Coleta: {data.pickup.name ?? 'Empresa'} — {data.pickup.street}, {data.pickup.number}
            {data.scheduledFor ? ` · agendado para ${formatDateTime(data.scheduledFor)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={api.fileUrl(`${base}/export.csv`)} download>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />}>
              Resultado (CSV)
            </Button>
          </a>
          {manage && data.status === 'READY' && data.validCount > 0 && <Button onClick={() => setConfirming(true)}>Confirmar {data.validCount} entrega(s)</Button>}
          {manage && ['VALIDATING', 'READY', 'CONFIRMED'].includes(data.status) && !data.completedAt && !data.canceledAt && (
            <Button variant="ghost" className="text-danger" onClick={() => setCanceling(true)}>
              Cancelar lote
            </Button>
          )}
        </div>
      </div>

      {data.status === 'VALIDATING' && <Card><p className="text-sm">Validando {data.itemsCount} linha(s): localização dos endereços e cálculo dos preços. Esta página atualiza sozinha.</p></Card>}
      {data.error && <Card><p className="text-sm text-danger">{data.error}</p></Card>}

      {data.status !== 'VALIDATING' && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Entregas válidas" value={data.validCount} hint={`${data.invalidCount} linha(s) com erro`} tone={data.invalidCount ? 'warning' : 'neutral'} />
          <StatCard label="Valor total" value={formatBRL(data.totalFeeCents)} hint={data.paymentMethod === 'INVOICE' ? 'Faturado no contrato' : 'Debitado da carteira'} />
          <StatCard label="Rotas" value={data.routes.length} hint={`${data.individual} entrega(s) individual(is)`} />
          {progress ? (
            <StatCard label="Andamento" value={`${progress.finished}/${progress.total}`} hint={`${progress.delivered} entregue(s)`} tone={data.completedAt ? 'success' : 'neutral'} />
          ) : (
            <StatCard label="Linhas" value={data.itemsCount} hint={data.source === 'API' ? 'Enviadas pela API' : (data.fileName ?? data.source)} />
          )}
        </div>
      )}

      {progress && (
        <Card title="Andamento">
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.finished} aria-label="Entregas finalizadas">
            <div className="h-full rounded-full" style={{ width: `${finishedShare * 100}%`, background: 'var(--lj-chart-1)' }} />
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {Object.entries(progress.byStatus).map(([status, count]) => (
              <li key={status}>
                {DELIVERY_STATUS_LABELS[status as DeliveryStatus]}: <strong className="text-fg">{count}</strong>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.routes.length > 0 && (
        <Card title={data.status === 'READY' ? 'Rotas planejadas (prévia)' : 'Rotas'}>
          <DataTable
            rows={data.routes}
            rowKey={(row) => row.id ?? String(row.sequence)}
            columns={[
              { key: 'sequence', header: 'Rota', cell: (row) => <span className="inline-flex items-center gap-1.5"><Route className="h-4 w-4 text-muted" aria-hidden /> {row.sequence}</span> },
              { key: 'stops', header: 'Paradas', className: 'tabular-nums', cell: (row) => row.stopsCount },
              { key: 'distance', header: 'Percurso', className: 'tabular-nums', cell: (row) => `${row.distanceKm.toLocaleString('pt-BR')} km · ~${row.durationMin} min`, hideOnMobile: true },
              { key: 'vehicle', header: 'Veículo', cell: (row) => VEHICLE_TYPE_LABELS[row.vehicleType], hideOnMobile: true },
              { key: 'status', header: 'Situação', cell: (row) => <Badge tone={row.status === 'COMPLETED' ? 'success' : row.status === 'ASSIGNED' ? 'brand' : row.status === 'CANCELED' ? 'neutral' : 'info'}>{ROUTE_STATUS_LABELS[row.status]}</Badge> },
              { key: 'driver', header: 'Entregador', cell: (row) => row.driver ?? '—' },
            ]}
          />
        </Card>
      )}

      {data.status !== 'VALIDATING' && (
        <Card title="Linhas do lote">
          <Tabs
            value={filter}
            onChange={(value) => {
              setFilter(value);
              setPage(1);
            }}
            items={[
              { value: '', label: 'Todas' },
              { value: 'INVALID', label: `Com erro (${data.invalidCount})` },
              { value: data.status === 'CONFIRMED' ? 'CREATED' : 'VALID', label: data.status === 'CONFIRMED' ? 'Entregas criadas' : `Válidas (${data.validCount})` },
            ]}
          />
          {items.data && (
            <>
              <DataTable
                rows={items.data.data}
                rowKey={(row) => row.id}
                columns={[
                  { key: 'row', header: 'Linha', className: 'tabular-nums', cell: (row) => row.row },
                  { key: 'ref', header: 'Referência', cell: (row) => row.externalRef ?? '—', hideOnMobile: true },
                  {
                    key: 'recipient',
                    header: 'Destinatário',
                    cell: (row) => (
                      <div className="min-w-0">
                        <p className="truncate">{row.recipient ?? '—'}</p>
                        <p className="truncate text-xs text-muted">{row.address}</p>
                      </div>
                    ),
                  },
                  {
                    key: 'status',
                    header: 'Situação',
                    cell: (row) =>
                      row.errors.length ? (
                        <ul className="space-y-0.5 text-xs text-danger">
                          {row.errors.map((message) => (
                            <li key={message}>{message}</li>
                          ))}
                        </ul>
                      ) : row.delivery ? (
                        <span className="text-sm">
                          <Link href={`/empresa/${company.id}/entregas`} className="font-medium text-brand-600 hover:underline">
                            {row.delivery.code}
                          </Link>{' '}
                          · {DELIVERY_STATUS_LABELS[row.delivery.status]}
                          {row.delivery.routeSequence ? <span className="text-muted"> · parada {row.delivery.routeSequence}</span> : null}
                        </span>
                      ) : (
                        <Badge tone="success">{BATCH_ITEM_STATUS_LABELS[row.status]}</Badge>
                      ),
                  },
                  { key: 'fee', header: 'Valor', className: 'text-right tabular-nums', cell: (row) => (row.feeCents != null ? formatBRL(row.feeCents) : '—'), hideOnMobile: true },
                ]}
              />
              <Pagination page={items.data.meta.page} totalPages={items.data.meta.totalPages} total={items.data.meta.total} onChange={setPage} />
            </>
          )}
        </Card>
      )}

      {confirming && (
        <ConfirmDialog
          open
          onClose={() => setConfirming(false)}
          onConfirm={confirm}
          title={`Confirmar ${data.validCount} entrega(s)?`}
          confirmLabel="Confirmar lote"
          description={
            <div className="space-y-3">
              <p>
                Total de {formatBRL(data.totalFeeCents)} ({data.paymentMethod === 'INVOICE' ? 'faturado no contrato' : 'debitado da carteira'}). Linhas com erro não serão criadas.
              </p>
              <Input label="Novo horário (opcional)" type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} hint={data.scheduledFor ? `Atual: ${formatDateTime(data.scheduledFor)}` : 'Vazio = despachar agora.'} />
            </div>
          }
        />
      )}
      <ConfirmDialog
        open={canceling}
        onClose={() => setCanceling(false)}
        onConfirm={cancel}
        tone="danger"
        title="Cancelar lote?"
        confirmLabel="Cancelar lote"
        description="Entregas ainda não coletadas serão canceladas. As já coletadas seguem normalmente."
        reason={{ label: 'Motivo', required: true }}
      />
    </div>
  );
}
