import { useState } from 'react';
import { isValidCnpj, isValidCpf, maskCpf } from '@levoja/shared';
import { api, Button, Card, Chip, errorMessage, ErrorView, Field, Loading, Row, Screen, Section, Text, useApi, useAuth, useToast } from '@levoja/mobile-kit';
import type { DriverProfile } from '@/lib/types';

const ACCOUNT_TYPES = [
  { value: 'CHECKING', label: 'Corrente' },
  { value: 'SAVINGS', label: 'Poupança' },
  { value: 'PAYMENT', label: 'Pagamento' },
];
const PIX_TYPES = [
  { value: 'CPF', label: 'CPF' },
  { value: 'EMAIL', label: 'E-mail' },
  { value: 'PHONE', label: 'Celular' },
  { value: 'RANDOM', label: 'Aleatória' },
];

export default function BankAccountScreen() {
  const profile = useApi<DriverProfile>('drivers/me');
  if (profile.isLoading) return <Loading />;
  if (profile.error || !profile.data) return <ErrorView error={profile.error} onRetry={() => profile.refetch()} />;
  return <BankForm driver={profile.data} onSaved={() => profile.refetch()} />;
}

function BankForm({ driver, onSaved }: { driver: DriverProfile; onSaved: () => void }) {
  const toast = useToast();
  const { me } = useAuth();
  const current = driver.bankAccount;
  const [form, setForm] = useState({
    holderName: current?.holderName ?? me?.user.name ?? '',
    holderDocument: '',
    bankCode: current?.bankCode ?? '',
    branch: current?.branch ?? '',
    accountNumber: '',
    accountType: current?.accountType ?? 'CHECKING',
    pixKeyType: current?.pixKeyType ?? 'CPF',
    pixKey: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    const document = form.holderDocument.replace(/\D/g, '');
    if (!isValidCpf(document) && !isValidCnpj(document)) return setError('CPF/CNPJ do titular inválido.');
    if (!/^\d{3}$/.test(form.bankCode)) return setError('Código do banco com 3 dígitos (ex.: 260).');
    if (!form.branch || !form.accountNumber) return setError('Informe agência e conta.');
    if (!form.pixKey.trim()) return setError('Informe a chave PIX.');
    setBusy(true);
    try {
      await api.put('drivers/me/bank-account', { ...form, holderDocument: document });
      toast.success('Dados bancários salvos. Por segurança, novos saques ficam retidos por 24 h após alterações.');
      setForm({ ...form, holderDocument: '', accountNumber: '', pixKey: '' });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button title="Salvar" onPress={save} loading={busy} fullWidth />}>
      {current ? (
        <Card>
          <Text weight="700">Chave PIX atual: {current.pixKeyMasked ?? '—'}</Text>
          <Text variant="caption" tone="muted">
            Banco {current.bankCode} · ag. {current.branch} · conta final {current.accountLast4}
          </Text>
          <Text variant="caption" tone="muted">
            Por segurança os dados completos não são exibidos. Preencha abaixo para substituir.
          </Text>
        </Card>
      ) : (
        <Text tone="muted">Os saques são enviados por PIX para a chave cadastrada aqui, em nome do titular.</Text>
      )}
      <Field label="Nome do titular" value={form.holderName} onChangeText={(holderName) => setForm({ ...form, holderName })} />
      <Field label="CPF/CNPJ do titular" value={form.holderDocument} onChangeText={(value) => setForm({ ...form, holderDocument: value.replace(/\D/g, '').length <= 11 ? maskCpf(value) : value })} keyboardType="number-pad" />
      <Row gap={3}>
        <Field label="Banco" value={form.bankCode} onChangeText={(bankCode) => setForm({ ...form, bankCode: bankCode.replace(/\D/g, '').slice(0, 3) })} keyboardType="number-pad" placeholder="260" containerStyle={{ flex: 1 }} />
        <Field label="Agência" value={form.branch} onChangeText={(branch) => setForm({ ...form, branch: branch.replace(/\D/g, '').slice(0, 6) })} keyboardType="number-pad" containerStyle={{ flex: 1 }} />
      </Row>
      <Field label="Conta (com dígito)" value={form.accountNumber} onChangeText={(accountNumber) => setForm({ ...form, accountNumber })} keyboardType="number-pad" />
      <Section title="Tipo de conta">
        <Row gap={2}>
          {ACCOUNT_TYPES.map((item) => (
            <Chip key={item.value} label={item.label} selected={form.accountType === item.value} onPress={() => setForm({ ...form, accountType: item.value })} />
          ))}
        </Row>
      </Section>
      <Section title="Chave PIX">
        <Row gap={2} style={{ flexWrap: 'wrap' }}>
          {PIX_TYPES.map((item) => (
            <Chip key={item.value} label={item.label} selected={form.pixKeyType === item.value} onPress={() => setForm({ ...form, pixKeyType: item.value })} />
          ))}
        </Row>
        <Field
          value={form.pixKey}
          onChangeText={(pixKey) => setForm({ ...form, pixKey })}
          placeholder={form.pixKeyType === 'EMAIL' ? 'seu@email.com' : form.pixKeyType === 'PHONE' ? '(11) 98765-4321' : form.pixKeyType === 'CPF' ? '000.000.000-00' : 'Chave aleatória'}
          keyboardType={form.pixKeyType === 'EMAIL' ? 'email-address' : form.pixKeyType === 'RANDOM' ? 'default' : 'phone-pad'}
          autoCapitalize="none"
        />
      </Section>
      {error ? <Text tone="danger">{error}</Text> : null}
    </Screen>
  );
}
