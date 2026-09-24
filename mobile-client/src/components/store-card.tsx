import { Image, View } from 'react-native';
import { router } from 'expo-router';
import { Badge, Card, formatBRL, Icon, radius, Row, space, Text, useColors } from '@levoja/mobile-kit';
import type { StoreCard as Store } from '@/lib/types';

export function StoreCard({ store }: { store: Store }) {
  const colors = useColors();
  return (
    <Card onPress={() => router.push(`/loja/${store.id}`)} padded={false}>
      <Row gap={3} style={{ padding: space(3), opacity: store.isOpenNow ? 1 : 0.6 }} align="flex-start">
        {store.logoUrl ? (
          <Image source={{ uri: store.logoUrl }} style={{ width: 64, height: 64, borderRadius: radius.md }} accessibilityIgnoresInvertColors />
        ) : (
          <View style={{ width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="store" size={28} color={colors.brand} />
          </View>
        )}
        <View style={{ flex: 1, gap: 3 }}>
          <Text weight="700" numberOfLines={1}>
            {store.tradeName}
          </Text>
          <Row gap={2} style={{ flexWrap: 'wrap' }}>
            {store.ratingCount > 0 ? (
              <Row gap={1}>
                <Icon name="star" size={14} color={colors.warning} />
                <Text variant="caption">{store.ratingAvg.toFixed(1)}</Text>
              </Row>
            ) : (
              <Badge label="Novo" tone="brand" />
            )}
            <Text variant="caption" tone="muted">
              {store.segment.name}
              {store.distanceKm != null ? ` · ${store.distanceKm.toLocaleString('pt-BR')} km` : ''}
            </Text>
          </Row>
          <Text variant="caption" tone="muted">
            {store.isOpenNow ? (store.estimatedMinutes ? `${store.estimatedMinutes.min}-${store.estimatedMinutes.max} min` : 'Aberta agora') : 'Fechada no momento'}
            {store.minimumOrderCents ? ` · pedido mín. ${formatBRL(store.minimumOrderCents)}` : ''}
          </Text>
        </View>
      </Row>
    </Card>
  );
}
