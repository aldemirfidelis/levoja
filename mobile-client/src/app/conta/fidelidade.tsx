import { useState } from 'react';
import { View } from 'react-native';
import { LOYALTY_TRANSACTION_LABELS } from '@levoja/shared';
import { api, Button, Card, EmptyState, ErrorView, Field, formatBRL, formatDateTime, formatDay, Icon, Loading, Row, Screen, Section, Sheet, space, Stack, Text, useApi, useColors, useInfiniteApi, useInvalidate, useToast } from '@levoja/mobile-kit';
import type { LoyaltySummary, LoyaltyTransaction } from '@/lib/types';

const pct = (bps: number) => `${(bps / 100).toLocaleString('pt-BR')}%`;
const times = (bps: number) => `${(bps / 10_000).toLocaleString('pt-BR')}x`;

export default function LoyaltyScreen() {
  const colors = useColors();
  const toast = useToast();
  const invalidate = useInvalidate();
  const summary = useApi<LoyaltySummary>('me/loyalty');
  const history = useInfiniteApi<LoyaltyTransaction>(summary.data?.enabled ? 'me/loyalty/transactions' : null);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [points, setPoints] = useState('');
  const [busy, setBusy] = useState(false);

  if (summary.isLoading) return <Loading />;
  if (summary.error || !summary.data) return <ErrorView error={summary.error} onRetry={() => summary.refetch()} />;
  const data = summary.data;
  if (!data.enabled) {
    return (
      <Screen>
        <EmptyState icon="trophy" title="Programa de fidelidade indisponível" description="Quando o programa estiver ativo, seus pedidos entregues vão gerar pontos." />
      </Screen>
    );
  }
  const wanted = Number(points.replace(/\D/g, '')) || 0;
  const progress = data.next ? Math.min(1, data.yearPoints / data.next.tier.minPoints) : 1;

  const redeem = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ creditedCents: number }>('me/loyalty/redeem', { points: wanted });
      toast.success(`${formatBRL(result.creditedCents)} adicionados aos seus créditos.`);
      setRedeemOpen(false);
      setPoints('');
      await invalidate('me/loyalty', 'me/home', 'customers/me/wallet');
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshing={summary.isRefetching} onRefresh={() => void invalidate('me/loyalty')}>
      <Card>
        <Stack gap={3}>
          <Row gap={3}>
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="trophy" size={26} color={colors.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="caption" tone="muted">
                Seu nível
              </Text>
              <Text variant="title">{data.tier.name}</Text>
              <Text variant="caption" tone="muted">
                {times(data.tier.multiplierBps)} pontos{data.tier.cashbackBps ? ` · ${pct(data.tier.cashbackBps)} de cashback` : ''}
              </Text>
            </View>
          </Row>
          <View>
            <Text variant="display">{data.points.toLocaleString('pt-BR')}</Text>
            <Text tone="muted">pontos · valem {formatBRL(data.redeemableCents)}</Text>
          </View>
          {data.next ? (
            <View style={{ gap: 6 }}>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surface2, overflow: 'hidden' }}>
                <View style={{ width: `${Math.round(progress * 100)}%`, height: 8, backgroundColor: colors.brand }} />
              </View>
              <Text variant="caption" tone="muted">
                Faltam {data.next.missing.toLocaleString('pt-BR')} pontos (nos últimos 12 meses) para o nível {data.next.tier.name}.
              </Text>
            </View>
          ) : (
            <Text variant="caption" tone="muted">
              Você está no nível máximo. Aproveite!
            </Text>
          )}
          {data.expiresAt ? (
            <Text variant="caption" tone="warning">
              Seus pontos expiram em {formatDay(data.expiresAt)} se não houver novas compras até lá.
            </Text>
          ) : null}
          <Button title="Trocar pontos por créditos" icon="wallet" onPress={() => setRedeemOpen(true)} disabled={data.points < data.minRedeemPoints} />
          {data.points < data.minRedeemPoints ? (
            <Text variant="caption" tone="muted">
              A troca começa em {data.minRedeemPoints.toLocaleString('pt-BR')} pontos.
            </Text>
          ) : null}
        </Stack>
      </Card>

      <Section title="Como funciona">
        <Stack gap={2}>
          <Text>
            A cada {formatBRL(100)} em produtos de pedidos entregues você ganha {data.pointsPerReal.toLocaleString('pt-BR')} ponto(s), multiplicado pelo seu nível.
          </Text>
          <Text>Cada ponto vale {formatBRL(data.pointValueCents)} na troca por créditos, que você usa para pagar pedidos e entregas.</Text>
          {data.tiers.map((tier) => (
            <Row key={tier.key} gap={2}>
              <Icon name={tier.key === data.tier.key ? 'checkCircle' : 'trophy'} size={18} color={tier.key === data.tier.key ? colors.success : colors.muted} />
              <Text style={{ flex: 1 }}>
                <Text weight="700">{tier.name}</Text>
                {tier.minPoints ? ` a partir de ${tier.minPoints.toLocaleString('pt-BR')} pontos/ano` : ' (início)'} · {times(tier.multiplierBps)} pontos
                {tier.cashbackBps ? ` · ${pct(tier.cashbackBps)} de cashback` : ''}
              </Text>
            </Row>
          ))}
        </Stack>
      </Section>

      <Section title="Extrato">
        {history.items.length === 0 && !history.isLoading ? <Text tone="muted">Nenhum movimento ainda. Faça um pedido para começar a pontuar.</Text> : null}
        {history.items.map((entry) => (
          <Row key={entry.id} gap={3} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ flex: 1 }}>
              <Text weight="600">{entry.description}</Text>
              <Text variant="caption" tone="muted">
                {LOYALTY_TRANSACTION_LABELS[entry.type]} · {formatDateTime(entry.createdAt)}
              </Text>
            </View>
            <Text weight="700" tone={entry.points < 0 ? 'danger' : 'success'}>
              {entry.points > 0 ? '+' : ''}
              {entry.points.toLocaleString('pt-BR')}
            </Text>
          </Row>
        ))}
        {history.hasNextPage ? <Button title="Carregar mais" variant="ghost" onPress={() => history.fetchNextPage()} /> : null}
      </Section>

      <Sheet
        visible={redeemOpen}
        onClose={() => setRedeemOpen(false)}
        title="Trocar pontos"
        footer={
          <Button
            title={wanted ? `Trocar por ${formatBRL(Math.floor(wanted * data.pointValueCents))}` : 'Trocar'}
            onPress={redeem}
            loading={busy}
            disabled={wanted < data.minRedeemPoints || wanted > data.points}
            fullWidth
          />
        }
      >
        <Stack gap={3}>
          <Field
            label="Quantos pontos?"
            value={points}
            onChangeText={setPoints}
            keyboardType="number-pad"
            hint={`Mínimo ${data.minRedeemPoints.toLocaleString('pt-BR')} · disponível ${data.points.toLocaleString('pt-BR')}`}
          />
          <Row gap={2}>
            <Button title="Tudo" size="sm" variant="secondary" onPress={() => setPoints(String(data.points))} />
            <Button title={`Mínimo (${data.minRedeemPoints})`} size="sm" variant="secondary" onPress={() => setPoints(String(data.minRedeemPoints))} />
          </Row>
          <Text variant="caption" tone="muted" style={{ marginBottom: space(2) }}>
            O valor entra na hora nos seus créditos. A troca não pode ser desfeita.
          </Text>
        </Stack>
      </Sheet>
    </Screen>
  );
}
