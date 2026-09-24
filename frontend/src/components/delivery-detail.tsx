'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import QRCode from 'react-qr-code';
import { Star } from 'lucide-react';
import { DELIVERY_STATUS_LABELS, formatBRL, ITEM_CATEGORY_LABELS, ItemCategory, PROOF_METHOD_LABELS, VEHICLE_TYPE_LABELS } from '@levoja/shared';
import { api, useApi, useRealtime } from '@levoja/web-kit/client';
import { Badge, Button, Card, cn, ConfirmDialog, ErrorState, formatDateTime, SkeletonRows, useToast } from '@levoja/web-kit/ui';
import type { MapMarker } from '@levoja/web-kit/map';
import type { DeliveryView } from './delivery-types';

const LiveMap = dynamic(() => import('@levoja/web-kit/map').then((module) => module.LiveMap), { ssr: false, loading: () => <div className="h-80 rounded-xl bg-surface-2" /> });

const ACTIVE = ['DRIVER_ASSIGNED', 'AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'AT_DROPOFF'];
const CANCELABLE = ['PENDING', 'SCHEDULED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'AT_PICKUP'];

function Rating({ onSubmit }: { onSubmit: (rating: number) => Promise<void> }) {
  const [value, setValue] = useState(0);
  const [sent, setSent] = useState(false);
  if (sent) return <p className="text-sm text-success">Obrigado pela avaliação!</p>;
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Avaliar entregador">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} estrela(s)`}
          onClick={() => {
            setValue(star);
            void onSubmit(star).then(() => setSent(true));
          }}
        >
          <Star className={cn('h-7 w-7', star <= value ? 'fill-warning text-warning' : 'text-muted')} />
        </button>
      ))}
    </div>
  );
}

