'use client';

import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { ArrowDownToLine, QrCode } from 'lucide-react';
import { formatBRL, LEDGER_ENTRY_LABELS, LedgerEntryType } from '@levoja/shared';
import { api, useApi, useApiMutation } from '@levoja/web-kit/client';
import {
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  ErrorState,
  errorMessage,
  MoneyInput,
  PixCharge,
  SignedAmount,
  SkeletonRows,
  StatCard,
  useToast,
  WalletStatement,
  WithdrawalHistory,
  WithdrawalView,
} from '@levoja/web-kit/ui';

export interface WalletOverview {
  id: string;
  availableCents: number;
  pendingCents: number;
  debtCents: number;
  monthTotals: Partial<Record<LedgerEntryType, number>>;
  cashLimitCents: number | null;
  cashLimitReached: boolean;
  canSettleDebtOnline: boolean;
  withdrawal: { mode: 'manual' | 'automatic'; minCents: number; feeCents: number; pixKey: string | null; open: WithdrawalView | null };
}

interface DebtCharge {
  id: string;
  amountCents: number;
  status: string;
  pixCopyPaste: string | null;
  pixExpiresAt: string | null;
}

interface PaymentMethodsInfo {
  sandbox: { cardTokens: Record<string, string> } | null;
}

/** Quitação do saldo devedor por PIX, com confirmação automática quando o pagamento cai. */
function SettleDebtDialog({ path, onClose, onPaid }: { path: string; onClose: () => void; onPaid: () => void }) {
  const toast = useToast();
  const [charge, setCharge] = useState<DebtCharge | null>(null);
  const [error, setError] = useState<string>();
  const { data: methods } = useApi<PaymentMethodsInfo>('payments/methods');

  useEffect(() => {
    let active = true;
    api
      .post<DebtCharge>(path)
      .then((result) => active && setCharge(result))
      .catch((err) => active && setError(errorMessage(err)));
    return () => {
      active = false;
    };
  }, [path]);

  // Consulta periódica: o provedor confirma o PIX por webhook; aqui só acompanhamos.
  useEffect(() => {
    if (!charge) return;
    const timer = setInterval(async () => {
      try {
        const status = await api.post<{ status: string }>(`payments/${charge.id}/sync`);
        if (status.status === 'PAID') {
          clearInterval(timer);
          toast.success('Pagamento confirmado. Saldo quitado!');
          onPaid();
          onClose();
        }
      } catch {
        // tenta novamente no próximo ciclo
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [charge, onClose, onPaid, toast]);

  return (
    <Dialog open onClose={onClose} title="Quitar saldo devedor" description="Pague com PIX pelo app do seu banco. A confirmação é automática.">
      {error && <p className="text-sm text-danger">{error}</p>}
      {!charge && !error && <SkeletonRows rows={3} />}
      {charge?.pixCopyPaste && (
        <div className="space-y-4">
          <PixCharge copyPaste={charge.pixCopyPaste} expiresAt={charge.pixExpiresAt} amountCents={charge.amountCents} />
          {methods?.sandbox && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={async () => {
                try {
                  await api.post(`payments/sandbox/${charge.id}/approve`);
                  toast.success('Pagamento simulado (ambiente de testes).');
                  onPaid();
                  onClose();
                } catch (err) {
                  toast.error(err);
                }
              }}
            >
              Simular pagamento (ambiente de testes)
            </Button>
          )}
        </div>
      )}
    </Dialog>
  );
}

function WithdrawForm({ overview, path, onDone }: { overview: WalletOverview; path: string; onDone: () => void }) {
  const toast = useToast();
  const { withdrawal } = overview;
  const max = Math.max(0, overview.availableCents - withdrawal.feeCents);
  const [amount, setAmount] = useState<number | null>(max >= withdrawal.minCents ? max : null);
  const [error, setError] = useState<string>();
  const request = useApiMutation((cents: number) => api.post(path, { amountCents: cents }), [path, 'drivers/me/wallet', 'companies/']);

  if (withdrawal.open) {
    return (
      <p className="text-sm text-muted">
        Saque de <strong className="text-fg">{formatBRL(withdrawal.open.amountCents)}</strong> em andamento para {withdrawal.open.destination}. Aguarde a conclusão para solicitar outro.
      </p>
    );
  }
  if (!withdrawal.pixKey) return <p className="text-sm text-muted">Cadastre uma chave PIX nos dados bancários para solicitar saques.</p>;
  if (max < withdrawal.minCents) {
    return <p className="text-sm text-muted">O saque mínimo é de {formatBRL(withdrawal.minCents)}{withdrawal.feeCents ? ` (+ tarifa de ${formatBRL(withdrawal.feeCents)})` : ''}. Seu saldo disponível ainda não permite.</p>;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    if (!amount || amount < withdrawal.minCents || amount > max) return setError(`Informe um valor entre ${formatBRL(withdrawal.minCents)} e ${formatBRL(max)}.`);
    try {
      await request.mutateAsync(amount);
      toast.success(withdrawal.mode === 'automatic' ? 'Saque solicitado. Você será avisado quando o PIX for enviado.' : 'Saque solicitado. A equipe financeira fará a transferência e você será avisado.');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <MoneyInput className="sm:w-48" label="Valor do saque" value={amount} onChange={setAmount} required />
      <Button type="submit" loading={request.isPending} icon={<ArrowDownToLine className="h-4 w-4" />}>
        Sacar para {withdrawal.pixKey}
      </Button>
      {withdrawal.feeCents > 0 && <p className="text-xs text-muted sm:self-center">Tarifa: {formatBRL(withdrawal.feeCents)}</p>}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </form>
  );
}

/** Painel financeiro de parceiro: saldos, saque, quitação de dívida, histórico de saques e extrato. */
export function WalletPanel({
  overviewPath,
  transactionsPath,
  withdrawalsPath,
  settleDebtPath,
  canWithdraw,
  releaseHint,
  children,
}: {
  overviewPath: string;
  transactionsPath: string;
  withdrawalsPath: string;
  settleDebtPath: string;
  canWithdraw: boolean;
  releaseHint?: string;
  children?: ReactNode;
}) {
  const toast = useToast();
  const { data, error, isLoading, refetch } = useApi<WalletOverview>(overviewPath);
  const [settling, setSettling] = useState(false);
  const [canceling, setCanceling] = useState<WithdrawalView | null>(null);
  const [version, setVersion] = useState(0);
  const reload = () => {
    void refetch();
    setVersion((v) => v + 1);
  };

  if (isLoading) return <SkeletonRows rows={4} />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  const monthly = Object.entries(data.monthTotals).filter(([, cents]) => cents);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Disponível para saque" value={formatBRL(Math.max(0, data.availableCents))} tone={data.availableCents > 0 ? 'success' : 'neutral'} />
        <StatCard label="A liberar" value={formatBRL(data.pendingCents)} hint={releaseHint} />
        <StatCard label="Saldo devedor" value={formatBRL(data.debtCents)} tone={data.debtCents > 0 ? 'danger' : 'neutral'} hint={data.cashLimitCents != null ? `Limite para receber em dinheiro: ${formatBRL(data.cashLimitCents)}` : undefined} />
      </div>

      {data.debtCents > 0 && (
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <p className="font-semibold text-fg">{data.cashLimitReached ? 'Limite de dinheiro em mãos atingido' : 'Você tem saldo devedor'}</p>
              <p className="text-muted">
                {data.cashLimitReached
                  ? 'Enquanto a dívida estiver acima do limite, você não recebe pedidos pagos em dinheiro.'
                  : 'Valores recebidos em dinheiro ou entregas faturadas. Os próximos ganhos também abatem a dívida automaticamente.'}
              </p>
            </div>
            {data.canSettleDebtOnline && (
              <Button icon={<QrCode className="h-4 w-4" />} onClick={() => setSettling(true)}>
                Pagar {formatBRL(data.debtCents)} com PIX
              </Button>
            )}
          </div>
        </Card>
      )}

      {canWithdraw && (
        <Card title="Sacar">
          <WithdrawForm key={`${data.availableCents}-${data.withdrawal.open?.id ?? ''}`} overview={data} path={withdrawalsPath} onDone={reload} />
        </Card>
      )}

      {monthly.length > 0 && (
        <Card title="Resumo do mês">
          <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {monthly.map(([type, cents]) => (
              <li key={type} className="flex justify-between rounded-lg bg-surface-2 px-3 py-2">
                <span>{LEDGER_ENTRY_LABELS[type as LedgerEntryType]}</span>
                <SignedAmount cents={cents ?? 0} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Saques">
        <WithdrawalHistory key={`w-${version}`} path={withdrawalsPath} onCancel={canWithdraw ? setCanceling : undefined} />
      </Card>

      <Card title="Extrato">
        <WalletStatement key={`s-${version}`} path={transactionsPath} />
      </Card>

      {children}

      {settling && <SettleDebtDialog path={settleDebtPath} onClose={() => setSettling(false)} onPaid={reload} />}
      {canceling && (
        <ConfirmDialog
          open
          onClose={() => setCanceling(null)}
          onConfirm={async () => {
            await api.post(`${withdrawalsPath}/${canceling.id}/cancel`);
            toast.success('Saque cancelado; o valor voltou ao saldo.');
            reload();
          }}
          title="Cancelar saque"
          description={`O valor de ${formatBRL(canceling.amountCents)} volta para o seu saldo disponível.`}
          confirmLabel="Cancelar saque"
          tone="danger"
        />
      )}
    </div>
  );
}
