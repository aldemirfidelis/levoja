import { useId } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { formatBRL, Icon, radius, Row, space, Text, useColors } from '@levoja/mobile-kit';
import { StoreCoupons } from '@/components/store-coupons';
import type { AvailableCoupon, FeedItem, ProductStore } from '@/lib/types';

/** Logo redondo da loja (ou a inicial, sem logo). */
export function StoreAvatar({ store, size = 32 }: { store: Pick<ProductStore, 'tradeName' | 'logoUrl'>; size?: number }) {
  const colors = useColors();
  return store.logoUrl ? (
    <Image source={{ uri: store.logoUrl }} style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1, borderColor: colors.border }} accessibilityIgnoresInvertColors />
  ) : (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Text weight="900" tone="brand" style={{ fontSize: size * 0.45, lineHeight: size * 0.55 }}>
        {store.tradeName.trim()[0]?.toUpperCase()}
      </Text>
    </View>
  );
}

/** Tempo, avaliação e distância da loja numa linha curta. */
export function storeMeta(store: ProductStore): string {
  if (!store.isOpenNow) return 'Fechada agora · agende';
  const parts = [];
  if (store.estimatedMinutes) parts.push(`${store.estimatedMinutes.min}-${store.estimatedMinutes.max} min`);
  if (store.ratingCount) parts.push(`★ ${store.ratingAvg?.toFixed(1)}`);
  if (store.distanceKm != null) parts.push(`${store.distanceKm.toString().replace('.', ',')} km`);
  return parts.join(' · ') || store.segment.name;
}

/**
 * Card da vitrine (destaques) da tela inicial, tudo num só bloco: foto grande do produto com nome e
 * preço sobre ela, a loja (logo, nome, tempo) e, no rodapé, o cupom da loja em verde.
 */
export function ProductFeedCard({ item, coupons, onPress }: { item: FeedItem; coupons?: AvailableCoupon[]; onPress: () => void }) {
  const colors = useColors();
  const { product, store } = item;
  const gradient = `lj-feed-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const image = product.images[0]?.url;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${formatBRL(product.effectivePriceCents)}, de ${store.tradeName}`}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        overflow: 'hidden',
        opacity: pressed ? 0.9 : 1,
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      <View style={{ aspectRatio: 4 / 3, backgroundColor: colors.surface2 }}>
        {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
        {/* Degradê escuro embaixo para o nome e o preço ficarem legíveis sobre qualquer foto. */}
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <LinearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0.45" stopColor="#000" stopOpacity="0" />
              <Stop offset="1" stopColor="#000" stopOpacity="0.72" />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#${gradient})`} />
        </Svg>
        {product.onSale ? (
          <View style={{ position: 'absolute', top: space(3), left: space(3), backgroundColor: colors.brand, borderRadius: radius.full, paddingHorizontal: space(2.5), paddingVertical: 3 }}>
            <Text variant="caption" weight="900" style={{ color: colors.onBrand }}>
              Promoção
            </Text>
          </View>
        ) : null}
        {!store.isOpenNow ? (
          <View style={{ position: 'absolute', top: space(3), right: space(3), backgroundColor: 'rgba(19,26,43,0.8)', borderRadius: radius.full, paddingHorizontal: space(2.5), paddingVertical: 3 }}>
            <Text variant="caption" weight="800" style={{ color: '#fff' }}>
              Fechada · agende
            </Text>
          </View>
        ) : null}
        <View style={{ position: 'absolute', left: space(4), right: space(4), bottom: space(3.5), gap: 2 }}>
          <Text variant="heading" weight="900" numberOfLines={2} style={{ color: '#fff' }}>
            {product.name}
          </Text>
          <Row gap={2}>
            <Text weight="900" style={{ color: '#fff', fontSize: 18, lineHeight: 24 }}>
              {formatBRL(product.effectivePriceCents)}
            </Text>
            {product.onSale ? (
              <Text variant="caption" style={{ color: 'rgba(255,255,255,0.8)', textDecorationLine: 'line-through' }}>
                {formatBRL(product.priceCents)}
              </Text>
            ) : null}
          </Row>
        </View>
      </View>

      <Row gap={3} style={{ paddingHorizontal: space(3.5), paddingVertical: space(3) }}>
        <StoreAvatar store={store} size={36} />
        <View style={{ flex: 1 }}>
          <Text weight="800" numberOfLines={1}>
            {store.tradeName}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {storeMeta(store)}
          </Text>
        </View>
        <Icon name="chevronRight" size={18} color={colors.muted} />
      </Row>
      <StoreCoupons coupons={coupons} variant="footer" />
    </Pressable>
  );
}
