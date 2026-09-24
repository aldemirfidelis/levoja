import { useState } from 'react';
import { maskCep } from '@levoja/shared';
import { Button, Field, Row, Stack, Text } from './primitives';
import { useToast } from './feedback';
import { locateMe, lookupCep, type AddressDraft } from '../geo';

export const emptyDraft: AddressDraft = { zipCode: '', street: '', number: '', complement: '', district: '', city: '', state: '', reference: '', lat: null, lng: null };

/** Campos de endereço com busca por CEP e preenchimento pela localização atual (GPS). */
export function AddressFields({ value, onChange, errors = {} }: { value: AddressDraft; onChange: (value: AddressDraft) => void; errors?: Partial<Record<keyof AddressDraft, string>> }) {
  const toast = useToast();
  const [locating, setLocating] = useState(false);
  const set = (patch: Partial<AddressDraft>) => onChange({ ...value, ...patch });

  const useLocation = async () => {
    setLocating(true);
    const result = await locateMe();
    setLocating(false);
    if (!result.ok) return toast.error(new Error(result.reason === 'denied' ? 'Permita o acesso à localização nas configurações.' : 'Não foi possível obter sua localização.'));
    const found = result.address;
    onChange({
      ...value,
      zipCode: found.zipCode ? maskCep(found.zipCode) : value.zipCode,
      street: found.street || value.street,
      number: found.number || value.number,
      district: found.district || value.district,
      city: found.city || value.city,
      state: found.state || value.state,
      lat: result.lat,
      lng: result.lng,
    });
    toast.info('Confira o número e o complemento.');
  };

  const onCep = async (text: string) => {
    const masked = maskCep(text);
    set({ zipCode: masked });
    if (masked.length === 9) {
      const found = await lookupCep(masked);
      if (found) onChange({ ...value, zipCode: masked, ...Object.fromEntries(Object.entries(found).filter(([, v]) => v)) });
    }
  };

  return (
    <Stack>
      <Button title="Usar minha localização atual" icon="myLocation" variant="secondary" loading={locating} onPress={useLocation} />
      {value.lat != null ? (
        <Text variant="caption" tone="success">
          Localização precisa registrada para o entregador.
        </Text>
      ) : null}
      <Field label="CEP" value={value.zipCode} onChangeText={onCep} keyboardType="number-pad" placeholder="00000-000" error={errors.zipCode} />
      <Field label="Rua" value={value.street} onChangeText={(street) => set({ street })} autoComplete="street-address" error={errors.street} />
      <Row gap={3}>
        <Field label="Número" value={value.number} onChangeText={(number) => set({ number })} containerStyle={{ flex: 1 }} error={errors.number} />
        <Field label="Complemento" value={value.complement} onChangeText={(complement) => set({ complement })} containerStyle={{ flex: 2 }} placeholder="Apto, bloco…" />
      </Row>
      <Field label="Bairro" value={value.district} onChangeText={(district) => set({ district })} error={errors.district} />
      <Row gap={3}>
        <Field label="Cidade" value={value.city} onChangeText={(city) => set({ city })} containerStyle={{ flex: 3 }} error={errors.city} />
        <Field label="UF" value={value.state} onChangeText={(state) => set({ state: state.toUpperCase().slice(0, 2) })} autoCapitalize="characters" maxLength={2} containerStyle={{ flex: 1 }} error={errors.state} />
      </Row>
      <Field label="Ponto de referência" value={value.reference} onChangeText={(reference) => set({ reference })} placeholder="Opcional" />
    </Stack>
  );
}

/** Validação mínima (a API valida de novo). */
export function draftErrors(value: AddressDraft): Partial<Record<keyof AddressDraft, string>> {
  const errors: Partial<Record<keyof AddressDraft, string>> = {};
  if (!/^\d{5}-?\d{3}$/.test(value.zipCode)) errors.zipCode = 'CEP inválido.';
  if (value.street.trim().length < 2) errors.street = 'Informe a rua.';
  if (!value.number.trim()) errors.number = 'Informe o número (ou S/N).';
  if (value.district.trim().length < 2) errors.district = 'Informe o bairro.';
  if (value.city.trim().length < 2) errors.city = 'Informe a cidade.';
  if (!/^[A-Z]{2}$/.test(value.state)) errors.state = 'UF';
  return errors;
}
