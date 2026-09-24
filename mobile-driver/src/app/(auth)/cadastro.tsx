import { useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import {
  brDateToIso,
  isAdult,
  isValidCpf,
  isValidEmail,
  maskCpf,
  maskDate,
  maskPhone,
  normalizeBrazilianPhone,
  passwordIssues,
  VEHICLE_TYPE_LABELS,
  VEHICLE_TYPES,
  type VehicleType,
} from '@levoja/shared';
import { Button, Checkbox, Chip, errorMessage, Field, kitConfig, Row, Screen, Section, Stack, Text, useAuth } from '@levoja/mobile-kit';

export default function DriverSignUp() {
  const { register } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', cpf: '', birthDate: '', vehicleType: 'MOTORCYCLE' as VehicleType, terms: false, location: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = (path: string) => WebBrowser.openBrowserAsync(`${kitConfig().webUrl}${path}`);

  const submit = async () => {
    const next: Record<string, string> = {};
    const birthDate = brDateToIso(form.birthDate);
    if (form.name.trim().split(' ').length < 2) next.name = 'Informe nome e sobrenome.';
    if (!isValidEmail(form.email.trim())) next.email = 'E-mail inválido.';
    if (!normalizeBrazilianPhone(form.phone)) next.phone = 'Celular inválido.';
    if (!isValidCpf(form.cpf)) next.cpf = 'CPF inválido.';
    if (!birthDate) next.birthDate = 'Data inválida (DD/MM/AAAA).';
    else if (!isAdult(new Date(`${birthDate}T12:00:00`))) next.birthDate = 'É preciso ter 18 anos ou mais.';
    const issues = passwordIssues(form.password);
    if (issues.length) next.password = `A senha precisa de: ${issues.join(', ')}.`;
    if (!form.terms) next.terms = 'Aceite os termos para continuar.';
    if (!form.location) next.location = 'A localização é necessária para fazer entregas.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    try {
      await register('auth/register/driver', {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone,
        password: form.password,
        cpf: form.cpf,
        birthDate,
        vehicleType: form.vehicleType,
        acceptTerms: true,
        acceptPrivacy: true,
        acceptDriverTerms: true,
        acceptLocationTracking: true,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button title="Criar cadastro" onPress={submit} loading={busy} size="lg" fullWidth />}>
      <Text tone="muted">Depois do cadastro, envie seus documentos pelo app. A análise leva até 2 dias úteis.</Text>
      <Field label="Nome completo" value={form.name} onChangeText={(name) => setForm({ ...form, name })} autoComplete="name" error={errors.name} />
      <Field label="E-mail" value={form.email} onChangeText={(email) => setForm({ ...form, email })} keyboardType="email-address" autoCapitalize="none" autoComplete="email" error={errors.email} />
      <Field label="Celular" value={form.phone} onChangeText={(phone) => setForm({ ...form, phone: maskPhone(phone) })} keyboardType="phone-pad" autoComplete="tel" error={errors.phone} />
      <Row gap={3} align="flex-start">
        <Field label="CPF" value={form.cpf} onChangeText={(cpf) => setForm({ ...form, cpf: maskCpf(cpf) })} keyboardType="number-pad" containerStyle={{ flex: 1 }} error={errors.cpf} />
        <Field label="Nascimento" value={form.birthDate} placeholder="DD/MM/AAAA" onChangeText={(birthDate) => setForm({ ...form, birthDate: maskDate(birthDate) })} keyboardType="number-pad" containerStyle={{ flex: 1 }} error={errors.birthDate} />
      </Row>
      <Field label="Senha" value={form.password} onChangeText={(password) => setForm({ ...form, password })} secure autoComplete="new-password" error={errors.password} hint="Mínimo de 8 caracteres, com letras e números." />
      <Section title="Seu veículo">
        <Row gap={2} style={{ flexWrap: 'wrap' }}>
          {VEHICLE_TYPES.map((type) => (
            <Chip key={type} label={VEHICLE_TYPE_LABELS[type]} selected={form.vehicleType === type} onPress={() => setForm({ ...form, vehicleType: type })} />
          ))}
        </Row>
        {form.vehicleType !== 'BICYCLE' ? (
          <Text variant="caption" tone="muted">
            Veículos motorizados exigem CNH e documento do veículo (CRLV).
          </Text>
        ) : null}
      </Section>
      <Stack gap={3}>
        <Checkbox
          checked={form.terms}
          onChange={(terms) => setForm({ ...form, terms })}
          label={
            <Text>
              Li e aceito os{' '}
              <Text tone="brand" onPress={() => open('/termos')}>
                Termos de Uso
              </Text>
              , os{' '}
              <Text tone="brand" onPress={() => open('/termos-entregador')}>
                Termos do Entregador
              </Text>{' '}
              e estou ciente da{' '}
              <Text tone="brand" onPress={() => open('/privacidade')}>
                Política de Privacidade
              </Text>
              .
            </Text>
          }
        />
        {errors.terms ? (
          <Text variant="caption" tone="danger">
            {errors.terms}
          </Text>
        ) : null}
        <Checkbox checked={form.location} onChange={(location) => setForm({ ...form, location })} label="Autorizo o uso da minha localização enquanto estiver online ou com entregas em andamento." />
        {errors.location ? (
          <Text variant="caption" tone="danger">
            {errors.location}
          </Text>
        ) : null}
      </Stack>
      {error ? <Text tone="danger">{error}</Text> : null}
    </Screen>
  );
}
