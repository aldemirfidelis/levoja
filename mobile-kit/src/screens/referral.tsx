import { useEffect, useState } from 'react';
import { Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { normalizeReferralCode, REFERRAL_STATUS_LABELS, type ReferralProgram, type ReferralStatus } from '@levoja/shared';
import { api } from '../api';
import { kitConfig } from '../config';
import { formatBRL, formatDay } from '../format';
import { useApi } from '../query';
import { space, useColors, type Tone } from '../theme';
import { EmptyState, ErrorView, Loading, useToast } from '../ui/feedback';
import { Icon } from '../ui/icon';
import { Screen } from '../ui/layout';
import { Badge, Button, Card, Field, Row, Section, Stack, Text } from '../ui/primitives';

interface ReferralRow {
  id: string;
  program: ReferralProgram;
  name: string;
  status: ReferralStatus;
  rewardCents: number;
  expiresAt: string;
  rewardedAt: string | null;
  createdAt: string;
}

type MyReferrals =
  | { enabled: false }
  | {
      enabled: true;
      code: string;
      programEnabled: boolean;
      referrerRewardCents: number;
      referredRewardCents: number;
      goal: string;
      windowDays: number;
      programs: { program: ReferralProgram; referrerRewardCents: number; referredRewardCents: number; goal: string }[];
      stats: { total: number; pending: number; rewarded: number; earnedCents: number };
      referrals: ReferralRow[];
    };

const STATUS_TONE: Record<ReferralStatus, Tone> = { PENDING: 'warning', REWARDED: 'success', REJECTED: 'danger', EXPIRED: 'neutral' };
const WHO: Record<ReferralProgram, string> = { CUSTOMER: 'amigos', DRIVER: 'entregadores', COMPANY: 'empresas' };

/** "Indique e ganhe": código para compartilhar, regras do programa e indicações feitas. */
export function ReferralScreen({ program, appName = 'LevoJá' }: { program: ReferralProgram; appName?: string }) {
  const colors = useColors();
  const toast = useToast();
  const query = useApi<MyReferrals>('referrals/me', { program });
  if (query.isLoading) return <Loading />;
  if (query.error || !query.data) return <ErrorView error={query.error} onRetry={() => query.refetch()} />;
  const data = query.data;
  if (!data.enabled) {
    return (
      <Screen>
        <EmptyState icon="gift" title="Programa indisponível" description="O Indique e ganhe não está ativo no momento. Avisaremos quando voltar." />
      </Screen>
    );
  }
  const link = `${kitConfig().webUrl}/convite/${data.code}`;
  const share = () =>
    Share.share({
      message: `Use meu código ${data.code} no cadastro do ${appName}${data.referredRewardCents ? ` e ganhe ${formatBRL(data.referredRewardCents)}` : ''}. ${link}`,
    }).catch(() => undefined);

  return (
    <Screen refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <Card>
        <Stack gap={3}>
          <Row gap={3}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="gift" size={24} color={colors.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="heading">Indique {WHO[program]} e ganhe</Text>
              {data.programEnabled ? (
                <Text tone="muted">
                  Você ganha {formatBRL(data.referrerRewardCents)} por indicação
                  {data.referredRewardCents ? ` e quem você indicar ganha ${formatBRL(data.referredRewardCents)}` : ''}.
                </Text>
              ) : (
                <Text tone="muted">Indicações deste tipo estão pausadas, mas seu código continua valendo nos outros programas.</Text>
              )}
            </View>
          </Row>
          <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: colors.brand, borderRadius: 12, paddingVertical: space(3), alignItems: 'center' }}>
            <Text variant="caption" tone="muted">
              Seu código
            </Text>
            <Text variant="display" style={{ letterSpacing: 2 }}>
              {data.code}
            </Text>
          </View>
          <Row gap={2}>
            <Button title="Copiar" icon="copy" variant="secondary" style={{ flex: 1 }} onPress={() => Clipboard.setStringAsync(data.code).then(() => toast.success('Código copiado.'))} />
            <Button title="Compartilhar" icon="share" style={{ flex: 1 }} onPress={share} />
          </Row>
          <Text variant="caption" tone="muted">
            Meta para liberar a recompensa: {data.goal.charAt(0).toLowerCase() + data.goal.slice(1)}. O valor cai na sua carteira do app.
          </Text>
        </Stack>
      </Card>

      {data.programs.length > 1 ? (
        <Section title="Seu código também vale para">
          <Stack gap={2}>
            {data.programs
              .filter((item) => item.program !== program)
              .map((item) => (
                <Row key={item.program} gap={2}>
                  <Icon name={item.program === 'COMPANY' ? 'store' : item.program === 'DRIVER' ? 'scooter' : 'person'} size={18} color={colors.muted} />
                  <Text style={{ flex: 1 }}>
                    Indicar {WHO[item.program]}: você ganha {formatBRL(item.referrerRewardCents)} ({item.goal.charAt(0).toLowerCase() + item.goal.slice(1)})
                  </Text>
                </Row>
              ))}
          </Stack>
        </Section>
      ) : null}

      <Row gap={3}>
        <Card style={{ flex: 1 }}>
          <Text variant="caption" tone="muted">
            Indicações
          </Text>
          <Text variant="title">{data.stats.total}</Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text variant="caption" tone="muted">
            Aguardando meta
          </Text>
          <Text variant="title">{data.stats.pending}</Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text variant="caption" tone="muted">
            Você ganhou
          </Text>
          <Text variant="title" tone="success">
            {formatBRL(data.stats.earnedCents)}
          </Text>
        </Card>
      </Row>

      <Section title="Suas indicações">
        {data.referrals.length === 0 ? (
          <Text tone="muted">Ninguém se cadastrou com o seu código ainda. Compartilhe com quem pode gostar do {appName}.</Text>
        ) : (
          <Stack gap={0}>
            {data.referrals.map((row) => (
              <Row key={row.id} gap={3} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <View style={{ flex: 1 }}>
                  <Text weight="600">{row.name}</Text>
                  <Text variant="caption" tone="muted">
                    {row.status === 'PENDING' ? `Prazo até ${formatDay(row.expiresAt)}` : row.rewardedAt ? `Pago em ${formatDay(row.rewardedAt)}` : `Desde ${formatDay(row.createdAt)}`}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Badge label={REFERRAL_STATUS_LABELS[row.status]} tone={STATUS_TONE[row.status]} />
                  {row.status === 'REWARDED' ? (
                    <Text variant="caption" tone="success" weight="700">
                      +{formatBRL(row.rewardCents)}
                    </Text>
                  ) : null}
                </View>
              </Row>
            ))}
          </Stack>
        )}
      </Section>
    </Screen>
  );
}

