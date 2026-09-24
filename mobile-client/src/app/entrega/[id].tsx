import { useState } from 'react';
import { Share, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import QRCode from 'react-qr-code';
import { DELIVERY_STATUS_LABELS, ITEM_CATEGORY_LABELS, PAYMENT_METHOD_LABELS, PROOF_METHOD_LABELS, VEHICLE_TYPE_LABELS, type DeliveryStatus } from '@levoja/shared';
import {
  api,
  Badge,
  Button,
  Card,
  ErrorView,
  formatBRL,
  formatDateTime,
  formatTime,
  kitConfig,
  LiveMap,
  Loading,
  radius,
  ReasonDialog,
  Row,
  Screen,
  Section,
  space,
  Stack,
  Text,
  useApi,
  useColors,
  useRealtimeEvent,
  useToast,
  ValueRow,
  type MapPoint,
  type Tone,
} from '@levoja/mobile-kit';
import { RatingInput } from '@/components/rating';
import type { Delivery } from '@/lib/types';

const CANCELABLE: DeliveryStatus[] = ['PENDING', 'SCHEDULED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'AT_PICKUP'];
const ACTIVE: DeliveryStatus[] = ['PENDING', 'SCHEDULED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'AT_DROPOFF'];
const TONE: Partial<Record<DeliveryStatus, Tone>> = { DELIVERED: 'success', CANCELED: 'danger', FAILED: 'danger', SCHEDULED: 'info' };

export default function DeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const toast = useToast();
  const [canceling, setCanceling] = useState(false);
  const [rating, setRating] = useState(0);
  const [live, setLive] = useState<{ lat: number; lng: number } | null>(null);
  const delivery = useApi<Delivery & { reviewed?: boolean }>(`deliveries/${id}`, undefined, {
    refetchInterval: (query) => (query.state.data && ACTIVE.includes(query.state.data.status) ? 20_000 : false),
  });

  useRealtimeEvent<{ deliveryId: string; lat: number; lng: number }>('delivery.location', (payload) => {
    if (payload.deliveryId === id) setLive({ lat: payload.lat, lng: payload.lng });
  });

  if (delivery.isLoading) return <Loading />;
  if (delivery.error || !delivery.data) return <ErrorView error={delivery.error} onRetry={() => delivery.refetch()} />;
  const data = delivery.data;
  const driverAt = live ?? data.driverLocation;
  const points: MapPoint[] = [
    { id: 'pickup', kind: 'pickup', lat: data.pickup.lat, lng: data.pickup.lng, label: 'Coleta' },
    { id: 'dropoff', kind: 'dropoff', lat: data.dropoff.lat, lng: data.dropoff.lng, label: 'Entrega' },
    ...(driverAt ? [{ id: 'driver', kind: 'driver' as const, lat: driverAt.lat, lng: driverAt.lng, label: data.driver?.name }] : []),
  ];
  const trackingUrl = `${kitConfig().webUrl}${data.trackingPath}`;

  return (
    <Screen refreshing={delivery.isRefetching} onRefresh={() => delivery.refetch()}>
      <Row justify="space-between">
        <Text variant="title">Entrega {data.code}</Text>
        <Badge label={DELIVERY_STATUS_LABELS[data.status]} tone={TONE[data.status] ?? 'brand'} />
      </Row>
      {data.estimatedArrivalAt && ACTIVE.includes(data.status) ? <Text weight="600">Previsão de entrega: {formatTime(data.estimatedArrivalAt)}</Text> : null}
      {data.scheduledFor ? <Text tone="muted">Agendada para {formatDateTime(data.scheduledFor)}</Text> : null}

      {ACTIVE.includes(data.status) ? <LiveMap points={points} follow={driverAt ? 'driver' : undefined} height={240} /> : null}

      {data.driver ? (
        <Card>
          <Row justify="space-between">
            <View>
              <Text weight="700">{data.driver.name}</Text>
              <Text variant="caption" tone="muted">
                {data.driver.vehicle ? `${VEHICLE_TYPE_LABELS[data.driver.vehicle.type]}${data.driver.vehicle.plate ? ` · ${data.driver.vehicle.plate}` : ''}` : 'Entregador'}
              </Text>
            </View>
            {data.driver.rating ? <Badge label={`★ ${data.driver.rating.toFixed(1)}`} tone="warning" /> : null}
          </Row>
        </Card>
      ) : data.status === 'SEARCHING_DRIVER' ? (
        <Card>
          <Text>Procurando um entregador próximo…</Text>
        </Card>
      ) : null}

      {data.dropoffCode ? (
        <Card>
          <Stack gap={3} style={{ alignItems: 'center' }}>
            <Text variant="heading" align="center">
              Confirmação da entrega
            </Text>
            <Text tone="muted" align="center">
              Quem receber deve informar o código {data.proofMethod === 'SIGNATURE' ? 'e assinar na tela do entregador' : 'ao entregador'} ({PROOF_METHOD_LABELS[data.proofMethod]}).
            </Text>
            <Text variant="display" tone="brand" style={{ letterSpacing: 8 }} selectable>
              {data.dropoffCode}
            </Text>
            {data.qrCodePayload ? (
              <View style={{ padding: space(3), backgroundColor: '#ffffff', borderRadius: radius.md }}>
                <QRCode value={data.qrCodePayload} size={150} />
              </View>
            ) : null}
            <Button
              title="Compartilhar com quem recebe"
              icon="upload"
              variant="secondary"
              onPress={() => Share.share({ message: `Acompanhe a entrega ${data.code}: ${trackingUrl}\nCódigo para receber: ${data.dropoffCode}` })}
            />
          </Stack>
        </Card>
      ) : null}

      {data.status === 'DELIVERED' && data.driver && !data.reviewed ? (
        <Card>
          <Stack>
            <Text variant="heading">Avalie o entregador</Text>
            <RatingInput value={rating} onChange={setRating} />
            <Button
              title="Enviar avaliação"
              disabled={!rating}
              onPress={() =>
                api
                  .post(`deliveries/${data.id}/review`, { rating })
                  .then(() => {
                    toast.success('Obrigado pela avaliação!');
                    return delivery.refetch();
                  })
                  .catch(toast.error)
              }
            />
          </Stack>
        </Card>
      ) : null}

      {data.cancelReason || data.failReason ? (
        <Card>
          <Text tone="danger">{data.failReason ?? data.cancelReason}</Text>
        </Card>
      ) : null}

      <Section title="Detalhes">
        <Card>
          <Stack gap={2}>
            <ValueRow label="Coleta" value={`${data.pickup.street}, ${data.pickup.number}`} />
            <ValueRow label="Entrega" value={`${data.dropoff.street}, ${data.dropoff.number}`} />
            <ValueRow label="Item" value={`${ITEM_CATEGORY_LABELS[data.itemCategory]}${data.itemDescription ? ` · ${data.itemDescription}` : ''}`} />
            <ValueRow label="Distância" value={`${data.distanceKm.toLocaleString('pt-BR')} km`} />
            <ValueRow label="Entrega" value={formatBRL(data.feeCents)} />
            {data.tipCents ? <ValueRow label="Gorjeta" value={formatBRL(data.tipCents)} /> : null}
            <ValueRow label="Pagamento" value={data.paymentMethod ? PAYMENT_METHOD_LABELS[data.paymentMethod] : '—'} />
          </Stack>
        </Card>
      </Section>

      <Section title="Histórico">
        {data.timeline.map((entry, index) => (
          <Row key={index} gap={3} align="flex-start">
            <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: index === data.timeline.length - 1 ? colors.brand : colors.border }} />
            <View style={{ flex: 1 }}>
              <Text weight="600">{DELIVERY_STATUS_LABELS[entry.status as DeliveryStatus] ?? entry.status}</Text>
              <Text variant="caption" tone="muted">
                {formatDateTime(entry.at)}
                {entry.reason ? ` — ${entry.reason}` : ''}
              </Text>
            </View>
          </Row>
        ))}
      </Section>

      {CANCELABLE.includes(data.status) ? <Button title="Cancelar entrega" variant="secondary" onPress={() => setCanceling(true)} /> : null}
      <ReasonDialog
        visible={canceling}
        title="Cancelar entrega"
        description={data.paymentMethod === 'WALLET' ? 'O valor volta para os seus créditos.' : undefined}
        options={[
          { value: 'desisti', label: 'Não preciso mais' },
          { value: 'demora', label: 'Está demorando' },
          { value: 'erro', label: 'Informei algo errado' },
        ]}
        confirmLabel="Cancelar entrega"
        destructive
        onClose={() => setCanceling(false)}
        onConfirm={async (reason) => {
          await api.post(`deliveries/${data.id}/cancel`, { reason });
          toast.success('Entrega cancelada.');
          await delivery.refetch();
        }}
      />
    </Screen>
  );
}
