'use client';

import { Suspense, useMemo, useRef } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { AlertOctagon, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { DELIVERY_STATUS_LABELS, DeliveryStatus } from '@levoja/shared';
import { useApi, useRealtime } from '@levoja/web-kit/client';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, PageHeader, Select, Skeleton, StatCard, formatDateTime } from '@levoja/web-kit/ui';
import type { MapMarker } from '@levoja/web-kit/map';
import { CityOption, OperationsNav } from '@/components/operations-nav';
import { useUrlFilters } from '@/components/list-filters';

const LiveMap = dynamic(() => import('@levoja/web-kit/map').then((module) => module.LiveMap), { ssr: false, loading: () => <div className="h-[420px] rounded-xl bg-surface-2" /> });

interface Snapshot {
  generatedAt: string;
  metrics: {
    driversOnline: number;
    driversBusy: number;
    deliveriesWaiting: number;
    deliveriesInProgress: number;
    deliveriesLate: number;
    deliveredToday: number;
    canceledToday: number;
    failedToday: number;
    ordersToday: number;
    ordersLastHour: number;
    ordersInProgress: number;
    ordersLate: number;
    slaToday: number | null;
    avgAssignMinutes: number | null;
    avgPickupMinutes: number | null;
    avgRouteMinutes: number | null;
    avgDeliveryMinutes: number | null;
    supplyDemandRatio: number | null;
    ticketsSlaBreached: number;
  };
  drivers: { id: string; name: string; availability: 'ONLINE' | 'BUSY'; lat: number | null; lng: number | null; lastLocationAt: string | null; activeDeliveries: number; stale: boolean }[];
  deliveries: {
    id: string;
    code: string;
    status: DeliveryStatus;
    company: string | null;
    order: { id: string; number: number } | null;
    pickup: { lat: number; lng: number };
    dropoff: { lat: number; lng: number };
    driverName: string | null;
    promisedAt: string;
    late: boolean;
    waitingMinutes: number | null;
    dispatchAttempts: number;
  }[];
  supplyDemand: { geohash: string; lat: number; lng: number; idleDrivers: number; busyDrivers: number; waiting: number; inProgress: number; status: 'shortage' | 'balanced' | 'surplus' }[];
  alerts: { type: string; severity: 'critical' | 'warning'; message: string; deliveryId?: string; deliveryCode?: string; orderId?: string; orderNumber?: number; driverId?: string }[];
}

const minutes = (value: number | null) => (value == null ? '—' : `${value.toLocaleString('pt-BR')} min`);
const SUPPLY: Record<Snapshot['supplyDemand'][number]['status'], { label: string; tone: 'danger' | 'success' | 'neutral' }> = {
  shortage: { label: 'Falta entregador', tone: 'danger' },
  balanced: { label: 'Equilibrado', tone: 'neutral' },
  surplus: { label: 'Sobra entregador', tone: 'success' },
};

