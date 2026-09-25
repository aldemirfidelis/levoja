import { useMemo, useState } from 'react';
import { Image, Pressable, SectionList, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Badge, EmptyState, ErrorView, formatBRL, Icon, Loading, radius, Row, space, Text, useApi, useColors } from '@levoja/mobile-kit';
import { CartBar } from '@/components/cart-bar';
import { ProductSheet } from '@/components/product-sheet';
import { FavoriteButton } from '@/components/favorite-button';
import type { Product, StoreDetail } from '@/lib/types';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function ProductRow({ product, onPress }: { product: Product; onPress: () => void }) {
  const colors = useColors();
  const image = product.images[0]?.url;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={!product.available} style={({ pressed }) => ({ flexDirection: 'row', gap: space(3), paddingVertical: space(3), opacity: product.available ? 1 : 0.45, backgroundColor: pressed ? colors.surface2 : 'transparent' })}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text weight="600">{product.name}</Text>
        {product.description ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {product.description}
          </Text>
        ) : null}
        <Row gap={2}>
          <Text weight="700" tone={product.onSale ? 'success' : 'default'}>
            {formatBRL(product.effectivePriceCents)}
          </Text>
          {product.onSale ? (
            <Text variant="caption" tone="muted" style={{ textDecorationLine: 'line-through' }}>
              {formatBRL(product.priceCents)}
            </Text>
          ) : null}
          {!product.available ? <Badge label="Esgotado" /> : null}
          {product.requiresPrescription ? <Badge label="Receita" tone="warning" /> : null}
        </Row>
      </View>
      {image ? <Image source={{ uri: image }} style={{ width: 84, height: 84, borderRadius: radius.md }} accessibilityIgnoresInvertColors /> : null}
    </Pressable>
  );
}

export default function StoreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const store = useApi<StoreDetail>(`stores/${id}`);
  const [product, setProduct] = useState<Product | null>(null);

  const sections = useMemo(() => {
    if (!store.data) return [];
    const list = store.data.categories.filter((category) => category.products.length).map((category) => ({ title: category.name, data: category.products }));
    if (store.data.uncategorized.length) list.push({ title: list.length ? 'Outros' : 'Produtos', data: store.data.uncategorized });
    return list;
  }, [store.data]);

  if (store.isLoading) return <Loading />;
  if (store.error || !store.data) return <ErrorView error={store.error} onRetry={() => store.refetch()} />;
  const data = store.data;
  const today = data.openingHours.filter((hour) => hour.weekday === new Date().getDay());

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: data.tradeName, headerRight: () => <FavoriteButton companyId={data.id} size={24} /> }} />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingBottom: space(28) }}
        ListHeaderComponent={
          <View>
            {data.bannerUrl ? <Image source={{ uri: data.bannerUrl }} style={{ width: '100%', height: 150 }} accessibilityIgnoresInvertColors /> : null}
            <View style={{ padding: space(4), gap: space(2) }}>
              <Row gap={3}>
                {data.logoUrl ? <Image source={{ uri: data.logoUrl }} style={{ width: 56, height: 56, borderRadius: radius.md }} accessibilityIgnoresInvertColors /> : null}
                <View style={{ flex: 1 }}>
                  <Text variant="title">{data.tradeName}</Text>
                  <Text tone="muted">{data.segment.name}{data.address ? ` · ${data.address.district}, ${data.address.city}` : ''}</Text>
                </View>
              </Row>
              <Row gap={3} style={{ flexWrap: 'wrap' }}>
                {data.ratingCount ? (
                  <Row gap={1}>
                    <Icon name="star" size={16} color={colors.warning} />
                    <Text weight="600">{data.ratingAvg.toFixed(1)}</Text>
                    <Text variant="caption" tone="muted">({data.ratingCount})</Text>
                  </Row>
                ) : null}
                <Badge label={data.isOpenNow ? 'Aberta agora' : 'Fechada'} tone={data.isOpenNow ? 'success' : 'danger'} />
                <Text variant="caption" tone="muted">Preparo ~{data.averagePrepMinutes} min</Text>
                {data.minimumOrderCents ? <Text variant="caption" tone="muted">Pedido mín. {formatBRL(data.minimumOrderCents)}</Text> : null}
              </Row>
              {today.length ? (
                <Text variant="caption" tone="muted">
                  Hoje ({WEEKDAYS[new Date().getDay()]}): {today.map((hour) => `${hour.opensAt}–${hour.closesAt}`).join(', ')}
                </Text>
              ) : null}
              {data.description ? <Text tone="muted">{data.description}</Text> : null}
              {!data.isOpenNow ? <Text tone="warning">A loja está fechada agora. Você pode montar a sacola e agendar o pedido.</Text> : null}
            </View>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={{ backgroundColor: colors.bg, paddingHorizontal: space(4), paddingVertical: space(2) }}>
            <Text variant="heading">{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: space(4), borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <ProductRow product={item} onPress={() => setProduct(item)} />
          </View>
        )}
        ListEmptyComponent={<EmptyState icon="bag" title="Cardápio vazio" description="Esta loja ainda não publicou produtos." />}
      />
      <CartBar companyId={data.id} />
      <ProductSheet product={product} onClose={() => setProduct(null)} />
    </View>
  );
}
