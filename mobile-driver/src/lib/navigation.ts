import { Linking, Platform } from 'react-native';
import { router } from 'expo-router';

/** Abre o destino em outro app de mapas (Waze, Google Maps, Apple Maps...) — alternativa à navegação do app. */
export function openExternalNavigation(stop: { lat: number; lng: number; street: string; number: string }) {
  const label = encodeURIComponent(`${stop.street}, ${stop.number}`);
  const url = Platform.OS === 'ios' ? `http://maps.apple.com/?daddr=${stop.lat},${stop.lng}&q=${label}` : `geo:${stop.lat},${stop.lng}?q=${stop.lat},${stop.lng}(${label})`;
  Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`));
}

/** Destino ao tocar num push ou numa notificação do app do entregador. */
export function openFromNotification(data: Record<string, unknown>, type?: string) {
  const kind = type ?? (typeof data.type === 'string' ? data.type : undefined);
  if (typeof data.conversationId === 'string') router.push(`/conversa/${data.conversationId}`);
  else if (typeof data.ticketId === 'string') router.push(`/ajuda/${data.ticketId}`);
  else if (kind === 'delivery.offer') router.navigate('/');
  else if (typeof data.deliveryId === 'string') router.push(`/entrega/${data.deliveryId}`);
  else if (typeof data.withdrawalId === 'string') router.navigate('/ganhos');
  else if (typeof data.invitationId === 'string' || kind?.startsWith('fleet.')) router.push('/conta/frota');
  else if (typeof data.referralId === 'string') router.push('/conta/indique');
}
