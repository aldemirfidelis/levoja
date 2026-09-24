import { router } from 'expo-router';

/** Destino ao tocar num push ou numa notificação: conversa, chamado, pedido ou entrega. */
export function openFromNotification(data: Record<string, unknown>) {
  if (typeof data.conversationId === 'string') router.push(`/conversa/${data.conversationId}`);
  else if (typeof data.ticketId === 'string') router.push(`/ajuda/${data.ticketId}`);
  else if (typeof data.orderId === 'string') router.push(`/pedido/${data.orderId}`);
  else if (typeof data.deliveryId === 'string') router.push(`/entrega/${data.deliveryId}`);
}
