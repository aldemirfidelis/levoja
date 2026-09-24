import { api, Outbox, upload, type LocalFile } from '@levoja/mobile-kit';

export interface LocationPoint {
  lat: number;
  lng: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  recordedAt: string;
}

export type DeliveryAction = 'arrived-pickup' | 'picked-up' | 'start-route' | 'arrived-dropoff';

export interface DeliverPayload {
  deliveryId: string;
  method: 'CODE' | 'QR_CODE' | 'PHOTO' | 'SIGNATURE';
  code?: string;
  recipientName?: string;
  idChecked?: boolean;
  file?: LocalFile;
}

const dropListeners = new Set<(message: string) => void>();
export function onOutboxDrop(listener: (message: string) => void): () => void {
  dropListeners.add(listener);
  return () => dropListeners.delete(listener);
}

export function sendDeliver(payload: DeliverPayload) {
  const { deliveryId, file, ...fields } = payload;
  const path = `drivers/me/deliveries/${deliveryId}/deliver`;
  if (!file) return api.post(path, fields);
  return upload(path, 'file', file, {
    method: fields.method,
    code: fields.code,
    recipientName: fields.recipientName,
    idChecked: fields.idChecked ? 'true' : undefined,
  });
}

/**
 * Fila offline do entregador: posições de GPS (em lotes) e ações das entregas são gravadas no
 * aparelho e enviadas em ordem quando a conexão voltar — nada se perde em áreas sem sinal.
 */
export const outbox = new Outbox(
  'levoja.driver.outbox',
  {
    locations: async (points: LocationPoint[]) => {
      await api.post('drivers/me/locations', { points });
    },
    action: async ({ deliveryId, action }: { deliveryId: string; action: DeliveryAction }) => {
      await api.post(`drivers/me/deliveries/${deliveryId}/${action}`);
    },
    deliver: async (payload: DeliverPayload) => {
      await sendDeliver(payload);
    },
    fail: async ({ deliveryId, reasonCode, details }: { deliveryId: string; reasonCode: string; details?: string }) => {
      await api.post(`drivers/me/deliveries/${deliveryId}/fail`, { reasonCode, details });
    },
  },
  {
    maxItems: 3000,
    onDrop: (item, error) => {
      if (item.kind === 'locations') return;
      const message = error instanceof Error ? error.message : 'Ação recusada pelo servidor.';
      dropListeners.forEach((listener) => listener(`Uma ação feita sem internet não foi aceita: ${message}`));
    },
  },
);

/** Até 200 pontos por lote (a API aceita 500). */
export function enqueuePoints(points: LocationPoint[]) {
  return outbox.enqueue('locations', points, (pending: LocationPoint[]) => (pending.length + points.length <= 200 ? [...pending, ...points] : null));
}
