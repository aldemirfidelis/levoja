import { useLocalSearchParams } from 'expo-router';
import { TicketScreen } from '@levoja/mobile-kit';

export default function TicketRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TicketScreen id={id} />;
}
