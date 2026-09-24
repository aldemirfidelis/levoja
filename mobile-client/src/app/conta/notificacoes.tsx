import { router } from 'expo-router';
import { NotificationsScreen } from '@levoja/mobile-kit';

export default function Notifications() {
  return (
    <NotificationsScreen
      onOpen={(notification) => {
        const data = notification.data ?? {};
        if (typeof data.orderId === 'string') router.push(`/pedido/${data.orderId}`);
        else if (typeof data.deliveryId === 'string') router.push(`/entrega/${data.deliveryId}`);
      }}
    />
  );
}
