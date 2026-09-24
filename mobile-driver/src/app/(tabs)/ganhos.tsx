import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { LEDGER_ENTRY_LABELS, WITHDRAWAL_STATUS_LABELS, type LedgerEntryType } from '@levoja/shared';
import {
  api,
  Badge,
  Button,
  Card,
  confirm,
  EmptyState,
  ErrorView,
  formatBRL,
  formatDateTime,
  Loading,
  MoneyField,
  PixCharge,
  Row,
  Screen,
  Section,
  Sheet,
  Stack,
  Text,
  useApi,
  useColors,
  useInfiniteApi,
  useInvalidate,
  useToast,
  type Paginated,
} from '@levoja/mobile-kit';
import type { WalletOverview, WithdrawalView } from '@/lib/types';

interface Entry {
  id: string;
  type: LedgerEntryType;
  amountCents: number;
  status: 'PENDING' | 'AVAILABLE' | 'CANCELED';
  availableAt: string | null;
  description: string;
  createdAt: string;
}

interface DebtCharge {
  id: string;
  amountCents: number;
  status: string;
  pixCopyPaste: string | null;
  pixExpiresAt: string | null;
}

function SettleDebt({ onClose, onPaid }: { onClose: () => void; onPaid: () => void }) {
  const toast = useToast();
  const [charge, setCharge] = useState<DebtCharge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const methods = useApi<{ sandbox: unknown }>('payments/methods');

  useEffect(() => {
    api
      .post<DebtCharge>('drivers/me/wallet/settle-debt')
      .then(setCharge)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!charge) return;
    const timer = setInterval(async () => {
      const result = await api.post<{ status: string }>(`payments/${charge.id}/sync`).catch(() => null);
      if (result?.status === 'PAID') {
        clearInterval(timer);
        toast.success('Pagamento confirmado. Saldo quitado!');
        onPaid();
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [charge, onPaid, toast]);

  return (
    <Sheet visible onClose={onClose} title="Quitar saldo devedor">
      {error ? <Text tone="danger">{error}</Text> : null}
      {!charge && !error ? <Loading /> : null}
      {charge?.pixCopyPaste ? (
        <Stack>
          <PixCharge copyPaste={charge.pixCopyPaste} expiresAt={charge.pixExpiresAt} amountCents={charge.amountCents} />
          {methods.data?.sandbox ? (
            <Button
              title="Simular pagamento (ambiente de testes)"
              variant="ghost"
              onPress={() =>
                api
                  .post(`payments/sandbox/${charge.id}/approve`)
                  .then(() => {
                    toast.success('Pagamento simulado.');
                    onPaid();
                  })
                  .catch(toast.error)
              }
            />
          ) : null}
        </Stack>
      ) : null}
    </Sheet>
  );
}

export default function EarningsTab() {
  const colors = useColors();
  const toast = useToast();
  const invalidate = useInvalidate();
  const wallet = useApi<WalletOverview>('drivers/me/wallet');
  const withdrawals = useApi<Paginated<WithdrawalView>>('drivers/me/withdrawals', { pageSize: 5 });
  const statement = useInfiniteApi<Entry>('drivers/me/wallet/transactions');
  const [amount, setAmount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [settling, setSettling] = useState(false);

  const reload = () => void invalidate('drivers/me/wallet', 'drivers/me/withdrawals');

  if (wallet.isLoading) return <Loading />;
  if (wallet.error || !wallet.data) return <ErrorView error={wallet.error} onRetry={() => wallet.refetch()} />;
  const data = wallet.data;
  const max = Math.max(0, data.availableCents - data.withdrawal.feeCents);

  const withdraw = async () => {
    const value = amount ?? max;
    if (value < data.withdrawal.minCents || value > max) return toast.error(new Error(`Informe um valor entre ${formatBRL(data.withdrawal.minCents)} e ${formatBRL(max)}.`));
    if (!(await confirm('Confirmar saque', `${formatBRL(value)} para ${data.withdrawal.pixKey}${data.withdrawal.feeCents ? ` (tarifa ${formatBRL(data.withdrawal.feeCents)})` : ''}.`, { confirmLabel: 'Sacar' }))) return;
    setBusy(true);
    try {
      await api.post('drivers/me/withdrawals', { amountCents: value });
      toast.success(data.withdrawal.mode === 'automatic' ? 'Saque solicitado. Você será avisado quando o PIX for enviado.' : 'Saque solicitado. A equipe financeira fará a transferência.');
      setAmount(null);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshing={wallet.isRefetching} onRefresh={() => { reload(); void statement.refetch(); }}>
      <Card>
        <Text tone="muted">Disponível para saque</Text>
        <Text variant="display" tone={data.availableCents > 0 ? 'success' : 'default'}>
          {formatBRL(Math.max(0, data.availableCents))}
        </Text>
        <Row gap={4} style={{ marginTop: 8 }}>
          <View>
            <Text variant="caption" tone="muted">A liberar</Text>
            <Text weight="600">{formatBRL(data.pendingCents)}</Text>
          </View>
          <View>
            <Text variant="caption" tone="muted">Saldo devedor</Text>
            <Text weight="600" tone={data.debtCents ? 'danger' : 'default'}>{formatBRL(data.debtCents)}</Text>
          </View>
        </Row>
      </Card>

      {data.debtCents > 0 ? (
        <Card style={{ borderColor: colors.danger, borderWidth: data.cashLimitReached ? 2 : 1 }}>
          <Stack gap={2}>
            <Text weight="700" tone={data.cashLimitReached ? 'danger' : 'default'}>
              {data.cashLimitReached ? 'Limite de dinheiro em mãos atingido' : 'Você tem saldo devedor'}
            </Text>
            <Text variant="caption" tone="muted">
              É o dinheiro recebido de clientes nas entregas. {data.cashLimitCents != null ? `Acima de ${formatBRL(data.cashLimitCents)} você deixa de receber pedidos pagos em dinheiro.` : ''} Os próximos ganhos também abatem a dívida.
            </Text>
            {data.canSettleDebtOnline ? <Button title={`Pagar ${formatBRL(data.debtCents)} com PIX`} icon="pix" onPress={() => setSettling(true)} /> : null}
          </Stack>
        </Card>
      ) : null}

      <Section title="Sacar">
        {data.withdrawal.open ? (
          <Card>
            <Row justify="space-between">
              <Text weight="700">{formatBRL(data.withdrawal.open.amountCents)}</Text>
              <Badge label={WITHDRAWAL_STATUS_LABELS[data.withdrawal.open.status]} tone="info" />
            </Row>
            <Text variant="caption" tone="muted">Para {data.withdrawal.open.destination} · {formatDateTime(data.withdrawal.open.createdAt)}</Text>
            {data.withdrawal.open.status === 'REQUESTED' ? (
              <Button
                title="Cancelar saque"
                variant="ghost"
                onPress={() =>
                  api
                    .post(`drivers/me/withdrawals/${data.withdrawal.open!.id}/cancel`)
                    .then(() => {
                      toast.success('Saque cancelado.');
                      reload();
                    })
                    .catch(toast.error)
                }
              />
            ) : null}
          </Card>
        ) : !data.withdrawal.pixKey ? (
          <Card onPress={() => router.push('/conta/dados-bancarios')}>
            <Text>Cadastre sua chave PIX para sacar.</Text>
          </Card>
        ) : max < data.withdrawal.minCents ? (
          <Text tone="muted">
            O saque mínimo é {formatBRL(data.withdrawal.minCents)}
            {data.withdrawal.feeCents ? ` (+ tarifa ${formatBRL(data.withdrawal.feeCents)})` : ''}.
          </Text>
        ) : (
          <Stack>
            <MoneyField label={`Valor (máx. ${formatBRL(max)})`} value={amount ?? max} onChange={setAmount} hint={`PIX para ${data.withdrawal.pixKey}`} />
            <Button title="Solicitar saque" icon="download" loading={busy} onPress={withdraw} />
          </Stack>
        )}
      </Section>

      {withdrawals.data?.data.length ? (
        <Section title="Saques recentes">
          {withdrawals.data.data.map((item) => (
            <Row key={item.id} justify="space-between" style={{ paddingVertical: 6 }}>
              <View>
                <Text weight="600">{formatBRL(item.amountCents)}</Text>
                <Text variant="caption" tone="muted">{formatDateTime(item.createdAt)}</Text>
              </View>
              <Badge label={WITHDRAWAL_STATUS_LABELS[item.status]} tone={item.status === 'PAID' ? 'success' : item.status === 'REJECTED' || item.status === 'FAILED' ? 'danger' : 'info'} />
            </Row>
          ))}
        </Section>
      ) : null}

      <Section title="Extrato">
        {statement.items.length === 0 && !statement.isLoading ? <EmptyState icon="receipt" title="Nenhuma movimentação" /> : null}
        {statement.items.map((entry) => (
          <Row key={entry.id} gap={3} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ flex: 1 }}>
              <Text weight="600" numberOfLines={2}>{entry.description}</Text>
              <Text variant="caption" tone="muted">
                {LEDGER_ENTRY_LABELS[entry.type]} · {formatDateTime(entry.createdAt)}
                {entry.status === 'PENDING' ? ` · libera ${formatDateTime(entry.availableAt)}` : ''}
              </Text>
            </View>
            <Text weight="700" tone={entry.amountCents < 0 ? 'danger' : 'success'}>
              {entry.amountCents > 0 ? '+' : ''}
              {formatBRL(entry.amountCents)}
            </Text>
          </Row>
        ))}
        {statement.hasNextPage ? <Button title="Carregar mais" variant="ghost" loading={statement.isFetchingNextPage} onPress={() => statement.fetchNextPage()} /> : null}
      </Section>

      {settling ? (
        <SettleDebt
          onClose={() => setSettling(false)}
          onPaid={() => {
            setSettling(false);
            reload();
          }}
        />
      ) : null}
    </Screen>
  );
}
