import { NotificationsScreen } from '@levoja/mobile-kit';
import { openFromNotification } from '@/lib/navigation';

export default function Notifications() {
  return <NotificationsScreen onOpen={(notification) => openFromNotification(notification.data ?? {})} />;
}
