import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Chip, EmptyState, ErrorView, Field, Icon, Loading, Row, space, Text, useApi, useColors, useInfiniteApi } from '@levoja/mobile-kit';
import { AddressSelector } from '@/components/address-selector';
import { CartBar } from '@/components/cart-bar';
import { StoreCard } from '@/components/store-card';
import { useAddress } from '@/lib/address';
import type { Segment, StoreCard as Store } from '@/lib/types';

const ON_DEMAND_CATEGORY: Record<string, string> = { documentos: 'DOCUMENT', encomendas: 'PACKAGE', 'entrega-expressa': 'PACKAGE' };

export default function Home() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { selected, isLoading: loadingAddresses } = useAddress();
  const [segment, setSegment] = useState('');
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), 400);
    return () => clearTimeout(timer);
  }, [text]);

  const segments = useApi<Segment[]>('segments', undefined, { staleTime: 10 * 60_000 });
  const marketplace = (segments.data ?? []).filter((item) => item.kind === 'MARKETPLACE');
  const onDemand = (segments.data ?? []).filter((item) => item.kind === 'ON_DEMAND');
  const stores = useInfiniteApi<Store>(selected ? 'stores' : null, { addressId: selected?.id, segment, search });

  const header = (
    <View style={{ gap: space(4), paddingTop: insets.top + space(3), paddingBottom: space(2) }}>
      <AddressSelector />
      <Field value={text} onChangeText={setText} placeholder="Buscar lojas e produtos" returnKeyType="search" right={<Icon name="search" size={20} color={colors.muted} />} />
      {onDemand.length ? (
        <Card onPress={() => router.push('/enviar')}>
          <Row gap={3}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="send" size={22} color={colors.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text weight="700">Precisa enviar algo?</Text>
              <Text variant="caption" tone="muted">
                {onDemand.map((item) => item.name).join(' · ')}
              </Text>
            </View>
            <Icon name="chevronRight" size={18} color={colors.muted} />
          </Row>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2), paddingTop: space(3) }}>
            {onDemand.map((item) => (
              <Chip key={item.id} label={item.name} onPress={() => router.push({ pathname: '/enviar', params: { categoria: ON_DEMAND_CATEGORY[item.slug] ?? 'PACKAGE' } })} />
            ))}
          </ScrollView>
        </Card>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2) }}>
        <Chip label="Tudo" selected={!segment} onPress={() => setSegment('')} />
        {marketplace.map((item) => (
          <Chip key={item.id} label={item.name} selected={segment === item.slug} onPress={() => setSegment(segment === item.slug ? '' : item.slug)} />
        ))}
      </ScrollView>
      <Text variant="heading">{search ? `Resultados para "${search}"` : 'Lojas perto de você'}</Text>
    </View>
  );

  if (loadingAddresses) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={selected ? stores.items : []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <StoreCard store={item} />}
        ItemSeparatorComponent={() => <View style={{ height: space(3) }} />}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(28) }}
        onEndReachedThreshold={0.4}
        onEndReached={() => stores.hasNextPage && !stores.isFetchingNextPage && stores.fetchNextPage()}
        refreshControl={<RefreshControl refreshing={stores.isRefetching} onRefresh={() => stores.refetch()} tintColor={colors.brand} colors={[colors.brand]} />}
        ListEmptyComponent={
          !selected ? (
            <EmptyState icon="location" title="Onde vamos entregar?" description="Cadastre seu endereço para ver as lojas que atendem sua região." action={<Button title="Adicionar endereço" onPress={() => router.push('/enderecos/editar')} />} />
          ) : stores.isLoading ? (
            <Loading />
          ) : stores.error ? (
            <ErrorView error={stores.error} onRetry={() => stores.refetch()} />
          ) : (
            <EmptyState icon="store" title="Nenhuma loja encontrada" description={search ? 'Tente outro termo de busca.' : 'Ainda não há lojas atendendo este endereço nesta categoria.'} />
          )
        }
        ListFooterComponent={stores.isFetchingNextPage ? <Loading /> : null}
      />
      <CartBar />
    </View>
  );
}
