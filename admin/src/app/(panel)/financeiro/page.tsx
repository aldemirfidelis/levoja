'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { formatBRL, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, PaymentMethod, PaymentStatus, WALLET_OWNER_LABELS, WalletOwnerType, WITHDRAWAL_STATUS_LABELS, WithdrawalStatus } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { Button, Card, DataTable, ErrorState, formatDateTime, Input, PageHeader, SkeletonRows, StatCard, useToast } from '@levoja/web-kit/ui';
import { FinanceNav } from '@/components/finance-nav';
import { useUrlFilters } from '@/components/list-filters';
import { useSession } from '@/lib/session';

interface Report {
  period: { from: string; to: string };
  orders: { delivered: number; gmvCents: number; subtotalCents: number; discountCents: number; deliveryFeeCents: number; serviceFeeCents: number; tipCents: number; commissionCents: number };
  payments: { method: PaymentMethod; status: PaymentStatus; count: number; amountCents: number; refundedCents: number }[];
  platform: { byType: { type: string; label: string; amountCents: number }[]; netRevenueCents: number };
  balances: { ownerType: WalletOwnerType; wallets: number; availableCents: number; pendingCents: number; debtorWallets: number; debtCents: number }[];
  withdrawals: { byStatus: { status: WithdrawalStatus; count: number; amountCents: number; feeCents: number }[]; openCount: number; openAmountCents: number };
  anomalies: {
    unsettledOrders: { id: string; number: number; deliveredAt: string }[];
    paidCanceledOrders: { paymentId: string; orderId: string; number: number; amountCents: number }[];
    stalePixPayments: { id: string; orderId: string | null; amountCents: number; pixExpiresAt: string }[];
    stuckRefunds: { id: string; paymentId: string; amountCents: number; status: string; createdAt: string }[];
  };
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

function Overview() {
  const { can } = useSession();
  const toast = useToast();
  const today = new Date();
  const [filters, setFilters] = useUrlFilters({ from: isoDay(new Date(today.getTime() - 29 * 86_400_000)), to: isoDay(today) });
  const query = { from: `${filters.from}T00:00:00`, to: new Date(new Date(`${filters.to}T00:00:00`).getTime() + 86_400_000).toISOString() };
  const { data, error, isLoading, refetch } = useApi<Report>(can('finance.reports') ? 'admin/finance/reconciliation' : null, query);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, action: () => Promise<string>) => {
    setBusy(key);
    try {
      toast.success(await action());
      await refetch();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  if (!can('finance.reports')) {
    return (
      <>
        <PageHeader title="Financeiro" />
        <FinanceNav />
        <p className="text-sm text-muted">Seu perfil não tem acesso aos relatórios financeiros. Use as abas acima.</p>
      </>
    );
  }

  const anomalies = data?.anomalies;
  const anomalyCount = anomalies ? anomalies.unsettledOrders.length + anomalies.paidCanceledOrders.length + anomalies.stalePixPayments.length + anomalies.stuckRefunds.length : 0;
  const debt = data?.balances.find((row) => row.ownerType === 'DRIVER');

  return (
    <>
      <PageHeader
        title="Financeiro"
        description="Conciliação entre pedidos, pagamentos e o razão (ledger): receita da plataforma, saldos de parceiros, saques e pendências."
        actions={
          can('payments.manage') && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                loading={busy === 'sweep'}
                icon={<RefreshCw className="h-4 w-4" />}
                onClick={() => run('sweep', async () => `${(await api.post<{ reprocessed: number }>('admin/finance/settlements/sweep')).reprocessed} liquidação(ões) reprocessada(s).`)}
              >
                Reprocessar liquidações
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={busy === 'release'}
                onClick={() => run('release', async () => `${(await api.post<{ released: number }>('admin/finance/settlements/release')).released} lançamento(s) liberado(s).`)}
              >
                Liberar saldos vencidos
              </Button>
            </div>
          )
        }
      />
      <FinanceNav />
      <form className="mb-6 flex flex-wrap items-end gap-3" onSubmit={(event) => event.preventDefault()}>
        <Input className="w-44" type="date" label="De" value={filters.from} max={filters.to} onChange={(e) => e.target.value && setFilters({ from: e.target.value })} />
        <Input className="w-44" type="date" label="Até" value={filters.to} min={filters.from} onChange={(e) => e.target.value && setFilters({ to: e.target.value })} />
      </form>
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="GMV (pedidos entregues)" value={formatBRL(data.orders.gmvCents)} hint={`${data.orders.delivered} pedidos`} />
            <StatCard label="Comissões" value={formatBRL(data.orders.commissionCents)} hint={`Taxas de serviço: ${formatBRL(data.orders.serviceFeeCents)}`} />
            <StatCard label="Receita líquida da plataforma" value={formatBRL(data.platform.netRevenueCents)} tone={data.platform.netRevenueCents >= 0 ? 'success' : 'danger'} hint="Comissões + taxas − repasses − cupons − estornos" />
            <StatCard label="Saques em aberto" value={formatBRL(data.withdrawals.openAmountCents)} hint={`${data.withdrawals.openCount} solicitação(ões)`} tone={data.withdrawals.openCount ? 'warning' : 'neutral'} />
          </div>

          <Card
            title={
              <span className="flex items-center gap-2">
                {anomalyCount ? <AlertTriangle className="h-4 w-4 text-warning" /> : <CheckCircle2 className="h-4 w-4 text-success" />}
                Pendências ({anomalyCount})
              </span>
            }
          >
            {anomalyCount === 0 ? (
              <p className="text-sm text-muted">Nenhuma pendência: liquidações em dia, sem PIX esquecidos nem estornos travados.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {anomalies!.unsettledOrders.map((row) => (
                  <li key={row.id}>
                    Pedido <strong>#{row.number}</strong> entregue em {formatDateTime(row.deliveredAt)} ainda sem liquidação — use &quot;Reprocessar liquidações&quot;.
                  </li>
                ))}
                {anomalies!.paidCanceledOrders.map((row) => (
                  <li key={row.paymentId}>
                    Pedido <strong>#{row.number}</strong> cancelado com pagamento de {formatBRL(row.amountCents)} ainda não estornado —{' '}
                    <Link className="text-brand-600 underline" href={`/financeiro/pagamentos?id=${row.paymentId}`}>
                      ver pagamento
                    </Link>
                    .
                  </li>
                ))}
                {anomalies!.stalePixPayments.map((row) => (
                  <li key={row.id}>
                    PIX de {formatBRL(row.amountCents)} vencido em {formatDateTime(row.pixExpiresAt)} continua pendente (confira com o provedor).
                  </li>
                ))}
                {anomalies!.stuckRefunds.map((row) => (
                  <li key={row.id}>
                    Estorno de {formatBRL(row.amountCents)} {row.status === 'FAILED' ? 'falhou' : 'pendente'} desde {formatDateTime(row.createdAt)}.
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Resultado da plataforma no período">
              <DataTable
                rows={data.platform.byType}
                rowKey={(row) => row.type}
                columns={[
                  { key: 'label', header: 'Lançamento', cell: (row) => row.label },
                  { key: 'amount', header: 'Valor', className: 'text-right', cell: (row) => <span className={row.amountCents < 0 ? 'text-danger' : ''}>{formatBRL(row.amountCents)}</span> },
                ]}
              />
            </Card>
            <Card title="Pagamentos no período">
              <DataTable
                rows={data.payments}
                rowKey={(row) => `${row.method}-${row.status}`}
                columns={[
                  { key: 'method', header: 'Forma', cell: (row) => PAYMENT_METHOD_LABELS[row.method] },
                  { key: 'status', header: 'Status', cell: (row) => PAYMENT_STATUS_LABELS[row.status] },
                  { key: 'count', header: 'Qtd.', className: 'text-right', cell: (row) => row.count },
                  { key: 'amount', header: 'Valor', className: 'text-right', cell: (row) => formatBRL(row.amountCents) },
                  { key: 'refunded', header: 'Estornado', className: 'text-right', hideOnMobile: true, cell: (row) => (row.refundedCents ? formatBRL(row.refundedCents) : '—') },
                ]}
              />
            </Card>
            <Card title="Saldos de parceiros e clientes (agora)">
              <DataTable
                rows={data.balances}
                rowKey={(row) => row.ownerType}
                columns={[
                  { key: 'owner', header: 'Titular', cell: (row) => `${WALLET_OWNER_LABELS[row.ownerType]} (${row.wallets})` },
                  { key: 'available', header: 'Disponível', className: 'text-right', cell: (row) => formatBRL(row.availableCents) },
                  { key: 'pending', header: 'A liberar', className: 'text-right', cell: (row) => formatBRL(row.pendingCents) },
                  {
                    key: 'debt',
                    header: 'Devedores',
                    className: 'text-right',
                    cell: (row) => (row.debtorWallets ? <span className="text-danger">{`${row.debtorWallets} · ${formatBRL(row.debtCents)}`}</span> : '—'),
                  },
                ]}
              />
              {debt && debt.debtorWallets > 0 && (
                <p className="mt-3 text-xs text-muted">
                  Saldo devedor de entregadores = dinheiro recebido em mãos ainda não quitado.{' '}
                  <Link className="text-brand-600 underline" href="/financeiro/carteiras?ownerType=DRIVER&balance=negative">
                    Ver devedores
                  </Link>
                </p>
              )}
            </Card>
            <Card title="Saques no período">
              <DataTable
                rows={data.withdrawals.byStatus}
                rowKey={(row) => row.status}
                columns={[
                  { key: 'status', header: 'Status', cell: (row) => WITHDRAWAL_STATUS_LABELS[row.status] },
                  { key: 'count', header: 'Qtd.', className: 'text-right', cell: (row) => row.count },
                  { key: 'amount', header: 'Valor', className: 'text-right', cell: (row) => formatBRL(row.amountCents) },
                  { key: 'fee', header: 'Tarifas', className: 'text-right', hideOnMobile: true, cell: (row) => formatBRL(row.feeCents) },
                ]}
              />
            </Card>
          </div>

          {can('finance.reports') && (
            <Card title="Integridade das carteiras">
              <p className="mb-3 text-sm text-muted">Recalcula os saldos a partir dos lançamentos e aponta divergências (as carteiras movimentadas mais recentemente).</p>
              <Button
                variant="secondary"
                loading={busy === 'verify'}
                onClick={() =>
                  run('verify', async () => {
                    const result = await api.post<{ checked: number; drift: unknown[] }>('admin/finance/reconciliation/verify-wallets', { limit: 1000 });
                    return result.drift.length ? `${result.drift.length} carteira(s) com divergência de ${result.checked} verificadas.` : `${result.checked} carteiras verificadas: nenhuma divergência.`;
                  })
                }
              >
                Verificar carteiras
              </Button>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

export default function FinancePage() {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <Overview />
    </Suspense>
  );
}
