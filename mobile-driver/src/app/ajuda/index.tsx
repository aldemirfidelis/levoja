import { router } from 'expo-router';
import { SupportListScreen } from '@levoja/mobile-kit';

export default function SupportRoute() {
  return <SupportListScreen as="DRIVER" onOpen={(id) => router.push(`/ajuda/${id}`)} onCreate={() => router.push('/ajuda/novo')} />;
}
