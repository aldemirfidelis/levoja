import { useMemo, useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useQuery } from '@tanstack/react-query';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@levoja/shared';
import {
  api,
  Badge,
  Button,
  Card,
  Chip,
  confirm,
  Divider,
  EmptyState,
  ErrorView,
  errorMessage,
  Field,
  formatBRL,
  formatTime,
  Loading,
  MoneyField,
  RadioCard,
  radius,
  Row,
  Screen,
  Section,
  Segmented,
  space,
  Stack,
  Stepper,
  Text,
  upload,
  useApi,
  useApiMutation,
  useColors,
  useInvalidate,
  useToast,
  ValueRow,
  type IconName,
} from '@levoja/mobile-kit';
import { CardForm, type CardToken } from '@/components/card-form';
import { addressLine, useAddress } from '@/lib/address';
import { scheduleSlots } from '@/lib/schedule';
import type { Cart, Order, PaymentMethodsInfo, Quote, StoreDetail } from '@/lib/types';

const TIPS = [0, 200, 500, 1000];
const METHOD_ICON: Record<string, IconName> = { PIX: 'pix', CREDIT_CARD: 'card', DEBIT_CARD: 'card', WALLET: 'wallet', CASH: 'money' };

export default function BagScreen() {
  const { companyId } = useLocalSearchParams<{ companyId: string }>();
  const colors = useColors();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { selected: address } = useAddress();
  const cart = useApi<Cart>(`cart/${companyId}`);
  const store = useApi<StoreDetail>(`stores/${companyId}`);
  const methods = useApi<PaymentMethodsInfo>('payments/methods', undefined, { staleTime: 5 * 60_000 });
  const credits = useApi<{ availableCents: number }>('customers/me/wallet');

  const [fulfillment, setFulfillment] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY');
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [couponInput, setCouponInput] = useState('');
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [tipCents, setTipCents] = useState(0);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [changeFor, setChangeFor] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [prescription, setPrescription] = useState<{ id: string; fileName: string } | null>(null);
  const [card, setCard] = useState<CardToken | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [placing, setPlacing] = useState(false);

  const body = useMemo(
    () => ({
      companyId,
      fulfillment,
      addressId: fulfillment === 'DELIVERY' ? address?.id : undefined,
      scheduledFor: scheduledFor ?? undefined,
      tipCents: fulfillment === 'DELIVERY' ? tipCents : 0,
      couponCode: couponCode ?? undefined,
    }),
    [companyId, fulfillment, address?.id, scheduledFor, tipCents, couponCode],
  );
  const hasItems = (cart.data?.items.length ?? 0) > 0;
  const quote = useQuery({
    queryKey: ['orders/quote', body, cart.data?.itemsCount, cart.data?.subtotalCents],
    queryFn: () => api.post<Quote>('orders/quote', body),
    enabled: hasItems && (fulfillment === 'PICKUP' || !!address),
  });

  const updateItem = useApiMutation(({ id, quantity }: { id: string; quantity: number }) => (quantity > 0 ? api.patch(`cart/items/${id}`, { quantity }) : api.delete(`cart/items/${id}`)), ['cart']);
  const slots = useMemo(() => scheduleSlots(store.data?.openingHours ?? []), [store.data?.openingHours]);
  const available = (methods.data?.orders ?? ['CASH']).filter((item) => item !== 'INVOICE');
  const total = quote.data?.totalCents ?? 0;

  const pickPrescription = async (source: 'camera' | 'files') => {
    try {
      let file: { uri: string; name?: string | null; mimeType?: string | null } | null = null;
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) return toast.error(new Error('Permita o uso da câmera nas configurações.'));
        const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
        if (!result.canceled && result.assets[0]) file = { uri: result.assets[0].uri, name: result.assets[0].fileName, mimeType: result.assets[0].mimeType };
      } else {
        const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true });
        if (!result.canceled && result.assets[0]) file = { uri: result.assets[0].uri, name: result.assets[0].name, mimeType: result.assets[0].mimeType };
      }
      if (!file) return;
      const saved = await upload<{ id: string; fileName: string }>('me/prescriptions', 'file', file);
      setPrescription(saved);
      toast.success('Receita enviada. A farmácia vai conferir antes de separar o pedido.');
    } catch (err) {
      toast.error(err);
    }
  };

  const place = async () => {
    if (!quote.data?.canCheckout) return;
    if (!method) return toast.error(new Error('Escolha a forma de pagamento.'));
    if ((method === 'CREDIT_CARD' || method === 'DEBIT_CARD') && !card) return setCardOpen(true);
    if (quote.data.requiresPrescription && !prescription) return toast.error(new Error('Envie a receita para continuar.'));
    if (method === 'CASH' && changeFor != null && changeFor < total) return toast.error(new Error('O troco deve ser maior que o total.'));
    setPlacing(true);
    try {
      const order = await api.post<Order>('orders', {
        ...body,
        paymentMethod: method,
        changeForCents: method === 'CASH' && changeFor ? changeFor : undefined,
        notes: notes.trim() || undefined,
        prescriptionId: prescription?.id,
        cardToken: card?.token,
        installments: card?.installments,
        cardPaymentMethodId: card?.paymentMethodId,
        cardIssuerId: card?.issuerId,
      });
      await invalidate('cart', 'orders', 'customers/me/wallet');
      router.replace(`/pedido/${order.id}`);
    } catch (err) {
      toast.error(err);
      setCard(null);
    } finally {
      setPlacing(false);
    }
  };

  if (cart.isLoading) return <Loading />;
  if (cart.error) return <ErrorView error={cart.error} onRetry={() => cart.refetch()} />;
  if (!hasItems) {
    return (
      <Screen scroll={false}>
        <EmptyState icon="bag" title="Sua sacola está vazia" action={<Button title="Voltar às lojas" onPress={() => router.replace('/')} />} />
      </Screen>
    );
  }

  const data = cart.data!;
  return (
    <Screen
      footer={
        <>
          {quote.data && !quote.data.canCheckout ? (
            <Text tone="danger" variant="caption">
              {quote.data.issues[0]}
            </Text>
          ) : null}
          <Button
            title={placing ? 'Enviando pedido…' : `Fazer pedido · ${formatBRL(total)}`}
            onPress={place}
            loading={placing}
            disabled={!quote.data?.canCheckout || quote.isFetching}
            size="lg"
            fullWidth
          />
        </>
      }
    >
      <Text variant="title">{data.company?.tradeName}</Text>

      <Section title="Itens" action={<Button title="Limpar" size="sm" variant="ghost" onPress={async () => (await confirm('Esvaziar a sacola?', 'Todos os itens desta loja serão removidos.', { destructive: true, confirmLabel: 'Esvaziar' })) && api.delete(`cart/${companyId}`).then(() => invalidate('cart'))} />}>
        <Card padded={false}>
          {data.items.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <Divider /> : null}
              <Row gap={3} style={{ padding: space(3) }} align="flex-start">
                {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={{ width: 48, height: 48, borderRadius: radius.md }} accessibilityIgnoresInvertColors /> : null}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text weight="600">{item.name}</Text>
                  {item.options.length ? (
                    <Text variant="caption" tone="muted">
                      {item.options.map((option) => option.name).join(', ')}
                    </Text>
                  ) : null}
                  {item.notes ? <Text variant="caption" tone="muted">Obs.: {item.notes}</Text> : null}
                  {item.issues.map((issue) => (
                    <Text key={issue} variant="caption" tone="danger">
                      {issue}
                    </Text>
                  ))}
                  <Text weight="700">{formatBRL(item.totalCents)}</Text>
                </View>
                <Stepper value={item.quantity} min={0} max={99} onChange={(quantity) => updateItem.mutate({ id: item.id, quantity })} />
              </Row>
            </View>
          ))}
        </Card>
        <Button title="Adicionar mais itens" variant="ghost" icon="plus" onPress={() => router.push(`/loja/${companyId}`)} />
      </Section>

      <Section title="Como receber">
        <Segmented value={fulfillment} onChange={setFulfillment} options={[{ value: 'DELIVERY', label: 'Entrega' }, { value: 'PICKUP', label: 'Retirar na loja' }]} />
        {fulfillment === 'DELIVERY' ? (
          <Card onPress={() => router.push('/enderecos')}>
            <Row gap={3}>
              <Text style={{ flex: 1 }} weight="600" numberOfLines={2}>
                {address ? addressLine(address) : 'Escolha um endereço de entrega'}
              </Text>
              <Text tone="brand" weight="600">Trocar</Text>
            </Row>
          </Card>
        ) : (
          <Text tone="muted">Retire na loja com o código do pedido. {store.data?.address ? `${store.data.address.district}, ${store.data.address.city}` : ''}</Text>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2) }}>
          <Chip label="O quanto antes" selected={!scheduledFor} onPress={() => setScheduledFor(null)} icon="clock" />
          {slots.map((slot) => {
            const iso = slot.toISOString();
            const tomorrow = slot.getDate() !== new Date().getDate();
            return <Chip key={iso} label={`${tomorrow ? 'Amanhã ' : ''}${formatTime(slot)}`} selected={scheduledFor === iso} onPress={() => setScheduledFor(iso)} />;
          })}
        </ScrollView>
      </Section>

      {quote.data?.requiresPrescription ? (
        <Section title="Receita médica">
          {prescription ? (
            <Row gap={2}>
              <Badge label="Receita enviada" tone="success" />
              <Text variant="caption" tone="muted" style={{ flex: 1 }} numberOfLines={1}>
                {prescription.fileName}
              </Text>
              <Button title="Trocar" size="sm" variant="ghost" onPress={() => setPrescription(null)} />
            </Row>
          ) : (
            <Row gap={2}>
              <Button title="Fotografar" icon="camera" variant="secondary" onPress={() => pickPrescription('camera')} style={{ flex: 1 }} />
              <Button title="Arquivo" icon="document" variant="secondary" onPress={() => pickPrescription('files')} style={{ flex: 1 }} />
            </Row>
          )}
        </Section>
      ) : null}

      {fulfillment === 'DELIVERY' ? (
        <Section title="Gorjeta para o entregador">
          <Row gap={2} style={{ flexWrap: 'wrap' }}>
            {TIPS.map((tip) => (
              <Chip key={tip} label={tip ? formatBRL(tip) : 'Sem gorjeta'} selected={tipCents === tip} onPress={() => setTipCents(tip)} icon={tip ? 'heart' : undefined} />
            ))}
          </Row>
          <Text variant="caption" tone="muted">100% da gorjeta vai para o entregador.</Text>
        </Section>
      ) : null}

      <Section title="Cupom">
        {couponCode ? (
          <Row gap={2}>
            <Badge label={couponCode} tone={quote.data?.coupon ? 'success' : 'warning'} />
            <Text variant="caption" tone="muted" style={{ flex: 1 }}>
              {quote.data?.coupon ? (quote.data.coupon.description ?? 'Desconto aplicado') : 'Cupom não aplicável'}
            </Text>
            <Button title="Remover" size="sm" variant="ghost" onPress={() => setCouponCode(null)} />
          </Row>
        ) : (
          <Row gap={2}>
            <Field value={couponInput} onChangeText={(value) => setCouponInput(value.toUpperCase())} placeholder="Código do cupom" autoCapitalize="characters" containerStyle={{ flex: 1 }} />
            <Button title="Aplicar" variant="secondary" disabled={couponInput.trim().length < 3} onPress={() => setCouponCode(couponInput.trim())} />
          </Row>
        )}
      </Section>

      <Section title="Pagamento">
        <Stack gap={2}>
          {available.map((item) => (
            <RadioCard
              key={item}
              icon={METHOD_ICON[item] ?? 'money'}
              title={item === 'CASH' ? (fulfillment === 'PICKUP' ? 'Dinheiro na retirada' : 'Dinheiro na entrega') : item === 'WALLET' ? 'Créditos LevoJá' : PAYMENT_METHOD_LABELS[item]}
              subtitle={
                item === 'PIX'
                  ? 'Aprovação na hora pelo app do seu banco'
                  : item === 'WALLET'
                    ? `Saldo: ${formatBRL(credits.data?.availableCents ?? 0)}`
                    : (item === 'CREDIT_CARD' || item === 'DEBIT_CARD') && card && method === item
                      ? card.label
                      : undefined
              }
              selected={method === item}
              disabled={item === 'WALLET' && (credits.data?.availableCents ?? 0) < total}
              onPress={() => {
                setMethod(item);
                if ((item === 'CREDIT_CARD' || item === 'DEBIT_CARD') && !card) setCardOpen(true);
              }}
            />
          ))}
        </Stack>
        {method === 'CASH' ? <MoneyField label="Troco para (opcional)" value={changeFor} onChange={setChangeFor} hint="Deixe em branco se não precisar de troco." /> : null}
        {(method === 'CREDIT_CARD' || method === 'DEBIT_CARD') && card ? <Button title="Trocar cartão" variant="ghost" onPress={() => { setCard(null); setCardOpen(true); }} /> : null}
      </Section>

      <Field label="Observações para a loja" value={notes} onChangeText={setNotes} placeholder="Ex.: interfone quebrado, entregar na portaria" multiline maxLength={500} />

      <Card>
        <Stack gap={2}>
          {quote.isLoading ? <Loading /> : null}
          {quote.error ? <Text tone="danger">{errorMessage(quote.error)}</Text> : null}
          {quote.data ? (
            <>
              <ValueRow label="Produtos" value={formatBRL(quote.data.subtotalCents)} />
              {fulfillment === 'DELIVERY' ? <ValueRow label={`Entrega${quote.data.distanceKm ? ` (${quote.data.distanceKm.toLocaleString('pt-BR')} km)` : ''}`} value={quote.data.deliveryFeeCents ? formatBRL(quote.data.deliveryFeeCents) : 'Grátis'} /> : null}
              {quote.data.serviceFeeCents ? <ValueRow label="Taxa de serviço" value={formatBRL(quote.data.serviceFeeCents)} /> : null}
              {quote.data.tipCents ? <ValueRow label="Gorjeta" value={formatBRL(quote.data.tipCents)} /> : null}
              {quote.data.discountCents ? <ValueRow label="Desconto" value={`− ${formatBRL(quote.data.discountCents)}`} tone="success" /> : null}
              <Divider />
              <ValueRow label="Total" value={formatBRL(quote.data.totalCents)} strong />
              {quote.data.estimatedDeliveryAt ? (
                <Text variant="caption" tone="muted">
                  Previsão: {formatTime(quote.data.estimatedDeliveryAt)}
                </Text>
              ) : null}
              {quote.data.requiresIdCheck ? <Text variant="caption" tone="warning">Documento com foto será conferido na entrega (produto com idade mínima).</Text> : null}
              {quote.data.issues.map((issue) => (
                <Text key={issue} variant="caption" tone="danger">
                  • {issue}
                </Text>
              ))}
            </>
          ) : null}
        </Stack>
      </Card>

      <CardForm
        visible={cardOpen}
        amountCents={total}
        tokenization={methods.data?.cardTokenization ?? null}
        sandboxTokens={methods.data?.sandbox?.cardTokens}
        onClose={() => setCardOpen(false)}
        onToken={(token) => {
          setCard(token);
          setCardOpen(false);
        }}
      />
      <View style={{ height: 1, backgroundColor: colors.bg }} />
    </Screen>
  );
}
