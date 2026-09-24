import { router, useLocalSearchParams } from 'expo-router';
import { NewTicketScreen } from '@levoja/mobile-kit';

export default function NewTicketRoute() {
  const { orderId, deliveryId, label } = useLocalSearchParams<{ orderId?: string; deliveryId?: string; label?: string }>();
  return <NewTicketScreen as="CUSTOMER" orderId={orderId} deliveryId={deliveryId} referenceLabel={label} onCreated={(id) => router.replace(`/ajuda/${id}`)} />;
}
