import { useEffect, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { brandColors, Button, EmptyState, ErrorView, Field, Icon, Loading, type Paginated, Row, space, Text, useApi, useAuth, useColors, useInfiniteApi, useInvalidate, useIsDark } from '@levoja/mobile-kit';
import { AddressSelector } from '@/components/address-selector';
import { CartBar } from '@/components/cart-bar';
import { HomeSections } from '@/components/home-sections';
import { ProductFeedCard } from '@/components/product-feed-card';
import { ProductSheet } from '@/components/product-sheet';
import { StoreCard } from '@/components/store-card';
import { useStoreCoupons } from '@/components/store-coupons';
import { useAddress } from '@/lib/address';
import { categoryArt, type CategoryArt, categoryTint, segmentArtKey } from '@/lib/category-art';
import type { FeedItem, Segment, StoreCard as Store } from '@/lib/types';

const PAGE_PADDING = space(4);
const TILE_GAP = space(2.5);
/** Bloco da categoria: retangular (mais largo que alto), como no layout aprovado. */
const TILE_RATIO = 0.74;

type HomeRow = { kind: 'product'; item: FeedItem } | { kind: 'heading'; title: string } | { kind: 'store'; item: Store };

function greeting(date = new Date()): string {
  const hour = date.getHours();
  return hour >= 5 && hour < 12 ? 'Bom dia' : hour >= 12 && hour < 18 ? 'Boa tarde' : 'Boa noite';
}

/** Colunas da grade de categorias: 4 no celular, mais em telas largas (tablet, celular deitado). */
function useCategoryColumns() {
  const { width } = useWindowDimensions();
  const available = width - PAGE_PADDING * 2;
  const columns = Math.min(8, Math.max(4, Math.floor((available + TILE_GAP) / (84 + TILE_GAP))));
  // Arredonda para baixo: somas com fração podem passar da largura e jogar o último bloco para a linha de baixo.
  return { columns, tileWidth: Math.floor((available - TILE_GAP * (columns - 1)) / columns) };
}

/** Categoria do início: ilustração 3D num bloco com a cor pastel da categoria e o nome embaixo. */
function CategoryTile({ art, label, width, selected, onPress }: { art: CategoryArt; label: string; width: number; selected?: boolean; onPress: () => void }) {
  const colors = useColors();
  const dark = useIsDark();
  const height = Math.round(width * TILE_RATIO);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ width, alignItems: 'center', gap: space(2), opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}
    >
      <View
        style={{
          width,
          height,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: categoryTint(art, dark),
          borderWidth: 2,
          borderColor: selected ? colors.brand : 'transparent',
        }}
      >
        <Image source={categoryArt(art)} style={{ width: height * 0.72, height: height * 0.72 }} resizeMode="contain" accessibilityIgnoresInvertColors />
      </View>
      <Text weight={selected ? '800' : '600'} tone={selected ? 'brand' : 'default'} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ fontSize: 14, lineHeight: 18 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Sino dos avisos, com ponto quando há notificação não lida. */
function NotificationBell() {
  const colors = useColors();
  const notifications = useApi<{ unread: number }>('me/notifications', { pageSize: 1 });
  const unread = notifications.data?.unread ?? 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread ? `Avisos, ${unread} não lido(s)` : 'Avisos'}
      onPress={() => router.push('/conta/notificacoes')}
      style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandSoft, opacity: pressed ? 0.8 : 1 })}
    >
      <Icon name="bell" size={22} color={colors.brand} />
      {unread ? <View style={{ position: 'absolute', top: 11, right: 12, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand, borderWidth: 2, borderColor: colors.brandSoft }} /> : null}
    </Pressable>
  );
}

/** Título de seção da lista (ex.: "Lojas perto de você" depois dos destaques). */
function SectionTitle({ title, star }: { title: string; star?: boolean }) {
  return (
    <Row gap={2}>
      {star ? <Icon name="star" size={22} color={brandColors.gema} /> : null}
      <Text variant="title">{title}</Text>
    </Row>
  );
}

