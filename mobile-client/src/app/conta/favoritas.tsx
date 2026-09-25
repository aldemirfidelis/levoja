import { EmptyState, ErrorView, Loading, Screen, Stack, useApi } from '@levoja/mobile-kit';
import { StoreCard } from '@/components/store-card';
import { useAddress } from '@/lib/address';
import type { StoreCard as Store } from '@/lib/types';

export default function FavoritesScreen() {
  const { selected } = useAddress();
  const favorites = useApi<Store[]>('me/favorites', selected ? { addressId: selected.id } : undefined);
  if (favorites.isLoading) return <Loading />;
  if (favorites.error) return <ErrorView error={favorites.error} onRetry={() => favorites.refetch()} />;
  const list = favorites.data ?? [];
  return (
    <Screen refreshing={favorites.isRefetching} onRefresh={() => void favorites.refetch()}>
      {list.length === 0 ? (
        <EmptyState icon="favoriteOutline" title="Nenhuma loja favorita" description="Toque no coração de uma loja para encontrá-la rápido aqui e no início." />
      ) : (
        <Stack gap={3}>
          {list.map((store) => (
            <StoreCard key={store.id} store={store} />
          ))}
        </Stack>
      )}
    </Screen>
  );
}
