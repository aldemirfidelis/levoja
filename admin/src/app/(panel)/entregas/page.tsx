'use client';

import { Suspense, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Truck } from 'lucide-react';
import { DELIVERY_STATUS_LABELS, DELIVERY_STATUSES, DeliveryStatus, formatBRL, VEHICLE_TYPE_LABELS, VehicleType } from '@levoja/shared';
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
import type { MapMarker } from '@levoja/web-kit/map';
import { SearchInput, useUrlFilters } from '@/components/list-filters';
import { useSession } from '@/lib/session';

const LiveMap = dynamic(() => import('@levoja/web-kit/map').then((module) => module.LiveMap), { ssr: false, loading: () => <div className="h-72 rounded-xl bg-surface-2" /> });

const TONE: Record<DeliveryStatus, Tone> = {
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

const OFFER_LABELS: Record<string, string> = { PENDING: 'Aguardando', ACCEPTED: 'Aceita', DECLINED: 'Recusada', EXPIRED: 'Expirada', CANCELED: 'Cancelada' };
const FINAL = ['DELIVERED', 'FAILED', 'CANCELED'];

interface Stop {
  street: string;
  number: string;
  city: string;
  lat: number;
  lng: number;
  name: string | null;
}

interface AdminDelivery {
  id: string;
  code: string;
  kind: 'ORDER' | 'ON_DEMAND';
  status: DeliveryStatus;
  order: { id: string; number: number } | null;
  company: { tradeName: string } | null;
  pickup: Stop;
  dropoff: Stop;
  vehicleType: VehicleType;
  distanceKm: number;
  feeCents: number;
  tipCents: number;
  payoutCents: number;
  dispatchAttempts: number;
  searchRadiusKm: number;
  driver: { id: string; name: string; rating: number } | null;
  driverLocation: { lat: number; lng: number } | null;
  timeline: { status: DeliveryStatus; at: string; actorType: string; reason: string | null }[];
  createdAt: string;
}

interface AdminDeliveryDetail extends AdminDelivery {
  offers: { id: string; driverName: string; status: string; payoutCents: number; distanceToPickupKm: number; createdAt: string; declineReason: string | null }[];
  tracking: { lat: number; lng: number }[];
}

interface OnlineDriver {
  id: string;
  availability: string;
  lastLat: number | null;
  lastLng: number | null;
  user: { name: string };
  activeVehicle: { type: VehicleType; plate: string | null } | null;
}

function DeliveryDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const { data, refetch } = useApi<AdminDeliveryDetail>(`admin/deliveries/${id}`);
  const { data: drivers } = useApi<OnlineDriver[]>(can('operations.view') ? 'admin/drivers-online' : null);
  const [driverId, setDriverId] = useState('');
  const [canceling, setCanceling] = useState(false);

  const markers = useMemo<MapMarker[]>(() => {
    if (!data) return [];
    const list: MapMarker[] = [
      { id: 'p', lat: data.pickup.lat, lng: data.pickup.lng, kind: 'pickup', label: 'Coleta' },
      { id: 'd', lat: data.dropoff.lat, lng: data.dropoff.lng, kind: 'dropoff', label: 'Destino' },
    ];
    if (data.driverLocation) list.push({ id: 'driver', ...data.driverLocation, kind: 'driver', label: data.driver?.name });
    return list;
  }, [data]);

  if (!data) return null;
  const assign = async () => {
    try {
      await api.post(`admin/deliveries/${id}/assign`, { driverId });
      toast.success('Entrega atribuída.');
      await refetch();
      onChanged();
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <Dialog open onClose={onClose} size="lg" title={`Entrega ${data.code}`} description={data.order ? `Pedido #${data.order.number} · ${data.company?.tradeName ?? ''}` : 'Entrega avulsa'}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge tone={TONE[data.status]}>{DELIVERY_STATUS_LABELS[data.status]}</Badge>
          <Badge>{VEHICLE_TYPE_LABELS[data.vehicleType]}</Badge>
          <Badge>{data.distanceKm} km</Badge>
          <Badge>Cobrado {formatBRL(data.feeCents + data.tipCents)}</Badge>
          <Badge>Repasse {formatBRL(data.payoutCents + data.tipCents)}</Badge>
          {data.status === 'SEARCHING_DRIVER' && <Badge tone="warning">Tentativa {data.dispatchAttempts} · raio {data.searchRadiusKm} km</Badge>}
        </div>
        <LiveMap markers={markers} path={data.tracking.map((p) => [p.lat, p.lng] as [number, number])} height={280} />
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-2 font-semibold">Ofertas</p>
            {data.offers.length === 0 ? (
              <p className="text-muted">Nenhuma oferta enviada.</p>
            ) : (
              <ul className="space-y-1">
                {data.offers.map((offer) => (
                  <li key={offer.id} className="flex justify-between gap-2">
                    <span>
                      {offer.driverName} <span className="text-muted">({offer.distanceToPickupKm} km)</span>
                    </span>
                    <span className="text-muted">{OFFER_LABELS[offer.status]}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-2 font-semibold">Histórico</p>
            <ol className="space-y-1">
              {data.timeline.map((entry, index) => (
                <li key={index} className="text-xs">
                  <span className="text-muted">{formatDateTime(entry.at)}</span> — {DELIVERY_STATUS_LABELS[entry.status]}
                  {entry.reason ? ` (${entry.reason})` : ''}
                </li>
              ))}
            </ol>
          </div>
        </div>
        {can('deliveries.manage') && !FINAL.includes(data.status) && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
            {['SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'AT_PICKUP'].includes(data.status) && (
              <>
                <Select
                  className="min-w-64 flex-1"
                  label="Atribuir manualmente"
                  value={driverId}
                  placeholder="Selecione um entregador online"
                  options={(drivers ?? []).map((driver) => ({
                    value: driver.id,
                    label: `${driver.user.name} · ${driver.activeVehicle ? VEHICLE_TYPE_LABELS[driver.activeVehicle.type] : ''} · ${driver.availability === 'BUSY' ? 'ocupado' : 'livre'}`,
                  }))}
                  onChange={(e) => setDriverId(e.target.value)}
                />
                <Button disabled={!driverId} onClick={assign}>
                  Atribuir
                </Button>
              </>
            )}
            <Button variant="danger" onClick={() => setCanceling(true)}>
              Cancelar entrega
            </Button>
          </div>
        )}
      </div>
      {canceling && (
        <ConfirmDialog
          open
          onClose={() => setCanceling(false)}
          onConfirm={async (reason) => {
            await api.post(`admin/deliveries/${id}/cancel`, { reason });
            toast.success('Entrega cancelada.');
            await refetch();
            onChanged();
          }}
          title="Cancelar entrega"
          confirmLabel="Cancelar"
          tone="danger"
          reason={{ label: 'Motivo', required: true }}
        />
      )}
    </Dialog>
  );
}

function DeliveriesList() {
  const [filters, setFilters] = useUrlFilters({ scope: 'active', status: '', search: '', page: '1' });
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error, isLoading, refetch } = useApi<Paginated<AdminDelivery>>('admin/deliveries', { ...filters, pageSize: 25 }, { refetchInterval: 20_000 });

  return (
    <>
      <PageHeader title="Entregas" description="Despacho, acompanhamento e intervenção operacional (atualiza a cada 20 s)." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Código da entrega" />
        <Select
          className="sm:w-44"
          aria-label="Situação"
          value={filters.scope}
          placeholder="Todas"
          options={[
            { value: 'active', label: 'Em andamento' },
            { value: 'finished', label: 'Finalizadas' },
          ]}
          onChange={(e) => setFilters({ scope: e.target.value })}
        />
        <Select
          className="sm:w-56"
          aria-label="Status"
          value={filters.status}
          placeholder="Qualquer status"
          options={DELIVERY_STATUSES.map((status) => ({ value: status, label: DELIVERY_STATUS_LABELS[status] }))}
          onChange={(e) => setFilters({ status: e.target.value })}
        />
      </div>
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.data.length === 0 && <EmptyState icon={<Truck className="h-8 w-8" />} title="Nenhuma entrega encontrada" />}
      {!!data?.data.length && (
        <>
          <DataTable
            rows={data.data}
            rowKey={(row) => row.id}
            onRowClick={(row) => setSelected(row.id)}
            columns={[
              { key: 'code', header: 'Entrega', cell: (row) => <span className="font-mono font-semibold">{row.code}</span> },
              { key: 'origin', header: 'Origem', cell: (row) => row.company?.tradeName ?? row.pickup.name ?? `${row.pickup.street}, ${row.pickup.number}` },
              { key: 'status', header: 'Status', cell: (row) => <Badge tone={TONE[row.status]}>{DELIVERY_STATUS_LABELS[row.status]}</Badge> },
              { key: 'driver', header: 'Entregador', hideOnMobile: true, cell: (row) => row.driver?.name ?? '—' },
              { key: 'km', header: 'Km', hideOnMobile: true, cell: (row) => row.distanceKm },
              { key: 'date', header: 'Criada', hideOnMobile: true, cell: (row) => formatDateTime(row.createdAt) },
            ]}
          />
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={(page) => setFilters({ page: String(page) })} />
        </>
      )}
      {selected && <DeliveryDialog id={selected} onClose={() => setSelected(null)} onChanged={() => refetch()} />}
    </>
  );
}

export default function DeliveriesPage() {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <DeliveriesList />
    </Suspense>
  );
}
