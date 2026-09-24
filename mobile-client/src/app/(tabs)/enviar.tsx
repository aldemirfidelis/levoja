import { useMemo, useState } from 'react';
import { ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ITEM_CATEGORIES, ITEM_CATEGORY_LABELS, maskPhone, VEHICLE_TYPE_LABELS, type ItemCategory, type PaymentMethod } from '@levoja/shared';
import {
  type AddressDraft,
  AddressFields,
  api,
  Button,
  Card,
  Chip,
  Divider,
  draftErrors,
  emptyDraft,
  errorMessage,
  Field,
  formatBRL,
  formatTime,
  MoneyField,
  RadioCard,
  Row,
  Screen,
  Section,
  space,
  Stack,
  Text,
  useApi,
  useInvalidate,
  useToast,
  ValueRow,
} from '@levoja/mobile-kit';
import { addressLine, useAddress } from '@/lib/address';
import type { Delivery, DeliveryQuote, PaymentMethodsInfo } from '@/lib/types';

const TIPS = [0, 200, 500];

function stopBody(draft: AddressDraft, contactName: string, contactPhone?: string) {
  return {
    contactName: contactName.trim() || undefined,
    contactPhone: contactPhone?.trim() || undefined,
    zipCode: draft.zipCode,
    street: draft.street,
    number: draft.number,
    complement: draft.complement || undefined,
    district: draft.district || undefined,
    city: draft.city,
    state: draft.state,
    reference: draft.reference || undefined,
    lat: draft.lat ?? undefined,
    lng: draft.lng ?? undefined,
  };
}

