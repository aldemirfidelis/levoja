import { router } from 'expo-router';

/** Destino ao tocar num push ou numa notificação do app do entregador. */
export function openFromNotification(data: Record<string, unknown>, type?: string) {
  const kind = type ?? (typeof data.type === 'string' ? data.type : undefined);
  if (typeof data.conversationId === 'string') router.push(`/conversa/${data.conversationId}`);
  else if (typeof data.ticketId === 'string') router.push(`/ajuda/${data.ticketId}`);
  else if (kind === 'delivery.offer') router.navigate('/');
  else if (typeof data.deliveryId === 'string') router.push(`/entrega/${data.deliveryId}`);
  else if (typeof data.withdrawalId === 'string') router.navigate('/ganhos');
}
