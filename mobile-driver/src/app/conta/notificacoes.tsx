import { router } from 'expo-router';
import { NotificationsScreen } from '@levoja/mobile-kit';

export default function Notifications() {
  return (
    <NotificationsScreen
      onOpen={(notification) => {
        const data = notification.data ?? {};
        if (typeof data.deliveryId === 'string' && notification.type !== 'delivery.offer') router.push(`/entrega/${data.deliveryId}`);
        else if (typeof data.withdrawalId === 'string') router.navigate('/ganhos');
      }}
    />
  );
}
