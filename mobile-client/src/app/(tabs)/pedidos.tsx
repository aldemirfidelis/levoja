import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { DELIVERY_STATUS_LABELS, ORDER_STATUS_LABELS, type DeliveryStatus, type OrderStatus } from '@levoja/shared';
import { Badge, Card, EmptyState, ErrorView, formatBRL, formatDateTime, Loading, Row, Segmented, space, Text, useColors, useInfiniteApi, type Tone } from '@levoja/mobile-kit';
import type { Delivery, OrderListItem } from '@/lib/types';

const ORDER_TONE: Partial<Record<OrderStatus, Tone>> = { PENDING_PAYMENT: 'warning', DELIVERED: 'success', CANCELED: 'danger' };
const DELIVERY_TONE: Partial<Record<DeliveryStatus, Tone>> = { DELIVERED: 'success', CANCELED: 'danger', FAILED: 'danger', SCHEDULED: 'info' };

export default function OrdersTab() {
  const colors = useColors();
  const [tab, setTab] = useState<'orders' | 'deliveries'>('orders');
  const orders = useInfiniteApi<OrderListItem>(tab === 'orders' ? 'orders' : null);
  const deliveries = useInfiniteApi<Delivery>(tab === 'deliveries' ? 'deliveries' : null);
  const current = tab === 'orders' ? orders : deliveries;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: space(4), paddingBottom: space(2) }}>
        <Segmented value={tab} onChange={setTab} options={[{ value: 'orders', label: 'Pedidos' }, { value: 'deliveries', label: 'Envios' }]} />
      </View>
      {current.isLoading ? (
        <Loading />
      ) : current.error ? (
        <ErrorView error={current.error} onRetry={() => current.refetch()} />
      ) : tab === 'orders' ? (
        <FlatList
          data={orders.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: space(4), gap: space(3) }}
          refreshControl={<RefreshControl refreshing={orders.isRefetching} onRefresh={() => orders.refetch()} tintColor={colors.brand} colors={[colors.brand]} />}
          onEndReached={() => orders.hasNextPage && orders.fetchNextPage()}
          ListEmptyComponent={<EmptyState icon="receipt" title="Nenhum pedido ainda" description="Seus pedidos aparecem aqui, com o acompanhamento em tempo real." />}
          renderItem={({ item }) => (
            <Card onPress={() => router.push(`/pedido/${item.id}`)}>
              <Row justify="space-between">
                <Text weight="700" numberOfLines={1} style={{ flex: 1 }}>
                  {item.company.tradeName}
                </Text>
                <Badge label={ORDER_STATUS_LABELS[item.status]} tone={ORDER_TONE[item.status] ?? 'brand'} />
              </Row>
              <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
                #{item.number} · {formatDateTime(item.createdAt)} · {item.items.reduce((sum, line) => sum + line.quantity, 0)} item(ns)
              </Text>
              <Text weight="600" style={{ marginTop: 4 }}>
                {formatBRL(item.totalCents)}
              </Text>
            </Card>
          )}
        />
      ) : (
        <FlatList
          data={deliveries.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: space(4), gap: space(3) }}
          refreshControl={<RefreshControl refreshing={deliveries.isRefetching} onRefresh={() => deliveries.refetch()} tintColor={colors.brand} colors={[colors.brand]} />}
          onEndReached={() => deliveries.hasNextPage && deliveries.fetchNextPage()}
          ListEmptyComponent={<EmptyState icon="send" title="Nenhum envio" description="Envie documentos e encomendas pela aba Enviar." />}
          renderItem={({ item }) => (
            <Card onPress={() => router.push(`/entrega/${item.id}`)}>
              <Row justify="space-between">
                <Text weight="700">Entrega {item.code}</Text>
                <Badge label={DELIVERY_STATUS_LABELS[item.status]} tone={DELIVERY_TONE[item.status] ?? 'brand'} />
              </Row>
              <Text variant="caption" tone="muted" style={{ marginTop: 4 }} numberOfLines={1}>
                Para {item.dropoff.street}, {item.dropoff.number} · {formatDateTime(item.createdAt)}
              </Text>
              <Text weight="600" style={{ marginTop: 4 }}>
                {formatBRL(item.feeCents + item.tipCents)}
              </Text>
            </Card>
          )}
        />
      )}
    </View>
  );
}
