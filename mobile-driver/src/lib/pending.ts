import type { DeliveryStatus } from '@levoja/shared';
import type { OutboxItem } from '@levoja/mobile-kit';
import type { DeliveryAction } from './outbox';

const AFTER: Record<DeliveryAction, DeliveryStatus> = { 'arrived-pickup': 'AT_PICKUP', 'picked-up': 'PICKED_UP', 'start-route': 'IN_TRANSIT', 'arrived-dropoff': 'AT_DROPOFF' };

/** Ações ainda não enviadas desta entrega (fila offline). */
export function pendingFor(items: readonly OutboxItem[], deliveryId: string): OutboxItem[] {
  return items.filter((item) => item.kind !== 'locations' && (item.payload as { deliveryId?: string }).deliveryId === deliveryId);
}

/** Status que a tela deve mostrar: o do servidor + as ações feitas sem internet, na ordem. */
export function effectiveStatus(serverStatus: DeliveryStatus, pending: readonly OutboxItem[]): DeliveryStatus {
  let status = serverStatus;
  for (const item of pending) {
    if (item.kind === 'action') status = AFTER[(item.payload as { action: DeliveryAction }).action] ?? status;
    if (item.kind === 'deliver') status = 'DELIVERED';
    if (item.kind === 'fail') status = 'FAILED';
  }
  return status;
}
