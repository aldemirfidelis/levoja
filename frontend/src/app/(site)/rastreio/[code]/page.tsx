'use client';

import { use, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { PackageCheck } from 'lucide-react';
import { DELIVERY_STATUS_LABELS, DeliveryStatus, VEHICLE_TYPE_LABELS, VehicleType } from '@levoja/shared';
import { useApi } from '@levoja/web-kit/client';
import { EmptyState, formatDateTime, SkeletonRows } from '@levoja/web-kit/ui';
import type { MapMarker } from '@levoja/web-kit/map';

const LiveMap = dynamic(() => import('@levoja/web-kit/map').then((module) => module.LiveMap), { ssr: false, loading: () => <div className="h-80 rounded-xl bg-surface-2" /> });

interface PublicTracking {
  code: string;
  status: DeliveryStatus;
  company: string | null;
  driver: { firstName: string; vehicle: VehicleType | null } | null;
  driverLocation: { lat: number; lng: number } | null;
  dropoff: { lat: number; lng: number };
  estimatedArrivalAt: string | null;
  deliveredAt: string | null;
}

const STEPS: DeliveryStatus[] = ['SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'];

/** Página pública de rastreamento (link enviado ao destinatário). Sem dados pessoais. */
export default function PublicTrackingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { data, error, isLoading } = useApi<PublicTracking>(`track/${encodeURIComponent(code)}`, undefined, { refetchInterval: 15_000 });

  const markers = useMemo<MapMarker[]>(() => {
    if (!data) return [];
    const list: MapMarker[] = [{ id: 'dropoff', ...data.dropoff, kind: 'dropoff', label: 'Destino (aproximado)' }];
    if (data.driverLocation) list.push({ id: 'driver', ...data.driverLocation, kind: 'driver', label: 'Entregador' });
    return list;
  }, [data]);

  if (isLoading) return <div className="mx-auto max-w-3xl p-6"><SkeletonRows rows={5} /></div>;
  if (error || !data) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <EmptyState icon={<PackageCheck className="h-8 w-8" />} title="Entrega não encontrada" description="Confira o código de rastreio recebido." />
      </div>
    );
  }

  const current = STEPS.indexOf(data.status === 'AT_PICKUP' ? 'DRIVER_ASSIGNED' : data.status === 'AT_DROPOFF' ? 'IN_TRANSIT' : data.status);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <div>
        <p className="text-sm text-muted">Rastreio {data.code}{data.company ? ` · ${data.company}` : ''}</p>
        <h1 className="text-3xl font-extrabold">{DELIVERY_STATUS_LABELS[data.status]}</h1>
        {data.estimatedArrivalAt && <p className="mt-1 text-muted">Previsão de chegada: {formatDateTime(data.estimatedArrivalAt)}</p>}
        {data.deliveredAt && <p className="mt-1 text-success">Entregue em {formatDateTime(data.deliveredAt)}</p>}
      </div>
      {current >= 0 && (
        <ol className="grid grid-cols-5 gap-2" aria-label="Etapas">
          {STEPS.map((step, index) => (
            <li key={step} className="text-center">
              <div className={`h-2 rounded-full ${index <= current ? 'bg-brand-500' : 'bg-surface-2'}`} />
              <p className={`mt-2 text-xs ${index <= current ? 'text-fg' : 'text-muted'}`}>{DELIVERY_STATUS_LABELS[step]}</p>
            </li>
          ))}
        </ol>
      )}
      <LiveMap markers={markers} height={360} />
      {data.driver && (
        <p className="text-sm text-muted">
          Entregador: <strong className="text-fg">{data.driver.firstName}</strong>
          {data.driver.vehicle && ` · ${VEHICLE_TYPE_LABELS[data.driver.vehicle]}`}
        </p>
      )}
      <p className="text-xs text-muted">Por privacidade, as posições exibidas são aproximadas. Tenha em mãos o código de confirmação enviado pelo remetente.</p>
    </div>
  );
}
