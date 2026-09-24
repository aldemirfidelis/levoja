import { View } from 'react-native';
import { LEDGER_ENTRY_LABELS } from '@levoja/shared';
import { Card, EmptyState, ErrorView, formatBRL, formatDateTime, Loading, Row, Screen, Text, useApi, useColors, useInfiniteApi, Button } from '@levoja/mobile-kit';

interface Entry {
  id: string;
  type: keyof typeof LEDGER_ENTRY_LABELS;
  amountCents: number;
  description: string;
  createdAt: string;
}

export default function CreditsScreen() {
  const colors = useColors();
  const summary = useApi<{ availableCents: number }>('customers/me/wallet');
  const list = useInfiniteApi<Entry>('customers/me/wallet/transactions');
  if (summary.isLoading) return <Loading />;
  if (summary.error) return <ErrorView error={summary.error} onRetry={() => summary.refetch()} />;
  return (
    <Screen refreshing={list.isRefetching} onRefresh={() => { void summary.refetch(); void list.refetch(); }}>
      <Card>
        <Text tone="muted">Saldo de créditos</Text>
        <Text variant="display">{formatBRL(summary.data?.availableCents ?? 0)}</Text>
        <Text variant="caption" tone="muted">
          Créditos vêm de estornos e compensações. Use-os para pagar pedidos e entregas escolhendo "Créditos LevoJá".
        </Text>
      </Card>
      {list.items.length === 0 && !list.isLoading ? <EmptyState icon="wallet" title="Nenhuma movimentação" /> : null}
      {list.items.map((entry) => (
        <Row key={entry.id} gap={3} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flex: 1 }}>
            <Text weight="600">{entry.description}</Text>
            <Text variant="caption" tone="muted">
              {LEDGER_ENTRY_LABELS[entry.type]} · {formatDateTime(entry.createdAt)}
            </Text>
          </View>
          <Text weight="700" tone={entry.amountCents < 0 ? 'danger' : 'success'}>
            {entry.amountCents > 0 ? '+' : ''}
            {formatBRL(entry.amountCents)}
          </Text>
        </Row>
      ))}
      {list.hasNextPage ? <Button title="Carregar mais" variant="ghost" onPress={() => list.fetchNextPage()} /> : null}
    </Screen>
  );
}