interface Validation {
  valid: boolean;
  reason?: string;
  referredRewardCents?: number;
  goal?: string;
}

/** Campo opcional do cadastro: confere o código de indicação enquanto a pessoa digita. */
export function ReferralCodeField({ value, onChange, program, error }: { value: string; onChange: (value: string) => void; program: ReferralProgram; error?: string }) {
  const [check, setCheck] = useState<Validation | null>(null);
  const code = normalizeReferralCode(value);
  useEffect(() => {
    setCheck(null);
    if (code.length < 4) return;
    let active = true;
    const timer = setTimeout(() => {
      api.public
        .get<Validation>('referrals/validate', { code, program })
        .then((result) => active && setCheck(result))
        .catch(() => active && setCheck(null));
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [code, program]);
  const hint = check?.valid
    ? `Código aplicado${check.referredRewardCents ? `: você ganha ${formatBRL(check.referredRewardCents)}` : ''}${check.goal ? ` (${check.goal.charAt(0).toLowerCase() + check.goal.slice(1)})` : ''}.`
    : 'Opcional. Recebeu um convite? Informe o código de quem indicou.';
  return (
    <Field
      label="Código de indicação"
      value={value}
      onChangeText={(text) => onChange(text.toUpperCase())}
      autoCapitalize="characters"
      autoCorrect={false}
      maxLength={20}
      hint={error ? undefined : hint}
      error={error ?? (check && !check.valid ? (check.reason ?? 'Código não encontrado.') : undefined)}
    />
  );
}
