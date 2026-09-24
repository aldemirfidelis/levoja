import { View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DELIVERY_STATUS_LABELS } from '@levoja/shared';
import { Badge, Button, Card, formatBRL, Icon, LiveMap, Row, Screen, space, Stack, Text, useApi, useColors, type MapPoint } from '@levoja/mobile-kit';
import { OfferModal } from '@/components/offer-modal';
import { usePersistentApi } from '@/lib/cache';
import { useDriver } from '@/lib/driver';
import { lastKnownPoint } from '@/lib/location';
import type { ActiveRoute, WalletOverview } from '@/lib/types';

export default function Home() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const driver = useDriver();
  const route = usePersistentApi<ActiveRoute>('drivers/me/route', undefined, { refetchInterval: driver.online ? 20_000 : false });
  const wallet = useApi<WalletOverview>('drivers/me/wallet');
  const me = lastKnownPoint();
  const deliveries = route.data?.deliveries ?? [];
  const points: MapPoint[] = [
    ...(me ? [{ id: 'me', kind: 'me' as const, lat: me.lat, lng: me.lng }] : []),
    ...(route.data?.stops ?? []).map((stop, index) => ({ id: `${stop.deliveryId}-${stop.type}-${index}`, kind: stop.type === 'PICKUP' ? ('pickup' as const) : ('dropoff' as const), lat: stop.lat, lng: stop.lng, label: stop.label })),
  ];
  const offer = driver.offers[0] ?? null;
  const today = driver.dashboard?.earnings.today;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <Screen refreshing={route.isRefetching} onRefresh={() => { driver.refresh(); void route.refetch(); }}>
        <Card>
          <Stack gap={3}>
            <Row justify="space-between">
              <View>
                <Text variant="heading">{driver.online ? 'Você está online' : 'Você está offline'}</Text>
                <Text variant="caption" tone="muted">
                  {driver.online
                    ? driver.trackingMode === 'foreground'
                      ? 'GPS ativo com o app aberto'
                      : 'Recebendo ofertas próximas'
                    : 'Fique online para receber entregas'}
                </Text>
              </View>
              <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: driver.online ? colors.success : colors.border }} />
            </Row>
            {driver.online ? (
              <Button title="Ficar offline" variant="secondary" icon="power" onPress={driver.goOffline} loading={driver.busy} disabled={deliveries.length > 0} />
            ) : (
              <Button title="Ficar online" icon="power" size="lg" onPress={driver.goOnline} loading={driver.busy} />
            )}
            {deliveries.length > 0 && driver.online ? (
              <Text variant="caption" tone="muted">
                Conclua as entregas em andamento para ficar offline.
              </Text>
            ) : null}
            {driver.pendingSync ? (
              <Row gap={2}>
                <Icon name="offline" size={16} color={colors.warning} />
                <Text variant="caption" tone="warning">
                  {driver.pendingSync} ação(ões) aguardando conexão
                </Text>
              </Row>
            ) : null}
            {route.stale ? <Text variant="caption" tone="warning">Mostrando a última rota salva (sem conexão).</Text> : null}
          </Stack>
        </Card>

        {wallet.data?.cashLimitReached ? (
          <Card onPress={() => router.navigate('/ganhos')}>
            <Row gap={3}>
              <Icon name="alert" color={colors.danger} />
              <View style={{ flex: 1 }}>
                <Text weight="700" tone="danger">
                  Limite de dinheiro em mãos atingido
                </Text>
                <Text variant="caption" tone="muted">
                  Quite {formatBRL(wallet.data.debtCents)} para voltar a receber pedidos pagos em dinheiro.
                </Text>
              </View>
            </Row>
          </Card>
        ) : null}

        {points.length ? <LiveMap points={points} follow={me ? 'me' : undefined} height={220} /> : null}

        {deliveries.map((delivery) => (
          <Card key={delivery.id} onPress={() => router.push(`/entrega/${delivery.id}`)}>
            <Row justify="space-between">
              <Text weight="700">
                {delivery.company?.tradeName ?? 'Entrega avulsa'} · {delivery.code}
              </Text>
              <Badge label={DELIVERY_STATUS_LABELS[delivery.status]} tone="brand" />
            </Row>
            <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
              {['DRIVER_ASSIGNED', 'AT_PICKUP'].includes(delivery.status) ? `Coletar em ${delivery.pickup.street}, ${delivery.pickup.number}` : `Entregar em ${delivery.dropoff.street}, ${delivery.dropoff.number}`}
            </Text>
            <Text weight="600" tone="success" style={{ marginTop: 4 }}>
              {formatBRL(delivery.payoutCents + delivery.tipCents)}
            </Text>
          </Card>
        ))}

        <Row gap={3}>
          <Card style={{ flex: 1 }}>
            <Text variant="caption" tone="muted">
              Hoje
            </Text>
            <Text variant="heading">{formatBRL(today?.cents ?? 0)}</Text>
            <Text variant="caption" tone="muted">
              {today?.deliveries ?? 0} entrega(s)
            </Text>
          </Card>
          <Card style={{ flex: 1 }}>
            <Text variant="caption" tone="muted">
              Avaliação
            </Text>
            <Text variant="heading">{driver.dashboard?.rating.count ? `★ ${driver.dashboard.rating.average.toFixed(1)}` : '—'}</Text>
            <Text variant="caption" tone="muted">
              Aceite {driver.dashboard?.acceptanceRate != null ? `${driver.dashboard.acceptanceRate}%` : '—'}
            </Text>
          </Card>
        </Row>
        <View style={{ height: space(4) }} />
      </Screen>
      <OfferModal offer={offer} />
    </View>
  );
}
