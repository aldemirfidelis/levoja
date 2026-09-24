import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { DELIVERY_STATUS_LABELS, ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, VEHICLE_TYPE_LABELS, type OrderStatus } from '@levoja/shared';
import {
  api,
  Badge,
  Button,
  Card,
  Divider,
  ErrorView,
  Field,
  formatBRL,
  formatDateTime,
  formatTime,
  LiveMap,
  Loading,
  PixCharge,
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
import { StatusSteps } from '@/components/status-steps';
import type { Order, PaymentMethodsInfo } from '@/lib/types';

const DELIVERY_STEPS = ['Pedido recebido', 'Loja confirmou', 'Em preparo', 'Saiu para entrega', 'Entregue'];
const PICKUP_STEPS = ['Pedido recebido', 'Loja confirmou', 'Em preparo', 'Pronto para retirada', 'Retirado'];
const STEP: Partial<Record<OrderStatus, number>> = { NEW: 0, CONFIRMED: 1, PREPARING: 2, READY_FOR_PICKUP: 2, DRIVER_ASSIGNED: 3, PICKED_UP: 3, IN_TRANSIT: 3, DELIVERED: 4 };
const TONE: Partial<Record<OrderStatus, Tone>> = { PENDING_PAYMENT: 'warning', DELIVERED: 'success', CANCELED: 'danger' };
const ACTIVE: OrderStatus[] = ['PENDING_PAYMENT', 'NEW', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'DRIVER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'];

function Review({ order, onDone }: { order: Order; onDone: () => void }) {
  const toast = useToast();
  const [store, setStore] = useState(0);
  const [driver, setDriver] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const hasDriver = !!order.delivery?.driver;
  const send = async () => {
    setBusy(true);
    try {
      await api.post(`orders/${order.id}/review`, {
        company: store ? { rating: store, comment: comment.trim() || undefined } : undefined,
        driver: hasDriver && driver ? { rating: driver } : undefined,
      });
      toast.success('Obrigado pela avaliação!');
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Stack>
        <Text variant="heading">Como foi seu pedido?</Text>
        <Text tone="muted">{order.company.tradeName}</Text>
        <RatingInput value={store} onChange={setStore} />
        {hasDriver ? (
          <>
            <Text tone="muted">Entregador: {order.delivery!.driver!.name}</Text>
            <RatingInput value={driver} onChange={setDriver} />
          </>
        ) : null}
        <Field value={comment} onChangeText={setComment} placeholder="Conte como foi (opcional)" multiline maxLength={1000} />
        <Button title="Enviar avaliação" onPress={send} loading={busy} disabled={!store && !driver} />
      </Stack>
    </Card>
  );
}

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const toast = useToast();
  const [canceling, setCanceling] = useState(false);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const order = useApi<Order & { reviewed?: boolean }>(`orders/${id}`, undefined, {
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'PENDING_PAYMENT' ? 5000 : status && ACTIVE.includes(status) ? 20_000 : false;
    },
  });
  const methods = useApi<PaymentMethodsInfo>('payments/methods', undefined, { staleTime: 5 * 60_000 });

  useRealtimeEvent<{ deliveryId: string; lat: number; lng: number }>('delivery.location', (payload) => {
    if (payload.deliveryId === order.data?.delivery?.id) setDriverLocation({ lat: payload.lat, lng: payload.lng });
  });

  if (order.isLoading) return <Loading />;
  if (order.error || !order.data) return <ErrorView error={order.error} onRetry={() => order.refetch()} />;
  const data = order.data;
  const payment = data.payment;
  const pickup = data.fulfillment === 'PICKUP';
  const active = ACTIVE.includes(data.status);
  const driver = data.delivery?.driver;
  const location = driverLocation ?? (driver?.location ? { lat: driver.location.lat, lng: driver.location.lng } : null);
  const home = data.deliveryAddress?.lat != null && data.deliveryAddress?.lng != null ? { lat: data.deliveryAddress.lat, lng: data.deliveryAddress.lng } : null;
  const points: MapPoint[] = [...(home ? [{ id: 'home', kind: 'home' as const, ...home, label: 'Entrega' }] : []), ...(location ? [{ id: 'driver', kind: 'driver' as const, ...location, label: driver?.name }] : [])];

  const sandboxApprove = async () => {
    try {
      await api.post(`payments/sandbox/${payment!.id}/approve`);
      toast.success('Pagamento simulado (ambiente de testes).');
      await order.refetch();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Screen refreshing={order.isRefetching} onRefresh={() => order.refetch()}>
      <Row justify="space-between">
        <Text variant="title">Pedido #{data.number}</Text>
        <Badge label={ORDER_STATUS_LABELS[data.status]} tone={TONE[data.status] ?? 'brand'} />
      </Row>
      <Text tone="muted">
        {data.company.tradeName} · {formatDateTime(data.createdAt)}
      </Text>

      {data.status === 'PENDING_PAYMENT' && payment?.method === 'PIX' && payment.pixCopyPaste ? (
        <Card>
          <Stack>
            <Text variant="heading" align="center">
              Pague com PIX para enviar o pedido à loja
            </Text>
            <PixCharge copyPaste={payment.pixCopyPaste} expiresAt={payment.pixExpiresAt} amountCents={payment.amountCents} />
            <Button title="Já paguei" variant="secondary" onPress={() => api.post(`payments/${payment.id}/sync`).then(() => order.refetch()).catch(toast.error)} />
            {methods.data?.sandbox ? <Button title="Simular pagamento (ambiente de testes)" variant="ghost" onPress={sandboxApprove} /> : null}
          </Stack>
        </Card>
      ) : null}
      {data.status === 'PENDING_PAYMENT' && payment && payment.method !== 'PIX' ? (
        <Card>
          <Text>Confirmando o pagamento com o emissor do cartão…</Text>
        </Card>
      ) : null}

      {data.status === 'CANCELED' ? (
        <Card>
          <Stack gap={2}>
            <Text variant="heading" tone="danger">
              Pedido cancelado
            </Text>
            {data.cancelReason ? <Text tone="muted">{data.cancelReason}</Text> : null}
            {payment?.status === 'FAILED' ? (
              <>
                <Text tone="muted">{payment.failureReason ?? 'O pagamento não foi aprovado.'} Seus itens continuam na sacola.</Text>
                <Button title="Tentar de novo" onPress={() => router.replace(`/sacola/${data.company.id}`)} />
              </>
            ) : null}
            {payment?.refundedCents ? <Text tone="success">Estorno de {formatBRL(payment.refundedCents)} realizado.</Text> : null}
          </Stack>
        </Card>
      ) : null}

      {active && data.status !== 'PENDING_PAYMENT' ? (
        <Card>
          <Stack>
            <StatusSteps steps={pickup ? PICKUP_STEPS : DELIVERY_STEPS} current={STEP[data.status] ?? 0} />
            {data.estimatedDeliveryAt ? <Text weight="600">{pickup ? 'Pronto por volta de' : 'Chega por volta de'} {formatTime(data.estimatedDeliveryAt)}</Text> : null}
            {data.scheduledFor ? <Text tone="muted">Agendado para {formatDateTime(data.scheduledFor)}</Text> : null}
            {data.deliveryCode ? (
              <View style={{ backgroundColor: colors.brandSoft, borderRadius: 12, padding: space(4), alignItems: 'center', gap: 4 }}>
                <Text variant="caption" tone="muted">
                  {pickup ? 'Código para retirada' : 'Código de entrega — informe ao entregador'}
                </Text>
                <Text variant="display" tone="brand" style={{ letterSpacing: 8 }} selectable>
                  {data.deliveryCode}
                </Text>
              </View>
            ) : null}
          </Stack>
        </Card>
      ) : null}

      {!pickup && data.delivery && active && points.length ? <LiveMap points={points} follow={location ? 'driver' : undefined} height={240} /> : null}

      {driver ? (
        <Card>
          <Row gap={3}>
            <View style={{ flex: 1 }}>
              <Text weight="700">{driver.name}</Text>
              <Text variant="caption" tone="muted">
                {driver.vehicle ? `${VEHICLE_TYPE_LABELS[driver.vehicle.type]}${driver.vehicle.model ? ` · ${driver.vehicle.model}` : ''}${driver.vehicle.color ? ` ${driver.vehicle.color}` : ''}${driver.vehicle.plate ? ` · ${driver.vehicle.plate}` : ''}` : 'Entregador'}
              </Text>
            </View>
            {driver.rating ? <Badge label={`★ ${driver.rating.toFixed(1)}`} tone="warning" /> : null}
          </Row>
          {data.delivery ? (
            <Text variant="caption" tone="muted" style={{ marginTop: space(2) }}>
              Entrega {data.delivery.code}: {DELIVERY_STATUS_LABELS[data.delivery.status]}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {data.status === 'DELIVERED' && !data.reviewed ? <Review order={data} onDone={() => order.refetch()} /> : null}

      <Section title="Resumo">
        <Card>
          <Stack gap={2}>
            {data.items.map((item) => (
              <ValueRow key={item.id} label={`${item.quantity}× ${item.name}`} value={formatBRL(item.totalCents)} />
            ))}
            <Divider />
            <ValueRow label="Produtos" value={formatBRL(data.subtotalCents)} />
            {!pickup ? <ValueRow label="Entrega" value={data.deliveryFeeCents ? formatBRL(data.deliveryFeeCents) : 'Grátis'} /> : null}
            {data.serviceFeeCents ? <ValueRow label="Taxa de serviço" value={formatBRL(data.serviceFeeCents)} /> : null}
            {data.tipCents ? <ValueRow label="Gorjeta" value={formatBRL(data.tipCents)} /> : null}
            {data.discountCents ? <ValueRow label="Desconto" value={`− ${formatBRL(data.discountCents)}`} tone="success" /> : null}
            <ValueRow label="Total" value={formatBRL(data.totalCents)} strong />
            <Text variant="caption" tone="muted">
              {PAYMENT_METHOD_LABELS[data.paymentMethod]}
              {payment ? ` · ${PAYMENT_STATUS_LABELS[payment.status]}` : ''}
              {payment?.cardLast4 ? ` · •••• ${payment.cardLast4}` : ''}
              {data.changeForCents ? ` · troco para ${formatBRL(data.changeForCents)}` : ''}
            </Text>
          </Stack>
        </Card>
      </Section>

      {data.deliveryAddress && !pickup ? (
        <Text tone="muted">
          Entrega em {data.deliveryAddress.street}, {data.deliveryAddress.number} — {data.deliveryAddress.city}
        </Text>
      ) : null}

      <Section title="Histórico">
        {data.timeline.map((entry, index) => (
          <Row key={index} gap={3} align="flex-start">
            <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: index === data.timeline.length - 1 ? colors.brand : colors.border }} />
            <View style={{ flex: 1 }}>
              <Text weight="600">{ORDER_STATUS_LABELS[entry.status as OrderStatus] ?? entry.status}</Text>
              <Text variant="caption" tone="muted">
                {formatDateTime(entry.at)}
                {entry.reason ? ` — ${entry.reason}` : ''}
              </Text>
            </View>
          </Row>
        ))}
      </Section>

      {data.canCancel ? <Button title="Cancelar pedido" variant="secondary" onPress={() => setCanceling(true)} /> : null}
      <ReasonDialog
        visible={canceling}
        title="Cancelar pedido"
        description={payment?.status === 'PAID' ? 'O valor pago será estornado automaticamente.' : undefined}
        options={[
          { value: 'mudei', label: 'Mudei de ideia' },
          { value: 'demora', label: 'Está demorando' },
          { value: 'errado', label: 'Pedi algo errado' },
        ]}
        confirmLabel="Cancelar pedido"
        destructive
        onClose={() => setCanceling(false)}
        onConfirm={async (reason) => {
          await api.post(`orders/${data.id}/cancel`, { reason });
          toast.success('Pedido cancelado.');
          await order.refetch();
        }}
      />
    </Screen>
  );
}
