import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { PARTNER_STATUS_LABELS, type PartnerStatus } from '@levoja/shared';
import { api, Badge, Button, Card, ErrorView, Icon, ListGroup, ListItem, Loading, Row, Screen, space, Stack, Text, useApi, useAuth, useColors, useToast, type Tone } from '@levoja/mobile-kit';
import type { DriverProfile } from '@/lib/types';

const HELP: Record<PartnerStatus, string> = {
  DRAFT: 'Complete as etapas abaixo e envie seu cadastro para análise.',
  PENDING_DOCUMENTS: 'Precisamos de correções. Veja os itens indicados e envie novamente.',
  UNDER_REVIEW: 'Cadastro em análise. Avisaremos por notificação e e-mail (normalmente em até 2 dias úteis).',
  APPROVED: 'Cadastro aprovado!',
  REJECTED: 'Cadastro reprovado. Veja o motivo, ajuste e envie novamente.',
  SUSPENDED: 'Sua conta de entregador está suspensa. Fale com o suporte.',
  BLOCKED: 'Sua conta de entregador está bloqueada.',
};

const TONE: Partial<Record<PartnerStatus, Tone>> = { UNDER_REVIEW: 'info', PENDING_DOCUMENTS: 'warning', REJECTED: 'danger', SUSPENDED: 'danger', BLOCKED: 'danger', APPROVED: 'success' };

export default function Onboarding() {
  const colors = useColors();
  const toast = useToast();
  const { reload, logout } = useAuth();
  const profile = useApi<DriverProfile>('drivers/me');
  const [busy, setBusy] = useState(false);

  if (profile.isLoading) return <Loading />;
  if (profile.error || !profile.data) return <ErrorView error={profile.error} onRetry={() => profile.refetch()} />;
  const driver = profile.data;
  const pending = driver.requirements.filter((item) => !item.done);
  const done = driver.requirements.length - pending.length;

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('drivers/me/submit');
      toast.success('Cadastro enviado para análise!');
      await profile.refetch();
      await reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      refreshing={profile.isRefetching}
      onRefresh={() => {
        void profile.refetch();
        void reload();
      }}
      footer={driver.ownerActions.includes('SUBMIT') ? <Button title="Enviar para análise" onPress={submit} loading={busy} disabled={pending.length > 0} size="lg" fullWidth /> : undefined}
    >
      <Row justify="space-between">
        <Text variant="title">Seu cadastro</Text>
        <Badge label={PARTNER_STATUS_LABELS[driver.status]} tone={TONE[driver.status] ?? 'neutral'} />
      </Row>
      <Card>
        <Stack gap={2}>
          <Text>{HELP[driver.status]}</Text>
          {driver.statusReason ? (
            <Text tone="warning">
              <Text weight="700" tone="warning">
                Mensagem da análise:{' '}
              </Text>
              {driver.statusReason}
            </Text>
          ) : null}
        </Stack>
      </Card>

      <Card>
        <Stack gap={3}>
          <Row justify="space-between">
            <Text variant="heading">Checklist</Text>
            <Text tone="muted">
              {done}/{driver.requirements.length}
            </Text>
          </Row>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border }}>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.brand, width: `${driver.requirements.length ? (done / driver.requirements.length) * 100 : 0}%` }} />
          </View>
          {driver.requirements.map((item) => (
            <Row key={item.key} gap={2} align="flex-start">
              <Icon name={item.done ? 'checkCircle' : 'info'} size={18} color={item.done ? colors.success : colors.muted} />
              <View style={{ flex: 1 }}>
                <Text>{item.label}</Text>
                {item.detail ? (
                  <Text variant="caption" tone="muted">
                    {item.detail}
                  </Text>
                ) : null}
              </View>
            </Row>
          ))}
        </Stack>
      </Card>

      <ListGroup title="Etapas">
        <ListItem icon="person" title="Dados pessoais e CNH" onPress={() => router.push('/cadastro/dados')} />
        <ListItem icon="scooter" title="Veículo" onPress={() => router.push('/cadastro/veiculo')} />
        <ListItem icon="document" title="Documentos" subtitle={`${driver.documents.length} enviado(s)`} onPress={() => router.push('/cadastro/documentos')} />
        <ListItem icon="pix" title="Chave PIX para receber" subtitle={driver.bankAccount?.pixKeyMasked ?? 'Não cadastrada'} onPress={() => router.push('/conta/dados-bancarios')} />
      </ListGroup>

      <ListGroup>
        <ListItem icon="shield" title="Privacidade" onPress={() => router.push('/conta/privacidade')} />
        <ListItem icon="logout" title="Sair" destructive chevron={false} onPress={logout} />
      </ListGroup>
      <Text variant="caption" tone="muted" align="center" style={{ marginTop: space(2) }}>
        Depois da aprovação, o app libera as ofertas de entrega.
      </Text>
    </Screen>
  );
}