/** Acompanhamento da entrega: status, mapa em tempo real, código de confirmação e histórico. */
export function DeliveryDetail({ path, canCancel = true, canReview = true }: { path: string; canCancel?: boolean; canReview?: boolean }) {
  const toast = useToast();
  const { data, error, isLoading, refetch } = useApi<DeliveryView>(path);
  const [liveDriver, setLiveDriver] = useState<{ lat: number; lng: number } | null>(null);
  const [canceling, setCanceling] = useState(false);
  const { data: tracking } = useApi<{ lat: number; lng: number }[]>(data && data.status !== 'PENDING' ? `${path}/tracking` : null, undefined, { refetchInterval: data && ACTIVE.includes(data.status) ? 15_000 : false });

  useRealtime({
    'delivery.updated': (payload: { deliveryId: string }) => payload.deliveryId === data?.id && void refetch(),
    'delivery.location': (payload: { deliveryId: string; lat: number; lng: number }) => payload.deliveryId === data?.id && setLiveDriver({ lat: payload.lat, lng: payload.lng }),
  });

  const markers = useMemo<MapMarker[]>(() => {
    if (!data) return [];
    const list: MapMarker[] = [
      { id: 'pickup', lat: data.pickup.lat, lng: data.pickup.lng, kind: 'pickup', label: 'Coleta' },
      { id: 'dropoff', lat: data.dropoff.lat, lng: data.dropoff.lng, kind: 'dropoff', label: 'Destino' },
    ];
    const driver = liveDriver ?? data.driverLocation;
    if (driver && ACTIVE.includes(data.status)) list.push({ id: 'driver', lat: driver.lat, lng: driver.lng, kind: 'driver', label: data.driver?.name ?? 'Entregador' });
    return list;
  }, [data, liveDriver]);

  if (isLoading) return <SkeletonRows rows={6} />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  const done = ['DELIVERED', 'FAILED', 'CANCELED'].includes(data.status);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted">Entrega {data.code}</p>
              <p className="text-xl font-bold">{DELIVERY_STATUS_LABELS[data.status]}</p>
              {data.estimatedArrivalAt && !done && <p className="text-sm text-muted">Previsão de chegada: {formatDateTime(data.estimatedArrivalAt)}</p>}
              {data.scheduledFor && data.status === 'SCHEDULED' && <p className="text-sm text-muted">Agendada para {formatDateTime(data.scheduledFor)}</p>}
              {(data.cancelReason || data.failReason) && <p className="mt-1 text-sm text-danger">{data.cancelReason ?? data.failReason}</p>}
            </div>
            {canCancel && data.kind === 'ON_DEMAND' && CANCELABLE.includes(data.status) && (
              <Button variant="secondary" onClick={() => setCanceling(true)}>
                Cancelar entrega
              </Button>
            )}
          </div>
        </Card>
        <LiveMap markers={markers} path={(tracking ?? []).map((point) => [point.lat, point.lng] as [number, number])} height={340} />
        <Card title="Histórico">
          <ol className="relative space-y-3 border-l border-border pl-5">
            {data.timeline.map((entry, index) => (
              <li key={index}>
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-surface bg-brand-500" aria-hidden />
                <p className="text-sm font-medium">{DELIVERY_STATUS_LABELS[entry.status]}</p>
                <p className="text-xs text-muted">
                  {formatDateTime(entry.at)}
                  {entry.reason ? ` · ${entry.reason}` : ''}
                </p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      <aside className="space-y-4">
        {data.dropoffCode && data.qrCodePayload && (
          <Card title="Confirmação de recebimento">
            <p className="mb-3 text-sm text-muted">Informe o código ao entregador ou mostre o QR code no momento da entrega.</p>
            <p className="mb-4 text-center text-4xl font-extrabold tracking-[0.3em] tabular-nums">{data.dropoffCode}</p>
            <div className="mx-auto w-fit rounded-lg bg-white p-3">
              <QRCode value={data.qrCodePayload} size={140} />
            </div>
            <p className="mt-3 text-xs text-muted">Comprovação exigida: {PROOF_METHOD_LABELS[data.proofMethod]}.</p>
          </Card>
        )}
        {data.driver && (
          <Card title="Entregador">
            <p className="font-semibold">
              {data.driver.name} <span className="text-sm font-normal text-muted">★ {data.driver.rating ? data.driver.rating.toFixed(1) : 'novo'}</span>
            </p>
            {data.driver.vehicle && (
              <p className="text-sm text-muted">
                {VEHICLE_TYPE_LABELS[data.driver.vehicle.type as keyof typeof VEHICLE_TYPE_LABELS]} {data.driver.vehicle.brand} {data.driver.vehicle.model}
                {data.driver.vehicle.color ? ` · ${data.driver.vehicle.color}` : ''} {data.driver.vehicle.plate && <Badge>{data.driver.vehicle.plate}</Badge>}
              </p>
            )}
            {canReview && data.status === 'DELIVERED' && (
              <div className="mt-3">
                <p className="mb-1 text-sm">Como foi a entrega?</p>
                <Rating onSubmit={(rating) => api.post(`${path}/review`, { rating }).then(() => undefined).catch((err) => { toast.error(err); throw err; })} />
              </div>
            )}
          </Card>
        )}
        <Card title="Detalhes">
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs text-muted">Coleta</dt>
              <dd>
                {data.pickup.name ? `${data.pickup.name} — ` : ''}
                {data.pickup.street}, {data.pickup.number} · {data.pickup.city}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Entrega</dt>
              <dd>
                {data.dropoff.name ? `${data.dropoff.name} — ` : ''}
                {data.dropoff.street}, {data.dropoff.number} · {data.dropoff.city}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Item</dt>
              <dd>{ITEM_CATEGORY_LABELS[data.itemCategory as ItemCategory] ?? data.itemCategory}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Distância</dt>
              <dd>{data.distanceKm} km</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>Valor</dt>
              <dd className="tabular-nums">{formatBRL(data.feeCents + data.tipCents)}</dd>
            </div>
          </dl>
          <p className="mt-3 break-all text-xs text-muted">
            Link de rastreio para o destinatário: <span className="font-mono">{typeof window !== 'undefined' ? window.location.origin : ''}{data.trackingPath}</span>
          </p>
        </Card>
      </aside>
      {canceling && (
        <ConfirmDialog
          open
          onClose={() => setCanceling(false)}
          onConfirm={async (reason) => {
            await api.post(`${path}/cancel`, { reason });
            toast.success('Entrega cancelada.');
            await refetch();
          }}
          title="Cancelar entrega?"
          confirmLabel="Cancelar entrega"
          tone="danger"
          reason={{ label: 'Motivo', required: true }}
        />
      )}
    </div>
  );
}