function Legend() {
  const items: { color: string; label: string }[] = [
    { color: '#ff5a1f', label: 'Entregador livre' },
    { color: '#d97706', label: 'Entregador em entrega' },
    { color: '#6b7280', label: 'Sem sinal' },
    { color: '#2563eb', label: 'Coleta aguardando entregador' },
    { color: '#d03b3b', label: 'Entrega atrasada' },
  ];
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legenda do mapa">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full ring-2 ring-surface" style={{ background: item.color }} aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function ControlTower() {
  const [filters, setFilters] = useUrlFilters({ city: '' });
  const { data: cities } = useApi<CityOption[]>('admin/operations/cities');
  const { data, error, isLoading, refetch, isFetching, dataUpdatedAt } = useApi<Snapshot>('admin/operations/snapshot', { city: filters.city }, { refetchInterval: 15_000 });

  // Eventos em tempo real antecipam a atualização (agrupados para não sobrecarregar a API).
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soon = () => {
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      void refetch();
    }, 2_000);
  };
  const { connected } = useRealtime({ 'dispatch.stalled': soon, 'driver.availability': soon, 'support.sla.breached': soon, 'support.ticket.created': soon });

  const markers = useMemo<MapMarker[]>(() => {
    if (!data) return [];
    const list: MapMarker[] = [];
    for (const driver of data.drivers) {
      if (driver.lat == null || driver.lng == null) continue;
      list.push({
        id: `driver-${driver.id}`,
        lat: driver.lat,
        lng: driver.lng,
        kind: driver.stale ? 'point' : driver.availability === 'BUSY' ? 'driver-busy' : 'driver',
        label: `${driver.name}${driver.stale ? ' (sem sinal)' : driver.activeDeliveries ? ` · ${driver.activeDeliveries} entrega(s)` : ''}`,
      });
    }
    for (const delivery of data.deliveries) {
      if (delivery.late) {
        const target = delivery.status === 'SEARCHING_DRIVER' || delivery.status === 'PENDING' ? delivery.pickup : delivery.dropoff;
        list.push({ id: `late-${delivery.id}`, ...target, kind: 'alert', label: `${delivery.code} atrasada` });
      } else if (delivery.status === 'SEARCHING_DRIVER' || delivery.status === 'PENDING') {
        list.push({ id: `wait-${delivery.id}`, ...delivery.pickup, kind: 'pickup', label: `${delivery.code} aguardando entregador` });
      }
    }
    return list;
  }, [data]);

  const m = data?.metrics;
  return (
    <>
      <PageHeader
        title="Operação"
        description={
          <span className="inline-flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${connected ? 'bg-success' : 'bg-muted'}`} aria-hidden />
            {connected ? 'Tempo real conectado' : 'Atualização a cada 15 s'}
            {dataUpdatedAt ? ` · atualizado ${formatDateTime(new Date(dataUpdatedAt))}` : ''}
          </span>
        }
        actions={
          <Button variant="secondary" icon={<RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />} onClick={() => refetch()}>
            Atualizar
          </Button>
        }
      />
      <OperationsNav />
      <div className="mb-6 flex flex-wrap gap-3">
        <Select
          aria-label="Cidade"
          className="w-full sm:w-64"
          value={filters.city}
          onChange={(event) => setFilters({ city: event.target.value })}
          options={[{ value: '', label: 'Todas as cidades' }, ...(cities ?? []).map((item) => ({ value: item.city, label: item.state ? `${item.city}/${item.state}` : item.city }))]}
        />
      </div>

      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {isLoading && <Skeleton className="h-96" />}
      {data && m && (
        <div className={`space-y-6 transition-opacity ${isFetching ? 'opacity-90' : ''}`}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Entregadores ativos" value={m.driversOnline + m.driversBusy} hint={`${m.driversOnline} livres · ${m.driversBusy} em entrega`} />
            <StatCard
              label="Aguardando entregador"
              value={m.deliveriesWaiting}
              tone={m.deliveriesWaiting > m.driversOnline ? 'danger' : m.deliveriesWaiting ? 'warning' : 'neutral'}
              hint={m.supplyDemandRatio == null ? 'Nenhuma entrega na fila' : `${m.supplyDemandRatio.toLocaleString('pt-BR')} entregador(es) livre(s) por entrega`}
            />
            <StatCard label="Em andamento" value={m.deliveriesInProgress} hint={`${m.ordersInProgress} pedido(s) em aberto`} />
            <StatCard label="Atrasadas" value={m.deliveriesLate + m.ordersLate} tone={m.deliveriesLate + m.ordersLate ? 'danger' : 'success'} hint={`${m.deliveriesLate} entrega(s) · ${m.ordersLate} pedido(s)`} />
            <StatCard label="Concluídas hoje" value={m.deliveredToday} hint={`${m.canceledToday} cancelada(s) · ${m.failedToday} não entregue(s)`} />
            <StatCard label="SLA hoje" value={m.slaToday == null ? '—' : `${m.slaToday.toLocaleString('pt-BR')}%`} tone={m.slaToday == null ? 'neutral' : m.slaToday >= 90 ? 'success' : m.slaToday >= 75 ? 'warning' : 'danger'} hint="Entregas concluídas no prazo" />
            <StatCard label="Pedidos na última hora" value={m.ordersLastHour} hint={`${m.ordersToday} hoje`} />
            <StatCard label="Tempo médio de entrega" value={minutes(m.avgDeliveryMinutes)} hint={`Achar entregador ${minutes(m.avgAssignMinutes)} · coleta ${minutes(m.avgPickupMinutes)} · percurso ${minutes(m.avgRouteMinutes)}`} />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="Mapa em tempo real">
              <LiveMap markers={markers} height={420} />
              <Legend />
            </Card>
            <Card title={`Alertas (${data.alerts.length})`}>
              {data.alerts.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted">
                  <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> Nenhum alerta no momento.
                </p>
              ) : (
                <ul className="max-h-[440px] space-y-2 overflow-y-auto pr-1">
                  {data.alerts.map((alert, index) => (
                    <li key={index} className="flex gap-2 rounded-lg border border-border p-2 text-sm">
                      {alert.severity === 'critical' ? <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{alert.severity === 'critical' ? 'Crítico' : 'Atenção'}</p>
                        <p className="text-fg">{alert.message}</p>
                        {alert.orderNumber != null && (
                          <Link href={`/pedidos?search=${alert.orderNumber}`} className="text-xs text-brand-600 hover:underline">
                            Ver pedido
                          </Link>
                        )}
                        {alert.deliveryCode && (
                          <Link href={`/entregas?scope=active&search=${alert.deliveryCode}`} className="text-xs text-brand-600 hover:underline">
                            Ver entrega
                          </Link>
                        )}
                        {alert.type === 'tickets_sla' && (
                          <Link href="/suporte?breached=true" className="text-xs text-brand-600 hover:underline">
                            Ver chamados
                          </Link>
                        )}
                        {alert.type === 'anomaly' && (
                          <Link href="/inteligencia/anomalias" className="text-xs text-brand-600 hover:underline">
                            Ver anomalias
                          </Link>
                        )}
                        {alert.type === 'risk_cases' && (
                          <Link href="/antifraude?level=HIGH" className="text-xs text-brand-600 hover:underline">
                            Revisar casos
                          </Link>
                        )}
                        {alert.type === 'pricing_suggestions' && (
                          <Link href="/inteligencia/precos" className="text-xs text-brand-600 hover:underline">
                            Decidir sugestões
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title={`Entregas em aberto (${data.deliveries.length})`}>
            {data.deliveries.length === 0 ? (
              <EmptyState title="Nenhuma entrega em aberto" />
            ) : (
              <DataTable
                rows={[...data.deliveries].sort((a, b) => Number(b.late) - Number(a.late) || (b.waitingMinutes ?? -1) - (a.waitingMinutes ?? -1))}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: 'code',
                    header: 'Entrega',
                    cell: (row) => (
                      <Link href={`/entregas?scope=active&search=${row.code}`} className="font-medium text-brand-600 hover:underline">
                        {row.code}
                      </Link>
                    ),
                  },
                  { key: 'status', header: 'Situação', cell: (row) => <Badge tone={row.status === 'SEARCHING_DRIVER' ? 'warning' : 'brand'}>{DELIVERY_STATUS_LABELS[row.status]}</Badge> },
                  { key: 'origin', header: 'Origem', cell: (row) => (row.order ? `Pedido #${row.order.number} · ${row.company ?? ''}` : 'Avulsa'), hideOnMobile: true },
                  { key: 'driver', header: 'Entregador', cell: (row) => row.driverName ?? (row.waitingMinutes != null ? `Buscando há ${row.waitingMinutes} min (${row.dispatchAttempts} tent.)` : '—') },
                  {
                    key: 'promised',
                    header: 'Prazo',
                    cell: (row) => (
                      <span className="flex items-center gap-2">
                        {formatDateTime(row.promisedAt)}
                        {row.late && <Badge tone="danger">Atrasada</Badge>}
                      </span>
                    ),
                  },
                ]}
              />
            )}
          </Card>

          <Card title="Oferta x demanda por região (~5 km)">
            {data.supplyDemand.length === 0 ? (
              <p className="text-sm text-muted">Sem entregadores ou entregas ativas no momento.</p>
            ) : (
              <DataTable
                rows={data.supplyDemand}
                rowKey={(row) => row.geohash}
                columns={[
                  { key: 'region', header: 'Região', cell: (row) => <span className="tabular-nums">{row.lat.toFixed(3)}, {row.lng.toFixed(3)}</span> },
                  { key: 'waiting', header: 'Aguardando', cell: (row) => <span className="tabular-nums">{row.waiting}</span> },
                  { key: 'idle', header: 'Livres', cell: (row) => <span className="tabular-nums">{row.idleDrivers}</span> },
                  { key: 'busy', header: 'Em entrega', cell: (row) => <span className="tabular-nums">{row.busyDrivers}</span>, hideOnMobile: true },
                  { key: 'progress', header: 'Em andamento', cell: (row) => <span className="tabular-nums">{row.inProgress}</span>, hideOnMobile: true },
                  { key: 'status', header: 'Situação', cell: (row) => <Badge tone={SUPPLY[row.status].tone}>{SUPPLY[row.status].label}</Badge> },
                ]}
              />
            )}
          </Card>
        </div>
      )}
    </>
  );
}

export default function OperationsPage() {
  return (
    <Suspense>
      <ControlTower />
    </Suspense>
  );
}
