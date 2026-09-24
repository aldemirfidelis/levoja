import { FlatList, RefreshControl, View } from 'react-native';
import { router } from 'expo-router';
import { DELIVERY_STATUS_LABELS } from '@levoja/shared';
import { Badge, Card, EmptyState, ErrorView, formatBRL, formatDateTime, Loading, Row, space, Text, useColors, useInfiniteApi } from '@levoja/mobile-kit';
import { useDriver } from '@/lib/driver';
import type { DriverDelivery } from '@/lib/types';

export default function HistoryTab() {
  const colors = useColors();
  const { dashboard } = useDriver();
  const list = useInfiniteApi<DriverDelivery>('drivers/me/deliveries', { scope: 'finished' });

  const header = (
    <View style={{ gap: space(3), marginBottom: space(3) }}>
      <Row gap={3}>
        {(['week', 'month'] as const).map((period) => (
          <Card key={period} style={{ flex: 1 }}>
            <Text variant="caption" tone="muted">
              {period === 'week' ? 'Esta semana' : 'Este mês'}
            </Text>
            <Text variant="heading">{formatBRL(dashboard?.earnings[period].cents ?? 0)}</Text>
            <Text variant="caption" tone="muted">
              {dashboard?.earnings[period].deliveries ?? 0} entrega(s)
            </Text>
          </Card>
        ))}
      </Row>
      <Card>
        <Row justify="space-between">
          <Text tone="muted">Entregas concluídas</Text>
          <Text weight="700">{dashboard?.completedDeliveries ?? 0}</Text>
        </Row>
        <Row justify="space-between">
          <Text tone="muted">Taxa de aceite</Text>
          <Text weight="700">{dashboard?.acceptanceRate != null ? `${dashboard.acceptanceRate}%` : '—'}</Text>
        </Row>
        <Row justify="space-between">
          <Text tone="muted">Cancelamentos</Text>
          <Text weight="700">{dashboard?.cancellationRate != null ? `${dashboard.cancellationRate}%` : '—'}</Text>
        </Row>
      </Card>
    </View>
  );

  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorView error={list.error} onRetry={() => list.refetch()} />;
  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      data={list.items}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      contentContainerStyle={{ padding: space(4), gap: space(3) }}
      refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => list.refetch()} tintColor={colors.brand} colors={[colors.brand]} />}
      onEndReached={() => list.hasNextPage && list.fetchNextPage()}
      ListEmptyComponent={<EmptyState icon="history" title="Nenhuma entrega concluída" description="Suas entregas finalizadas aparecem aqui." />}
      renderItem={({ item }) => (
        <Card onPress={() => router.push(`/entrega/${item.id}`)}>
          <Row justify="space-between">
            <Text weight="700">
              {item.company?.tradeName ?? 'Avulsa'} · {item.code}
            </Text>
            <Badge label={DELIVERY_STATUS_LABELS[item.status]} tone={item.status === 'DELIVERED' ? 'success' : 'danger'} />
          </Row>
          <Row justify="space-between" style={{ marginTop: 4 }}>
            <Text variant="caption" tone="muted">
              {formatDateTime(item.deliveredAt ?? item.createdAt)} · {item.distanceKm.toLocaleString('pt-BR')} km
            </Text>
            <Text weight="600" tone="success">
              {item.status === 'DELIVERED' ? formatBRL(item.payoutCents + item.tipCents) : '—'}
            </Text>
          </Row>
        </Card>
      )}
    />
  );
}