export default function Home() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { me } = useAuth();
  const firstName = me?.user.name.trim().split(/\s+/)[0];
  const { selected, isLoading: loadingAddresses } = useAddress();
  const [segment, setSegment] = useState('');
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<FeedItem | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), 400);
    return () => clearTimeout(timer);
  }, [text]);

  const segments = useApi<Segment[]>('segments', undefined, { staleTime: 10 * 60_000 });
  const marketplace = (segments.data ?? []).filter((item) => item.kind === 'MARKETPLACE');
  const onDemand = (segments.data ?? []).filter((item) => item.kind === 'ON_DEMAND');
  const filters = { addressId: selected?.id, segment, search };
  // Destaques escolhidos pelas lojas (até 3 por loja): cabem numa página só.
  const feed = useApi<Paginated<FeedItem>>(selected ? 'feed/products' : null, { ...filters, pageSize: 60 });
  const stores = useInfiniteApi<Store>(selected ? 'stores' : null, filters);
  const invalidate = useInvalidate();
  const { tileWidth } = useCategoryColumns();
  const couponsByStore = useStoreCoupons();

  // Tela principal: destaques (foto grande) no topo e, embaixo, todas as lojas que atendem o endereço.
  const featured = feed.error ? [] : (feed.data?.data ?? []);
  const rows: HomeRow[] = [
    ...featured.map((item): HomeRow => ({ kind: 'product', item })),
    ...(featured.length && stores.items.length ? [{ kind: 'heading', title: search ? 'Lojas' : 'Lojas perto de você' } as HomeRow] : []),
    ...stores.items.map((item): HomeRow => ({ kind: 'store', item })),
  ];
  const firstTitle = featured.length ? (search ? `Destaques para "${search}"` : 'Destaques') : search ? `Resultados para "${search}"` : 'Perto de você';

  const header = (
    <View style={{ gap: space(5), paddingTop: insets.top + space(3), paddingBottom: space(2) }}>
      <Row justify="space-between" gap={3}>
        <View style={{ flex: 1 }}>
          <AddressSelector />
        </View>
        <NotificationBell />
      </Row>
      <Text variant="brand">
        {greeting()}
        {firstName ? `, ${firstName}` : ''}!{'\n'}O que vai ser hoje?
      </Text>
      <Field value={text} onChangeText={setText} placeholder="Pratos, lojas, mercados..." returnKeyType="search" right={<Icon name="search" size={20} color={colors.muted} />} />
      {/* Grade: todas as categorias à vista, 4 por linha no celular. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: TILE_GAP, rowGap: space(3.5) }}>
        {marketplace.map((item) => (
          <CategoryTile
            key={item.id}
            art={segmentArtKey(item)}
            label={item.name}
            width={tileWidth}
            selected={segment === item.slug}
            onPress={() => setSegment(segment === item.slug ? '' : item.slug)}
          />
        ))}
        {onDemand.length ? <CategoryTile art="package" label="Avulsa" width={tileWidth} onPress={() => router.push('/enviar')} /> : null}
      </View>
      {selected && !search && !segment ? <HomeSections addressId={selected.id} /> : null}
      <SectionTitle title={firstTitle} star={featured.length > 0} />
    </View>
  );

  if (loadingAddresses) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={selected ? rows : []}
        keyExtractor={(row) => (row.kind === 'product' ? `p-${row.item.product.id}` : row.kind === 'store' ? `s-${row.item.id}` : `h-${row.title}`)}
        renderItem={({ item: row }) =>
          row.kind === 'product' ? (
            // Em tablets o card não passa de 560 px (a foto ficaria enorme).
            <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center' }}>
              <ProductFeedCard item={row.item} coupons={couponsByStore.get(row.item.store.id)} onPress={() => setOpen(row.item)} />
            </View>
          ) : row.kind === 'heading' ? (
            <View style={{ paddingTop: space(4) }}>
              <SectionTitle title={row.title} />
            </View>
          ) : (
            <StoreCard store={row.item} />
          )
        }
        ItemSeparatorComponent={({ leadingItem }: { leadingItem?: HomeRow }) => <View style={{ height: leadingItem?.kind === 'product' ? space(5) : space(3) }} />}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: PAGE_PADDING, paddingBottom: space(28) }}
        onEndReachedThreshold={0.5}
        onEndReached={() => stores.hasNextPage && !stores.isFetchingNextPage && stores.fetchNextPage()}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching || stores.isRefetching}
            onRefresh={() => {
              void feed.refetch();
              void stores.refetch();
              void invalidate('me/home', 'me/favorites', 'me/coupons');
            }}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
        ListEmptyComponent={
          !selected ? (
            <EmptyState icon="location" title="Onde vamos entregar?" description="Cadastre seu endereço para ver as lojas que atendem sua região." action={<Button title="Adicionar endereço" onPress={() => router.push('/enderecos/editar')} />} />
          ) : feed.isLoading || stores.isLoading ? (
            <Loading />
          ) : stores.error ? (
            <ErrorView error={stores.error} onRetry={() => stores.refetch()} />
          ) : (
            <EmptyState icon="store" title="Nada encontrado" description={search ? 'Tente outro termo de busca.' : 'Ainda não há lojas atendendo este endereço nesta categoria.'} />
          )
        }
        ListFooterComponent={stores.isFetchingNextPage ? <Loading /> : null}
      />
      <CartBar />
      <ProductSheet product={open?.product ?? null} store={open?.store} coupons={open ? couponsByStore.get(open.store.id) : undefined} onClose={() => setOpen(null)} />
    </View>
  );
}