export default function SendScreen() {
  const params = useLocalSearchParams<{ categoria?: string }>();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { addresses, selected } = useAddress();
  const methods = useApi<PaymentMethodsInfo>('payments/methods', undefined, { staleTime: 5 * 60_000 });
  const credits = useApi<{ availableCents: number }>('customers/me/wallet');

  const [pickupId, setPickupId] = useState<string | null>(selected?.id ?? null);
  const [pickupDraft, setPickupDraft] = useState<AddressDraft>(emptyDraft);
  const [pickupName, setPickupName] = useState('');
  const [dropoff, setDropoff] = useState<AddressDraft>(emptyDraft);
  const [recipient, setRecipient] = useState({ name: '', phone: '' });
  const [category, setCategory] = useState<ItemCategory>((ITEM_CATEGORIES as readonly string[]).includes(params.categoria ?? '') ? (params.categoria as ItemCategory) : 'PACKAGE');
  const [description, setDescription] = useState('');
  const [weight, setWeight] = useState('');
  const [declared, setDeclared] = useState<number | null>(null);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [tipCents, setTipCents] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [notes, setNotes] = useState('');
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [errors, setErrors] = useState<{ pickup?: Partial<Record<keyof AddressDraft, string>>; dropoff?: Partial<Record<keyof AddressDraft, string>> }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'quote' | 'create' | null>(null);

  const slots = useMemo(() => {
    const list: Date[] = [];
    const start = new Date(Date.now() + 60 * 60_000);
    start.setSeconds(0, 0);
    start.setMinutes(start.getMinutes() < 30 ? 30 : 60);
    for (let at = start; list.length < 16; at = new Date(at.getTime() + 30 * 60_000)) if (at.getHours() >= 7 && at.getHours() < 22) list.push(at);
    return list;
  }, []);

  const payload = () => ({
    pickup: pickupId ? { addressId: pickupId, contactName: pickupName.trim() || undefined } : stopBody(pickupDraft, pickupName),
    dropoff: stopBody(dropoff, recipient.name, recipient.phone),
    itemCategory: category,
    weightKg: weight ? Number(weight.replace(',', '.')) : undefined,
    scheduledFor: scheduledFor ?? undefined,
  });

  const validate = () => {
    const next = { pickup: pickupId ? {} : draftErrors(pickupDraft), dropoff: draftErrors(dropoff) };
    setErrors(next);
    if (Object.keys(next.pickup).length || Object.keys(next.dropoff).length) {
      setError('Confira os endereços destacados.');
      return false;
    }
    if (!recipient.name.trim()) {
      setError('Informe quem vai receber.');
      return false;
    }
    setError(null);
    return true;
  };

  const calculate = async () => {
    if (!validate()) return;
    setBusy('quote');
    try {
      setQuote(await api.post<DeliveryQuote>('deliveries/quote', payload()));
    } catch (err) {
      setError(errorMessage(err));
      setQuote(null);
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!quote || !validate()) return;
    setBusy('create');
    try {
      const delivery = await api.post<Delivery>('deliveries', {
        ...payload(),
        itemDescription: description.trim() || undefined,
        declaredValueCents: declared ?? undefined,
        notes: notes.trim() || undefined,
        paymentMethod: method,
        tipCents,
        proofMethod: category === 'DOCUMENT' ? 'SIGNATURE' : 'CODE',
      });
      await invalidate('deliveries', 'customers/me/wallet');
      setQuote(null);
      router.push(`/entrega/${delivery.id}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const invalidateQuote = () => setQuote(null);
  const total = (quote?.feeCents ?? 0) + tipCents;
  const allowed = (methods.data?.deliveries.customer ?? ['CASH']).filter((item) => item === 'CASH' || item === 'WALLET');

  return (
    <Screen
      footer={
        quote ? (
          <Button title={`Solicitar entrega · ${formatBRL(total)}`} onPress={create} loading={busy === 'create'} size="lg" fullWidth />
        ) : (
          <Button title="Calcular valor" onPress={calculate} loading={busy === 'quote'} size="lg" fullWidth />
        )
      }
    >
      <Text variant="title">Enviar algo</Text>
      <Text tone="muted">Um entregador busca e leva agora ou no horário que você escolher.</Text>

      <Section title="Coleta">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2) }}>
          {addresses.map((address) => (
            <Chip key={address.id} label={address.label || addressLine(address)} icon="location" selected={pickupId === address.id} onPress={() => { setPickupId(address.id); invalidateQuote(); }} />
          ))}
          <Chip label="Outro endereço" icon="plus" selected={!pickupId} onPress={() => { setPickupId(null); invalidateQuote(); }} />
        </ScrollView>
        {!pickupId ? <AddressFields value={pickupDraft} onChange={(value) => { setPickupDraft(value); invalidateQuote(); }} errors={errors.pickup} /> : null}
        <Field label="Quem entrega o item (opcional)" value={pickupName} onChangeText={setPickupName} />
      </Section>

      <Section title="Entrega">
        <AddressFields value={dropoff} onChange={(value) => { setDropoff(value); invalidateQuote(); }} errors={errors.dropoff} />
        <Field label="Quem recebe" value={recipient.name} onChangeText={(name) => setRecipient({ ...recipient, name })} />
        <Field label="Celular de quem recebe" value={recipient.phone} onChangeText={(phone) => setRecipient({ ...recipient, phone: maskPhone(phone) })} keyboardType="phone-pad" hint="O entregador vê apenas parte do número." />
      </Section>

      <Section title="O que vai ser enviado">
        <Row gap={2} style={{ flexWrap: 'wrap' }}>
          {ITEM_CATEGORIES.map((item) => (
            <Chip key={item} label={ITEM_CATEGORY_LABELS[item]} selected={category === item} onPress={() => { setCategory(item); invalidateQuote(); }} />
          ))}
        </Row>
        <Field label="Descrição" value={description} onChangeText={setDescription} placeholder="Ex.: envelope com contrato" maxLength={300} />
        <Row gap={3}>
          <Field label="Peso aproximado (kg)" value={weight} onChangeText={(value) => { setWeight(value.replace(/[^\d,.]/g, '')); invalidateQuote(); }} keyboardType="decimal-pad" containerStyle={{ flex: 1 }} />
          <MoneyField label="Valor declarado" value={declared} onChange={setDeclared} />
        </Row>
        {category === 'DOCUMENT' ? <Text variant="caption" tone="muted">Documentos são entregues com assinatura de quem recebe.</Text> : null}
      </Section>

      <Section title="Quando">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2) }}>
          <Chip label="Agora" icon="clock" selected={!scheduledFor} onPress={() => { setScheduledFor(null); invalidateQuote(); }} />
          {slots.map((slot) => {
            const iso = slot.toISOString();
            return <Chip key={iso} label={`${slot.getDate() !== new Date().getDate() ? 'Amanhã ' : ''}${formatTime(slot)}`} selected={scheduledFor === iso} onPress={() => { setScheduledFor(iso); invalidateQuote(); }} />;
          })}
        </ScrollView>
      </Section>

      <Field label="Instruções para o entregador" value={notes} onChangeText={setNotes} multiline maxLength={500} placeholder="Ex.: procurar a recepção" />
      {error ? <Text tone="danger">{error}</Text> : null}

      {quote ? (
        <Card>
          <Stack gap={2}>
            <Text variant="heading">Valor da entrega</Text>
            {quote.breakdown.map((line) => (
              <ValueRow key={line.label} label={line.label} value={formatBRL(line.cents)} />
            ))}
            <Divider />
            <ValueRow label="Entrega" value={formatBRL(quote.feeCents)} strong />
            <Text variant="caption" tone="muted">
              {quote.distanceKm.toLocaleString('pt-BR')} km · ~{quote.durationMin} min · {VEHICLE_TYPE_LABELS[quote.vehicleType]}
            </Text>
            <Text weight="600" style={{ marginTop: space(2) }}>
              Gorjeta
            </Text>
            <Row gap={2}>
              {TIPS.map((tip) => (
                <Chip key={tip} label={tip ? formatBRL(tip) : 'Sem gorjeta'} selected={tipCents === tip} onPress={() => setTipCents(tip)} />
              ))}
            </Row>
            <Text weight="600" style={{ marginTop: space(2) }}>
              Pagamento
            </Text>
            {allowed.map((item) => (
              <RadioCard
                key={item}
                icon={item === 'WALLET' ? 'wallet' : 'money'}
                title={item === 'WALLET' ? 'Créditos LevoJá' : 'Dinheiro na coleta'}
                subtitle={item === 'WALLET' ? `Saldo: ${formatBRL(credits.data?.availableCents ?? 0)}` : 'Pague ao entregador'}
                selected={method === item}
                disabled={item === 'WALLET' && (credits.data?.availableCents ?? 0) < total}
                onPress={() => setMethod(item)}
              />
            ))}
          </Stack>
        </Card>
      ) : null}
    </Screen>
  );
}
