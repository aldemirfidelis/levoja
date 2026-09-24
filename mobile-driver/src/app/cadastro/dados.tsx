import { useState } from 'react';
import { brDateToIso, maskCep, maskCpf, maskDate } from '@levoja/shared';
import {
  AddressFields,
  api,
  Button,
  Chip,
  draftErrors,
  emptyDraft,
  errorMessage,
  ErrorView,
  Field,
  Loading,
  Row,
  Screen,
  Section,
  Text,
  useApi,
  useToast,
  type AddressDraft,
} from '@levoja/mobile-kit';
import type { DriverProfile } from '@/lib/types';

const CNH_CATEGORIES = ['A', 'B', 'AB', 'C', 'D', 'E', 'AC', 'AD', 'AE'];
const isoToBr = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

function toDraft(address: Record<string, unknown> | null): AddressDraft {
  if (!address) return emptyDraft;
  const text = (key: string) => (typeof address[key] === 'string' ? (address[key] as string) : '');
  const num = (key: string) => (typeof address[key] === 'number' ? (address[key] as number) : null);
  return {
    zipCode: maskCep(text('zipCode')),
    street: text('street'),
    number: text('number'),
    complement: text('complement'),
    district: text('district'),
    city: text('city'),
    state: text('state'),
    reference: text('reference'),
    lat: num('lat'),
    lng: num('lng'),
  };
}

export default function PersonalData() {
  const toast = useToast();
  const profile = useApi<DriverProfile>('drivers/me');
  if (profile.isLoading) return <Loading />;
  if (profile.error || !profile.data) return <ErrorView error={profile.error} onRetry={() => profile.refetch()} />;
  return <Form driver={profile.data} onSaved={() => profile.refetch()} toastSuccess={toast.success} />;
}

function Form({ driver, onSaved, toastSuccess }: { driver: DriverProfile; onSaved: () => void; toastSuccess: (message: string) => void }) {
  const vehicle = driver.vehicles.find((item) => item.id === driver.activeVehicleId) ?? driver.vehicles[0];
  const motorized = vehicle?.type !== 'BICYCLE';
  const editable = ['DRAFT', 'PENDING_DOCUMENTS', 'REJECTED'].includes(driver.status);
  const [form, setForm] = useState({ cpf: '', birthDate: isoToBr(driver.user.birthDate), cnhNumber: '', cnhCategory: driver.cnhCategory ?? '', cnhExpiresAt: isoToBr(driver.cnhExpiresAt) });
  const [address, setAddress] = useState<AddressDraft>(toDraft(driver.address));
  const [errors, setErrors] = useState<Partial<Record<keyof AddressDraft, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    const birthDate = form.birthDate ? brDateToIso(form.birthDate) : null;
    const cnhExpiresAt = form.cnhExpiresAt ? brDateToIso(form.cnhExpiresAt) : null;
    if (form.birthDate && !birthDate) return setError('Data de nascimento inválida.');
    if (form.cnhExpiresAt && !cnhExpiresAt) return setError('Validade da CNH inválida.');
    const addressErrors = draftErrors(address);
    setErrors(addressErrors);
    if (Object.keys(addressErrors).length) return setError('Confira o endereço.');
    setBusy(true);
    try {
      await api.patch('drivers/me', {
        cpf: form.cpf || undefined,
        birthDate: birthDate ?? undefined,
        cnhNumber: form.cnhNumber || undefined,
        cnhCategory: form.cnhCategory || undefined,
        cnhExpiresAt: cnhExpiresAt ?? undefined,
      });
      await api.put('drivers/me/address', {
        zipCode: address.zipCode,
        street: address.street,
        number: address.number,
        complement: address.complement || undefined,
        district: address.district,
        city: address.city,
        state: address.state,
        reference: address.reference || undefined,
        lat: address.lat ?? undefined,
        lng: address.lng ?? undefined,
      });
      toastSuccess('Dados salvos.');
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen footer={editable ? <Button title="Salvar" onPress={save} loading={busy} fullWidth /> : undefined}>
      {!editable ? <Text tone="muted">Cadastro em análise ou aprovado: para alterar estes dados, fale com o suporte.</Text> : null}
      {driver.user.cpfMasked ? (
        <Field label="CPF" value={driver.user.cpfMasked} editable={false} />
      ) : (
        <Field label="CPF" value={form.cpf} onChangeText={(cpf) => setForm({ ...form, cpf: maskCpf(cpf) })} keyboardType="number-pad" editable={editable} />
      )}
      <Field label="Data de nascimento" value={form.birthDate} placeholder="DD/MM/AAAA" onChangeText={(birthDate) => setForm({ ...form, birthDate: maskDate(birthDate) })} keyboardType="number-pad" editable={editable} />
      {motorized ? (
        <Section title="CNH">
          <Field
            label="Número da CNH"
            value={form.cnhNumber}
            placeholder={driver.cnhNumberMasked ?? '11 dígitos'}
            hint={driver.cnhNumberMasked ? 'Já informado. Preencha apenas para alterar.' : undefined}
            onChangeText={(value) => setForm({ ...form, cnhNumber: value.replace(/\D/g, '').slice(0, 11) })}
            keyboardType="number-pad"
            editable={editable}
          />
          <Row gap={2} style={{ flexWrap: 'wrap' }}>
            {CNH_CATEGORIES.map((category) => (
              <Chip key={category} label={category} selected={form.cnhCategory === category} onPress={() => editable && setForm({ ...form, cnhCategory: category })} />
            ))}
          </Row>
          <Field label="Validade" value={form.cnhExpiresAt} placeholder="DD/MM/AAAA" onChangeText={(value) => setForm({ ...form, cnhExpiresAt: maskDate(value) })} keyboardType="number-pad" editable={editable} />
        </Section>
      ) : null}
      {editable ? (
        <Section title="Endereço residencial">
          <AddressFields value={address} onChange={setAddress} errors={errors} />
        </Section>
      ) : null}
      {error ? <Text tone="danger">{error}</Text> : null}
    </Screen>
  );
}
