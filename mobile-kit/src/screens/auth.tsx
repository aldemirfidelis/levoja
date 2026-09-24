import { useState } from 'react';
import { Image, View, type ImageSourcePropType } from 'react-native';
import { isValidEmail } from '@levoja/shared';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { space } from '../theme';
import { Button, Field, Stack, Text } from '../ui/primitives';
import { Screen } from '../ui/layout';

/** Login com e-mail/telefone e senha; se a conta tiver verificação em duas etapas, pede o código. */
export function LoginScreen({
  title,
  subtitle,
  logo,
  onForgot,
  onRegister,
  registerLabel = 'Criar conta',
}: {
  title: string;
  subtitle?: string;
  logo?: ImageSourcePropType;
  onForgot: () => void;
  onRegister?: () => void;
  registerLabel?: string;
}) {
  const auth = useAuth();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!mfaToken && (login.trim().length < 5 || !password)) return setError('Informe seu e-mail ou celular e a senha.');
    setBusy(true);
    try {
      if (mfaToken) {
        await auth.completeMfa(mfaToken, code);
      } else {
        const result = await auth.login(login.trim(), password);
        if (result.mfaRequired) setMfaToken(result.mfaToken);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <>
          <Button title={mfaToken ? 'Confirmar código' : 'Entrar'} onPress={submit} loading={busy} disabled={!!mfaToken && code.length !== 6} fullWidth size="lg" />
          {onRegister && !mfaToken ? <Button title={registerLabel} variant="ghost" onPress={onRegister} /> : null}
        </>
      }
    >
      <View style={{ alignItems: 'center', gap: space(3), paddingTop: space(8), paddingBottom: space(4) }}>
        {logo ? <Image source={logo} style={{ width: 88, height: 88, borderRadius: 22 }} accessibilityIgnoresInvertColors /> : null}
        <Text variant="title" align="center">
          {title}
        </Text>
        {subtitle ? (
          <Text tone="muted" align="center">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {mfaToken ? (
        <Stack>
          <Text>Abra seu app autenticador e digite o código de 6 dígitos.</Text>
          <Field label="Código de verificação" value={code} onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" autoFocus error={error} />
          <Button
            title="Voltar"
            variant="ghost"
            onPress={() => {
              setMfaToken(null);
              setCode('');
              setError(null);
            }}
          />
        </Stack>
      ) : (
        <Stack>
          <Field label="E-mail ou celular" value={login} onChangeText={setLogin} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="username" textContentType="username" returnKeyType="next" />
          <Field label="Senha" value={password} onChangeText={setPassword} secure autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} error={error} />
          <Button title="Esqueci minha senha" variant="ghost" onPress={onForgot} style={{ alignSelf: 'flex-end' }} />
        </Stack>
      )}
    </Screen>
  );
}

/** Solicita o link de redefinição (enviado por e-mail; a nova senha é definida no portal web). */
export function ForgotPasswordScreen({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!isValidEmail(email.trim())) return setError('Informe um e-mail válido.');
    setBusy(true);
    setError(null);
    try {
      const result = await api.public.post<{ message: string }>('auth/password/forgot', { email: email.trim().toLowerCase(), portal: 'web' });
      setMessage(result.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen footer={message ? <Button title="Voltar para o login" onPress={onDone} fullWidth /> : <Button title="Enviar instruções" onPress={submit} loading={busy} fullWidth size="lg" />}>
      <Text variant="title">Redefinir senha</Text>
      {message ? (
        <Text>{message}</Text>
      ) : (
        <>
          <Text tone="muted">Informe o e-mail da sua conta. Enviaremos um link seguro para você criar uma nova senha.</Text>
          <Field label="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" error={error} onSubmitEditing={submit} />
        </>
      )}
    </Screen>
  );
}
