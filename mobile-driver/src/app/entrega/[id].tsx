import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { router, Stack as RouterStack, useLocalSearchParams } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { DELIVERY_STATUS_LABELS, ITEM_CATEGORY_LABELS, PROOF_METHOD_LABELS, type DeliveryStatus } from '@levoja/shared';
import {
  api,
  Badge,
  Button,
  Card,
  Chip,
  ConversationButtons,
  ErrorView,
  formatBRL,
  Icon,
  LiveMap,
  Loading,
  ReasonDialog,
  Row,
  Screen,
  space,
  Stack,
  Text,
  useColors,
  useToast,
  type Tone,
} from '@levoja/mobile-kit';
import { usePersistentApi } from '@/lib/cache';
import { useDriver } from '@/lib/driver';
import { lastKnownPoint } from '@/lib/location';
import type { DeliveryAction } from '@/lib/outbox';
import { effectiveStatus, pendingFor } from '@/lib/pending';
import type { DriverDelivery, Stop } from '@/lib/types';

const ACTIVE: DeliveryStatus[] = ['DRIVER_ASSIGNED', 'AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'AT_DROPOFF'];
const FAIL_REASONS = [
  { value: 'RECIPIENT_ABSENT', label: 'Destinatário ausente' },
  { value: 'WRONG_ADDRESS', label: 'Endereço incorreto' },
  { value: 'REFUSED', label: 'Recebimento recusado' },
  { value: 'DAMAGED', label: 'Item avariado' },
  { value: 'UNSAFE_LOCATION', label: 'Local inseguro' },
  { value: 'OTHER', label: 'Outro motivo' },
];

function KeepAwake() {
  useKeepAwake();
  return null;
}

/** Abre a navegação no app de mapas do aparelho (Google Maps, Waze, Apple Maps...). */
function navigate(stop: Stop) {
  const label = encodeURIComponent(`${stop.street}, ${stop.number}`);
  const url = Platform.OS === 'ios' ? `http://maps.apple.com/?daddr=${stop.lat},${stop.lng}&q=${label}` : `geo:${stop.lat},${stop.lng}?q=${stop.lat},${stop.lng}(${label})`;
  Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`));
}

function StopCard({ title, stop, active, onNavigate }: { title: string; stop: Stop; active: boolean; onNavigate: () => void }) {
  const colors = useColors();
  return (
    <Card style={{ borderColor: active ? colors.brand : colors.border, borderWidth: active ? 2 : 1 }}>
      <Stack gap={2}>
        <Row justify="space-between">
          <Text variant="label" tone={active ? 'brand' : 'muted'}>
            {title.toUpperCase()}
          </Text>
          {active ? <Button title="Navegar" icon="navigation" size="sm" onPress={onNavigate} /> : null}
        </Row>
        {stop.name ? <Text weight="700">{stop.name}</Text> : null}
        <Text>
          {stop.street}, {stop.number}
          {stop.complement ? ` — ${stop.complement}` : ''}
        </Text>
        <Text variant="caption" tone="muted">
          {[stop.district, `${stop.city}/${stop.state}`].filter(Boolean).join(' · ')}
        </Text>
        {stop.reference ? <Text variant="caption" tone="muted">Referência: {stop.reference}</Text> : null}
        {stop.phone ? <Text variant="caption" tone="muted">Contato: {stop.phone}</Text> : null}
      </Stack>
    </Card>
  );
}

function Review({ delivery, onDone }: { delivery: DriverDelivery; onDone: () => void }) {
  const toast = useToast();
  const colors = useColors();
  const [customer, setCustomer] = useState(0);
  const [company, setCompany] = useState(0);
  const stars = (value: number, onChange: (value: number) => void) => (
    <Row gap={1}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Chip key={star} label="★" selected={star <= value} onPress={() => onChange(star)} />
      ))}
    </Row>
  );
  return (
    <Card>
      <Stack>
        <Text variant="heading">Como foi a entrega?</Text>
        <Text tone="muted">Cliente</Text>
        {stars(customer, setCustomer)}
        {delivery.company ? (
          <>
            <Text tone="muted">Loja ({delivery.company.tradeName})</Text>
            {stars(company, setCompany)}
          </>
        ) : null}
        <Button
          title="Enviar avaliação"
          disabled={!customer && !company}
          onPress={() =>
            api
              .post(`drivers/me/deliveries/${delivery.id}/review`, { customer: customer ? { rating: customer } : undefined, company: company ? { rating: company } : undefined })
              .then(() => {
                toast.success('Avaliação enviada.');
                onDone();
              })
              .catch(toast.error)
          }
        />
        <Text variant="caption" style={{ color: colors.muted }}>
          Avaliações ajudam a manter a comunidade segura.
        </Text>
      </Stack>
    </Card>
  );
}

export default function DeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const toast = useToast();
  const driver = useDriver();
  const delivery = usePersistentApi<DriverDelivery>(`drivers/me/deliveries/${id}`, undefined, { refetchInterval: 15_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'release' | 'fail' | null>(null);
  const [reviewed, setReviewed] = useState(false);

  if (delivery.isLoading && !delivery.data) return <Loading />;
  if (!delivery.data) return <ErrorView error={delivery.error} onRetry={() => delivery.refetch()} />;
  const data = delivery.data;

  // Ações feitas sem internet já contam para a tela (serão confirmadas no envio).
  const pending = pendingFor(driver.pendingActions, data.id);
  const status = effectiveStatus(data.status, pending);
  const active = ACTIVE.includes(status);
  const beforePickup = status === 'DRIVER_ASSIGNED' || status === 'AT_PICKUP';
  const collect = data.order?.collectCents || data.collectCents || 0;
  const me = lastKnownPoint();

  const run = async (action: DeliveryAction) => {
    setBusy(action);
    try {
      await driver.runAction(data.id, action);
      await delivery.refetch();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen refreshing={delivery.isRefetching} onRefresh={() => delivery.refetch()}>
      <RouterStack.Screen options={{ title: `Entrega ${data.code}` }} />
      {active ? <KeepAwake /> : null}
      <Row justify="space-between">
        <Text variant="title">{data.company?.tradeName ?? 'Entrega avulsa'}</Text>
        <Badge label={pending.length ? `${DELIVERY_STATUS_LABELS[status]} (pendente)` : DELIVERY_STATUS_LABELS[status]} tone={(status === 'DELIVERED' ? 'success' : status === 'CANCELED' || status === 'FAILED' ? 'danger' : 'brand') as Tone} />
      </Row>
      <Text weight="700" tone="success">
        Você recebe {formatBRL(data.payoutCents + data.tipCents)}
        {data.tipCents ? ` (inclui ${formatBRL(data.tipCents)} de gorjeta)` : ''}
      </Text>
      {pending.length ? (
        <Row gap={2}>
          <Icon name="offline" size={16} color={colors.warning} />
          <Text variant="caption" tone="warning">
            Sem internet: {pending.length} ação(ões) desta entrega aguardando envio.
          </Text>
        </Row>
      ) : null}

      {active ? (
        <LiveMap
          points={[
            { id: 'pickup', kind: 'pickup', lat: data.pickup.lat, lng: data.pickup.lng },
            { id: 'dropoff', kind: 'dropoff', lat: data.dropoff.lat, lng: data.dropoff.lng },
            ...(me ? [{ id: 'me', kind: 'me' as const, lat: me.lat, lng: me.lng }] : []),
          ]}
          height={200}
        />
      ) : null}

      <StopCard title="Coleta" stop={data.pickup} active={active && beforePickup} onNavigate={() => navigate(data.pickup)} />
      <StopCard title="Entrega" stop={data.dropoff} active={active && !beforePickup} onNavigate={() => navigate(data.dropoff)} />

      <Card>
        <Stack gap={2}>
          <Text weight="700">
            {ITEM_CATEGORY_LABELS[data.itemCategory]}
            {data.weightKg ? ` · ${data.weightKg} kg` : ''}
          </Text>
          {data.order ? (
            <>
              <Text variant="caption" tone="muted">
                Pedido #{data.order.number}
              </Text>
              {data.order.items.map((item) => (
                <Text key={item}>• {item}</Text>
              ))}
            </>
          ) : data.itemDescription ? (
            <Text>{data.itemDescription}</Text>
          ) : null}
          {data.notes ? <Text variant="caption" tone="muted">Obs.: {data.notes}</Text> : null}
          <Text variant="caption" tone="muted">
            Comprovação: {PROOF_METHOD_LABELS[data.proofMethod]}
            {data.requiresIdCheck ? ' · conferir documento (maior de 18)' : ''}
          </Text>
        </Stack>
      </Card>

      <ConversationButtons deliveryId={data.id} onOpen={(conversationId, title) => router.push({ pathname: '/conversa/[id]', params: { id: conversationId, title } })} />

      {collect > 0 && active ? (
        <Card style={{ borderColor: colors.warning, borderWidth: 2 }}>
          <Text weight="700" tone="warning">
            Receber {formatBRL(collect)} em dinheiro
          </Text>
          {data.order?.changeForCents ? (
            <Text tone="muted">
              Troco para {formatBRL(data.order.changeForCents)} ({formatBRL(data.order.changeForCents - collect)} de troco)
            </Text>
          ) : null}
        </Card>
      ) : null}

      {status === 'DRIVER_ASSIGNED' ? <Button title="Cheguei na coleta" size="lg" loading={busy === 'arrived-pickup'} onPress={() => run('arrived-pickup')} /> : null}
      {status === 'AT_PICKUP' ? <Button title="Confirmar coleta" icon="check" size="lg" loading={busy === 'picked-up'} onPress={() => run('picked-up')} /> : null}
      {status === 'PICKED_UP' ? <Button title="Iniciar rota de entrega" icon="route" size="lg" loading={busy === 'start-route'} onPress={() => run('start-route')} /> : null}
      {status === 'IN_TRANSIT' ? <Button title="Cheguei no destino" size="lg" loading={busy === 'arrived-dropoff'} onPress={() => run('arrived-dropoff')} /> : null}
      {status === 'AT_DROPOFF' || status === 'IN_TRANSIT' || status === 'PICKED_UP' ? (
        <Button title="Concluir entrega" icon="flag" variant={status === 'AT_DROPOFF' ? 'success' : 'secondary'} size="lg" onPress={() => router.push(`/comprovante/${data.id}`)} />
      ) : null}
      {beforePickup && active ? <Button title="Desistir desta entrega" variant="ghost" onPress={() => setDialog('release')} /> : null}
      {!beforePickup && active ? <Button title="Não consegui entregar" variant="ghost" onPress={() => setDialog('fail')} /> : null}
      <Button title="Preciso de ajuda com esta entrega" icon="help" variant="ghost" onPress={() => router.push({ pathname: '/ajuda/novo', params: { deliveryId: data.id, label: `Entrega ${data.code}` } })} />

      {status === 'DELIVERED' && !pending.length && !reviewed ? <Review delivery={data} onDone={() => setReviewed(true)} /> : null}
      {status === 'CANCELED' || status === 'FAILED' ? (
        <Card>
          <Text tone="danger">{data.cancelReason ?? data.failReason ?? DELIVERY_STATUS_LABELS[status]}</Text>
        </Card>
      ) : null}
      <View style={{ height: space(6) }} />

      <ReasonDialog
        visible={dialog === 'release'}
        title="Desistir da entrega"
        description="A entrega volta para a fila e será oferecida a outro entregador. Desistências frequentes afetam sua taxa de aceite."
        options={[
          { value: 'pneu', label: 'Problema com o veículo' },
          { value: 'demora', label: 'Loja muito demorada' },
          { value: 'pessoal', label: 'Imprevisto pessoal' },
        ]}
        confirmLabel="Desistir"
        destructive
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          await api.post(`drivers/me/deliveries/${data.id}/release`, { reason });
          driver.refresh();
          router.back();
        }}
      />
      <ReasonDialog
        visible={dialog === 'fail'}
        title="Entrega não realizada"
        description="Informe o que aconteceu. A equipe de operação é avisada."
        options={FAIL_REASONS}
        confirmLabel="Registrar"
        destructive
        onClose={() => setDialog(null)}
        onConfirm={async (reason, option) => {
          const label = FAIL_REASONS.find((item) => item.value === option)?.label;
          await driver.fail(data.id, option ?? 'OTHER', reason !== label ? reason : undefined);
          await delivery.refetch();
        }}
      />
    </Screen>
  );
}
