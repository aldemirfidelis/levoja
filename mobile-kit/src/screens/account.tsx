import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import { File, Paths } from 'expo-file-system';
import QRCode from 'react-qr-code';
import { brDateToIso, maskCpf, maskDate, maskPhone, passwordIssues } from '@levoja/shared';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { kitConfig } from '../config';
import { formatDateTime, formatRelative } from '../format';
import { useApi, useApiMutation, useInfiniteApi } from '../query';
import { radius, space, useColors } from '../theme';
import { upload } from '../upload';
import { confirm, EmptyState, ErrorView, Loading, useToast } from '../ui/feedback';
import { Avatar, ListGroup, ListItem, Screen, ToggleRow } from '../ui/layout';
import { Badge, Button, Card, Field, Row, Stack, Text } from '../ui/primitives';

const isoToBr = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

// -----------------------------------------------------------------------------
// Perfil
// -----------------------------------------------------------------------------

export function ProfileScreen() {
  const { me, reload } = useAuth();
  const toast = useToast();
  const user = me!.user;
  const [form, setForm] = useState({ name: user.name, phone: maskPhone(user.phone?.replace(/^\+55/, '') ?? ''), birthDate: isoToBr(user.birthDate), cpf: '' });
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState<'email' | 'phone' | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const birthDate = form.birthDate ? brDateToIso(form.birthDate) : undefined;
    if (form.birthDate && !birthDate) return setError('Data de nascimento inválida (DD/MM/AAAA).');
    setBusy(true);
    try {
      await api.patch('me', { name: form.name.trim(), phone: form.phone, birthDate: birthDate ?? undefined, cpf: form.cpf || undefined });
      await reload();
      toast.success('Perfil atualizado.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const pickAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;
    try {
      const asset = result.assets[0];
      await upload('me/avatar', 'file', { uri: asset.uri, name: asset.fileName, mimeType: asset.mimeType }, {}, 'PUT');
      await reload();
      toast.success('Foto atualizada.');
    } catch (err) {
      toast.error(err);
    }
  };

  const sendCode = async (channel: 'email' | 'phone') => {
    try {
      await api.post('auth/verification/send', { channel });
      setVerifying(channel);
      setCode('');
      toast.info(channel === 'email' ? 'Enviamos um código para o seu e-mail.' : 'Enviamos um código por SMS.');
    } catch (err) {
      toast.error(err);
    }
  };

  const confirmCode = async () => {
    try {
      await api.post('auth/verification/confirm', { channel: verifying, code });
      setVerifying(null);
      await reload();
      toast.success('Verificado!');
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Screen footer={<Button title="Salvar alterações" onPress={save} loading={busy} fullWidth />}>
      <Row gap={4}>
        <Avatar uri={user.avatarUrl} name={user.name} size={72} />
        <Button title="Trocar foto" variant="secondary" icon="camera" onPress={pickAvatar} />
      </Row>
      <Field label="Nome completo" value={form.name} onChangeText={(name) => setForm({ ...form, name })} autoComplete="name" />
      <Field label="Celular" value={form.phone} onChangeText={(phone) => setForm({ ...form, phone: maskPhone(phone) })} keyboardType="phone-pad" autoComplete="tel" />
      <Field label="Data de nascimento" value={form.birthDate} placeholder="DD/MM/AAAA" onChangeText={(birthDate) => setForm({ ...form, birthDate: maskDate(birthDate) })} keyboardType="number-pad" />
      {user.cpfMasked ? (
        <Field label="CPF" value={user.cpfMasked} editable={false} />
      ) : (
        <Field label="CPF" value={form.cpf} onChangeText={(cpf) => setForm({ ...form, cpf: maskCpf(cpf) })} keyboardType="number-pad" hint="Necessário para produtos com idade mínima e para emissão de notas." />
      )}
      {error ? <Text tone="danger">{error}</Text> : null}
      <ListGroup title="Contato">
        <ListItem title={user.email} subtitle="E-mail" icon="info" right={user.emailVerified ? <Badge label="Verificado" tone="success" /> : <Button size="sm" variant="secondary" title="Verificar" onPress={() => sendCode('email')} />} />
        <ListItem
          title={user.phone ? maskPhone(user.phone.replace(/^\+55/, '')) : 'Sem celular'}
          subtitle="Celular"
          icon="phone"
          right={user.phone ? user.phoneVerified ? <Badge label="Verificado" tone="success" /> : <Button size="sm" variant="secondary" title="Verificar" onPress={() => sendCode('phone')} /> : undefined}
        />
      </ListGroup>
      {verifying ? (
        <Card>
          <Stack>
            <Field label="Código recebido" value={code} onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" />
            <Button title="Confirmar" onPress={confirmCode} disabled={code.length !== 6} />
          </Stack>
        </Card>
      ) : null}
    </Screen>
  );
}

// -----------------------------------------------------------------------------
// Segurança
// -----------------------------------------------------------------------------

interface SessionItem {
  id: string;
  lastActivityAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

export function SecurityScreen() {
  const { me, reload, logout } = useAuth();
  const toast = useToast();
  const colors = useColors();
  const [passwords, setPasswords] = useState({ current: '', next: '' });
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [mfaPassword, setMfaPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const sessions = useApi<SessionItem[]>('auth/sessions');
  const issues = passwords.next ? passwordIssues(passwords.next) : [];

  const run = async (key: string, action: () => Promise<unknown>, message: string) => {
    setBusy(key);
    try {
      await action();
      toast.success(message);
      return true;
    } catch (err) {
      toast.error(err);
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Card>
        <Stack>
          <Text variant="heading">Alterar senha</Text>
          <Field label="Senha atual" value={passwords.current} onChangeText={(current) => setPasswords({ ...passwords, current })} secure autoComplete="current-password" />
          <Field label="Nova senha" value={passwords.next} onChangeText={(next) => setPasswords({ ...passwords, next })} secure autoComplete="new-password" hint={issues.length ? `A senha precisa de: ${issues.join(', ')}.` : 'Mínimo de 8 caracteres, com letras e números.'} />
          <Button
            title="Alterar senha"
            loading={busy === 'password'}
            disabled={!passwords.current || !passwords.next || issues.length > 0}
            onPress={async () => {
              if (await run('password', () => api.post('auth/password/change', { currentPassword: passwords.current, newPassword: passwords.next }), 'Senha alterada. As outras sessões foram encerradas.')) {
                setPasswords({ current: '', next: '' });
              }
            }}
          />
        </Stack>
      </Card>

      <Card>
        <Stack>
          <Row justify="space-between">
            <Text variant="heading">Verificação em duas etapas</Text>
            <Badge label={me?.user.mfaEnabled ? 'Ativa' : 'Inativa'} tone={me?.user.mfaEnabled ? 'success' : 'warning'} />
          </Row>
          {!me?.user.mfaEnabled && !setup ? (
            <>
              <Text tone="muted">Além da senha, será pedido um código do seu app autenticador (Google Authenticator, Microsoft Authenticator...).</Text>
              <Button title="Configurar" variant="secondary" loading={busy === 'setup'} onPress={() => run('setup', async () => setSetup(await api.post('auth/mfa/setup')), 'Adicione a chave no seu autenticador.')} />
            </>
          ) : null}
          {setup ? (
            <>
              <Text>1. No app autenticador, adicione a chave abaixo (ou toque para abrir o autenticador deste aparelho).</Text>
              <Pressable onPress={() => Linking.openURL(setup.otpauthUrl).catch(() => toast.info('Nenhum app autenticador encontrado. Copie a chave.'))} accessibilityRole="button">
                <View style={{ alignSelf: 'center', padding: space(3), backgroundColor: '#ffffff', borderRadius: radius.md }}>
                  <QRCode value={setup.otpauthUrl} size={160} />
                </View>
              </Pressable>
              <Row gap={2}>
                <Text variant="caption" style={{ flex: 1, fontFamily: 'monospace' }} selectable>
                  {setup.secret}
                </Text>
                <Button size="sm" variant="secondary" title="Copiar" icon="copy" onPress={() => Clipboard.setStringAsync(setup.secret).then(() => toast.success('Chave copiada.'))} />
              </Row>
              <Field label="2. Código gerado" value={code} onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" />
              <Button
                title="Ativar"
                disabled={code.length !== 6}
                loading={busy === 'enable'}
                onPress={async () => {
                  if (await run('enable', () => api.post('auth/mfa/enable', { code }), 'Verificação em duas etapas ativada.')) {
                    setSetup(null);
                    setCode('');
                    await reload();
                  }
                }}
              />
            </>
          ) : null}
          {me?.user.mfaEnabled ? (
            <>
              <Field label="Senha" value={mfaPassword} onChangeText={setMfaPassword} secure />
              <Field label="Código atual" value={code} onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" />
              <Button
                title="Desativar"
                variant="danger"
                disabled={!mfaPassword || code.length !== 6}
                loading={busy === 'disable'}
                onPress={async () => {
                  if (await run('disable', () => api.post('auth/mfa/disable', { password: mfaPassword, code }), 'Verificação em duas etapas desativada.')) {
                    setCode('');
                    setMfaPassword('');
                    await reload();
                  }
                }}
              />
            </>
          ) : null}
        </Stack>
      </Card>

      <Text variant="heading">Sessões ativas</Text>
      {sessions.isLoading ? <Loading /> : null}
      {sessions.error ? <ErrorView error={sessions.error} onRetry={() => sessions.refetch()} /> : null}
      {sessions.data ? (
        <ListGroup>
          {sessions.data.map((item) => (
            <ListItem
              key={item.id}
              title={item.userAgent ?? 'Dispositivo desconhecido'}
              subtitle={`${item.ip ?? '—'} · ${formatRelative(item.lastActivityAt)}`}
              right={
                item.current ? (
                  <Badge label="Este aparelho" tone="success" />
                ) : (
                  <Button size="sm" variant="secondary" title="Encerrar" onPress={() => run(`session-${item.id}`, () => api.delete(`auth/sessions/${item.id}`), 'Sessão encerrada.').then(() => sessions.refetch())} />
                )
              }
            />
          ))}
        </ListGroup>
      ) : null}
      <Button
        title="Sair de todos os aparelhos"
        variant="secondary"
        icon="logout"
        onPress={async () => {
          if (await confirm('Sair de todos os aparelhos?', 'Todas as sessões serão encerradas, inclusive esta.', { confirmLabel: 'Sair de todos', destructive: true })) {
            await api.post('auth/logout-all').catch(() => undefined);
            await logout();
          }
        }}
      />
      <Text variant="caption" tone="muted" style={{ color: colors.muted }}>
        Se notar um acesso que não reconhece, encerre a sessão e troque sua senha.
      </Text>
    </Screen>
  );
}

// -----------------------------------------------------------------------------
// Notificações
// -----------------------------------------------------------------------------

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationsScreen({ onOpen }: { onOpen?: (notification: AppNotification) => void }) {
  const colors = useColors();
  const list = useInfiniteApi<AppNotification>('me/notifications');
  const markAll = useApiMutation(() => api.post('me/notifications/read-all'), ['me/notifications']);
  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorView error={list.error} onRetry={() => list.refetch()} />;
  return (
    <Screen refreshing={list.isRefetching} onRefresh={() => list.refetch()}>
      {list.items.some((item) => !item.readAt) ? <Button title="Marcar todas como lidas" variant="secondary" size="sm" loading={markAll.isPending} onPress={() => markAll.mutate(undefined)} /> : null}
      {list.items.length === 0 ? <EmptyState icon="bell" title="Nenhuma notificação" description="Avisos sobre pedidos, entregas e sua conta aparecem aqui." /> : null}
      {list.items.map((item) => (
        <Card
          key={item.id}
          onPress={() => {
            if (!item.readAt) void api.post(`me/notifications/${item.id}/read`).then(() => list.refetch());
            onOpen?.(item);
          }}
        >
          <Row align="flex-start" gap={3}>
            <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: item.readAt ? 'transparent' : colors.brand }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text weight="600">{item.title}</Text>
              <Text tone="muted">{item.body}</Text>
              <Text variant="caption" tone="muted">
                {formatDateTime(item.createdAt)}
              </Text>
            </View>
          </Row>
        </Card>
      ))}
      {list.hasNextPage ? <Button title="Carregar mais" variant="ghost" loading={list.isFetchingNextPage} onPress={() => list.fetchNextPage()} /> : null}
    </Screen>
  );
}

// -----------------------------------------------------------------------------
// Privacidade (LGPD)
// -----------------------------------------------------------------------------

interface ConsentStatus {
  consents: { type: string; granted: boolean; version: string | null; updatedAt: string }[];
  pendingAcceptance: string[];
}

const MARKETING = [
  { type: 'MARKETING_PUSH', label: 'Ofertas por notificação' },
  { type: 'MARKETING_EMAIL', label: 'Ofertas por e-mail' },
  { type: 'MARKETING_SMS', label: 'Ofertas por SMS' },
  { type: 'MARKETING_WHATSAPP', label: 'Ofertas por WhatsApp' },
];

export function PrivacyScreen({ extraDocuments = [] }: { extraDocuments?: { label: string; path: string }[] }) {
  const toast = useToast();
  const consents = useApi<ConsentStatus>('me/consents');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const granted = (type: string) => !!consents.data?.consents.find((consent) => consent.type === type)?.granted;
  const openDocument = (path: string) => WebBrowser.openBrowserAsync(`${kitConfig().webUrl}${path}`);

  const toggle = async (type: string, value: boolean) => {
    try {
      await api.post('me/consents', { type, granted: value });
      await consents.refetch();
    } catch (err) {
      toast.error(err);
    }
  };

  const exportData = async () => {
    setBusy('export');
    try {
      const data = await api.get<unknown>('me/data-export');
      const file = new File(Paths.cache, `meus-dados-${new Date().toISOString().slice(0, 10)}.json`);
      if (file.exists) file.delete();
      file.create();
      file.write(JSON.stringify(data, null, 2));
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Meus dados' });
      else toast.info('Arquivo gerado, mas o compartilhamento não está disponível neste aparelho.');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const requestDeletion = async () => {
    const ok = await confirm(
      'Excluir minha conta',
      'A solicitação é analisada em até 15 dias. Depois disso seus dados pessoais são anonimizados e a conta não poderá ser recuperada. Registros exigidos por lei são mantidos sem identificar você.',
      { confirmLabel: 'Solicitar exclusão', destructive: true },
    );
    if (!ok) return;
    setBusy('delete');
    try {
      await api.post('me/privacy/deletion-request', { reason: reason.trim() || undefined });
      toast.success('Solicitação registrada. Você receberá a confirmação por e-mail.');
      setReason('');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  if (consents.isLoading) return <Loading />;
  if (consents.error) return <ErrorView error={consents.error} onRetry={() => consents.refetch()} />;

  return (
    <Screen>
      {consents.data?.pendingAcceptance.length ? (
        <Card>
          <Stack>
            <Text variant="heading">Termos atualizados</Text>
            <Text tone="muted">Publicamos novas versões dos nossos documentos. Leia e aceite para continuar.</Text>
            <Button title="Li e aceito as novas versões" loading={busy === 'accept'} onPress={() => api.post('me/consents/accept-current').then(() => consents.refetch()).catch(toast.error)} />
          </Stack>
        </Card>
      ) : null}
      <ListGroup title="Comunicações de marketing">
        {MARKETING.map((item) => (
          <ToggleRow key={item.type} title={item.label} value={granted(item.type)} onChange={(value) => toggle(item.type, value)} />
        ))}
      </ListGroup>
      <Text variant="caption" tone="muted">
        Avisos sobre seus pedidos, entregas e segurança da conta são sempre enviados.
      </Text>
      <ListGroup title="Documentos">
        <ListItem title="Termos de Uso" icon="document" onPress={() => openDocument('/termos')} />
        <ListItem title="Política de Privacidade" icon="shield" onPress={() => openDocument('/privacidade')} />
        {extraDocuments.map((doc) => (
          <ListItem key={doc.path} title={doc.label} icon="document" onPress={() => openDocument(doc.path)} />
        ))}
      </ListGroup>
      <ListGroup title="Seus dados (LGPD)">
        <ListItem title="Exportar meus dados" subtitle="Arquivo JSON com seus dados pessoais" icon="download" onPress={exportData} right={busy === 'export' ? <Text tone="muted">Gerando…</Text> : undefined} />
      </ListGroup>
      <Card>
        <Stack>
          <Text variant="heading">Excluir conta</Text>
          <Field label="Motivo (opcional)" value={reason} onChangeText={setReason} multiline maxLength={500} />
          <Button title="Solicitar exclusão da conta" variant="danger" loading={busy === 'delete'} onPress={requestDeletion} />
        </Stack>
      </Card>
    </Screen>
  );
}
