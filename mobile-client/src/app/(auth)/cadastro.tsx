import { useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { isValidEmail, maskPhone, normalizeBrazilianPhone, passwordIssues } from '@levoja/shared';
import { useLocalSearchParams } from 'expo-router';
import { Button, Checkbox, errorMessage, Field, kitConfig, ReferralCodeField, Screen, Stack, Text, useAuth } from '@levoja/mobile-kit';

export default function SignUp() {
  const { register } = useAuth();
  const params = useLocalSearchParams<{ codigo?: string }>();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', referralCode: params.codigo ?? '', acceptTerms: false, marketingOptIn: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const issues = form.password ? passwordIssues(form.password) : [];
  const open = (path: string) => WebBrowser.openBrowserAsync(`${kitConfig().webUrl}${path}`);

  const submit = async () => {
    const next: Record<string, string> = {};
    if (form.name.trim().split(' ').length < 2) next.name = 'Informe nome e sobrenome.';
    if (!isValidEmail(form.email.trim())) next.email = 'E-mail inválido.';
    if (!normalizeBrazilianPhone(form.phone)) next.phone = 'Celular inválido.';
    if (issues.length) next.password = `A senha precisa de: ${issues.join(', ')}.`;
    if (!form.acceptTerms) next.terms = 'É necessário aceitar os termos para continuar.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    try {
      await register('auth/register/customer', {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone,
        password: form.password,
        acceptTerms: true,
        acceptPrivacy: true,
        marketingOptIn: form.marketingOptIn,
        referralCode: form.referralCode.trim() || undefined,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button title="Criar conta" onPress={submit} loading={busy} fullWidth size="lg" />}>
      <Field label="Nome completo" value={form.name} onChangeText={(name) => setForm({ ...form, name })} autoComplete="name" textContentType="name" error={errors.name} />
      <Field label="E-mail" value={form.email} onChangeText={(email) => setForm({ ...form, email })} keyboardType="email-address" autoCapitalize="none" autoComplete="email" error={errors.email} />
      <Field label="Celular" value={form.phone} onChangeText={(phone) => setForm({ ...form, phone: maskPhone(phone) })} keyboardType="phone-pad" autoComplete="tel" error={errors.phone} />
      <Field label="Senha" value={form.password} onChangeText={(password) => setForm({ ...form, password })} secure autoComplete="new-password" textContentType="newPassword" error={errors.password} hint="Mínimo de 8 caracteres, com letras e números." />
      <ReferralCodeField program="CUSTOMER" value={form.referralCode} onChange={(referralCode) => setForm({ ...form, referralCode })} />
      <Stack gap={3}>
        <Checkbox
          checked={form.acceptTerms}
          onChange={(acceptTerms) => setForm({ ...form, acceptTerms })}
          label={
            <Text>
              Li e aceito os{' '}
              <Text tone="brand" onPress={() => open('/termos')}>
                Termos de Uso
              </Text>{' '}
              e estou ciente da{' '}
              <Text tone="brand" onPress={() => open('/privacidade')}>
                Política de Privacidade
              </Text>
              .
            </Text>
          }
        />
        {errors.terms ? <Text variant="caption" tone="danger">{errors.terms}</Text> : null}
        <Checkbox checked={form.marketingOptIn} onChange={(marketingOptIn) => setForm({ ...form, marketingOptIn })} label="Quero receber ofertas e novidades (opcional)." />
      </Stack>
      {error ? <Text tone="danger">{error}</Text> : null}
    </Screen>
  );
}
