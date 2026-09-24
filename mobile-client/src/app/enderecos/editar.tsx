import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { maskCep } from '@levoja/shared';
import { type AddressDraft, AddressFields, api, Button, Checkbox, draftErrors, emptyDraft, errorMessage, Field, LiveMap, Screen, Text, useInvalidate, useToast } from '@levoja/mobile-kit';
import { useAddress } from '@/lib/address';
import type { Address } from '@/lib/types';

export default function EditAddress() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { addresses, select } = useAddress();
  const toast = useToast();
  const invalidate = useInvalidate();
  const existing = addresses.find((address) => address.id === id);
  const [draft, setDraft] = useState<AddressDraft>(
    existing
      ? { ...emptyDraft, ...existing, zipCode: maskCep(existing.zipCode), complement: existing.complement ?? '', reference: existing.reference ?? '' }
      : emptyDraft,
  );
  const [label, setLabel] = useState(existing?.label ?? '');
  const [isDefault, setIsDefault] = useState(existing?.isDefault ?? addresses.length === 0);
  const [errors, setErrors] = useState<Partial<Record<keyof AddressDraft, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const found = draftErrors(draft);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError(null);
    const body = {
      label: label.trim() || undefined,
      zipCode: draft.zipCode,
      street: draft.street,
      number: draft.number,
      complement: draft.complement || undefined,
      district: draft.district,
      city: draft.city,
      state: draft.state,
      reference: draft.reference || undefined,
      lat: draft.lat ?? undefined,
      lng: draft.lng ?? undefined,
      isDefault,
    };
    try {
      const saved = existing ? await api.put<Address>(`me/addresses/${existing.id}`, body) : await api.post<Address>('me/addresses', body);
      await invalidate('me/addresses', 'stores');
      select(saved.id);
      toast.success('Endereço salvo.');
      router.back();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button title="Salvar endereço" onPress={save} loading={busy} fullWidth size="lg" />}>
      <Field label="Nome do endereço" value={label} onChangeText={setLabel} placeholder="Casa, Trabalho…" maxLength={40} />
      <AddressFields value={draft} onChange={setDraft} errors={errors} />
      {draft.lat != null && draft.lng != null ? <LiveMap points={[{ id: 'home', kind: 'home', lat: draft.lat, lng: draft.lng }]} height={180} /> : null}
      <Checkbox label="Usar como endereço padrão" checked={isDefault} onChange={setIsDefault} />
      {error ? <Text tone="danger">{error}</Text> : null}
    </Screen>
  );
}
