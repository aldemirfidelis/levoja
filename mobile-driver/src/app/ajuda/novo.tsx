import { router, useLocalSearchParams } from 'expo-router';
import { NewTicketScreen } from '@levoja/mobile-kit';

export default function NewTicketRoute() {
  const { deliveryId, label } = useLocalSearchParams<{ deliveryId?: string; label?: string }>();
  return <NewTicketScreen as="DRIVER" deliveryId={deliveryId} referenceLabel={label} onCreated={(id) => router.replace(`/ajuda/${id}`)} />;
}
