'use client';

import { FormEvent, Suspense, useState } from 'react';
import { CreditCard, RefreshCw } from 'lucide-react';
import {
  formatBRL,
  PAYMENT_METHOD_LABELS,
  PAYMENT_PURPOSE_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUSES,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
} from '@levoja/shared';
import { api, Paginated, useApi } from '@levoja/web-kit/client';
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  DescriptionList,
  Dialog,
  EmptyState,
  ErrorState,
  errorMessage,
  formatDateTime,
  MoneyInput,
  PageHeader,
  Pagination,
  Select,
  SkeletonRows,
  Textarea,
  Tone,
  useToast,
} from '@levoja/web-kit/ui';
import { FinanceNav } from '@/components/finance-nav';
import { useUrlFilters } from '@/components/list-filters';
import { useSession } from '@/lib/session';

interface Refund {
  id: string;
  amountCents: number;
  reason: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  toWallet: boolean;
  createdAt: string;
}

interface Payment {
  id: string;
  purpose: PaymentPurpose;
  method: PaymentMethod;
  status: PaymentStatus;
  amountCents: number;
  refundedCents: number;
  provider: string;
  providerPaymentId: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  failureReason: string | null;
  orderId: string | null;
  deliveryId: string | null;
  paidAt: string | null;
  createdAt: string;
  refunds: Refund[];
  order?: { id: string; number: number; company: { tradeName: string } } | null;
  events?: { id: string; type: string; providerEventId: string; processedAt: string | null; createdAt: string }[];
}

const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  PENDING: 'warning',
  AUTHORIZED: 'info',
  PAID: 'success',
  FAILED: 'danger',
  CANCELED: 'neutral',
  REFUNDED: 'neutral',
  PARTIALLY_REFUNDED: 'info',
};

const METHODS: PaymentMethod[] = ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'WALLET', 'CASH', 'INVOICE'];

function RefundForm({ payment, onDone }: { payment: Payment; onDone: () => void }) {
  const toast = useToast();
  const refundable = payment.amountCents - payment.refundedCents;
  const creditOnly = ['WALLET', 'CASH', 'INVOICE'].includes(payment.method);
  const [amount, setAmount] = useState<number | null>(refundable);
  const [reason, setReason] = useState('');
  const [toWallet, setToWallet] = useState(creditOnly);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!amount || amount > refundable) return setError(`Informe um valor entre R$ 0,01 e ${formatBRL(refundable)}.`);
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`admin/finance/payments/${payment.id}/refund`, { amountCents: amount, reason, toWallet });
      toast.success(toWallet ? 'Crédito lançado na carteira do cliente.' : 'Estorno enviado ao provedor.');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-border p-4">
      <p className="text-sm font-semibold">Estornar</p>
      <MoneyInput label="Valor" value={amount} onChange={setAmount} required hint={`Máximo: ${formatBRL(refundable)}`} />
      <Textarea label="Motivo" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: item faltando no pedido" />
      <Checkbox
        label={creditOnly ? 'Crédito na carteira do cliente (único meio disponível para esta forma de pagamento)' : 'Devolver como crédito na carteira do cliente (instantâneo)'}
        checked={toWallet}
        disabled={creditOnly}
        onChange={(e) => setToWallet(e.target.checked)}
      />
      {payment.orderId && <p className="text-xs text-muted">Após a liquidação do pedido, o estorno é custo da plataforma. Para cobrar da loja, faça um ajuste na carteira dela.</p>}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <Button type="submit" variant="danger" loading={busy}>
        Confirmar estorno
      </Button>
    </form>
  );
}

function PaymentDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const { data: payment, error, isLoading, refetch } = useApi<Payment>(`admin/finance/payments/${id}`);
  const [syncing, setSyncing] = useState(false);
  const refresh = async () => {
    await refetch();
    onChanged();
  };

  return (
    <Dialog open onClose={onClose} size="lg" title="Pagamento" description={payment ? `${PAYMENT_PURPOSE_LABELS[payment.purpose]} · ${PAYMENT_METHOD_LABELS[payment.method]}` : undefined}>
      {isLoading && <SkeletonRows rows={4} />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {payment && (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={PAYMENT_TONE[payment.status]}>{PAYMENT_STATUS_LABELS[payment.status]}</Badge>
            <span className="text-lg font-semibold tabular-nums">{formatBRL(payment.amountCents)}</span>
            {payment.refundedCents > 0 && <span className="text-muted">({formatBRL(payment.refundedCents)} estornado)</span>}
            {can('payments.manage') && payment.status === 'PENDING' && payment.providerPaymentId && (
              <Button
                size="sm"
                variant="secondary"
                loading={syncing}
                icon={<RefreshCw className="h-4 w-4" />}
                onClick={async () => {
                  setSyncing(true);
                  try {
                    await api.post(`admin/finance/payments/${payment.id}/sync`);
                    toast.success('Status consultado no provedor.');
                    await refresh();
                  } catch (err) {
                    toast.error(err);
                  } finally {
                    setSyncing(false);
                  }
                }}
              >
                Consultar provedor
              </Button>
            )}
          </div>
          <DescriptionList
            items={[
              { label: 'Criado em', value: formatDateTime(payment.createdAt) },
              { label: 'Pago em', value: formatDateTime(payment.paidAt) },
              { label: 'Provedor', value: `${payment.provider}${payment.providerPaymentId ? ` · ${payment.providerPaymentId}` : ''}` },
              ...(payment.cardLast4 ? [{ label: 'Cartão', value: `${payment.cardBrand ?? ''} •••• ${payment.cardLast4}` }] : []),
              ...(payment.failureReason ? [{ label: 'Motivo da falha', value: payment.failureReason }] : []),
              { label: 'Referência', value: payment.orderId ? `Pedido ${payment.orderId.slice(-8)}` : payment.deliveryId ? `Entrega ${payment.deliveryId.slice(-8)}` : 'Quitação de saldo' },
            ]}
          />
          {payment.refunds.length > 0 && (
            <div>
              <p className="mb-2 font-semibold">Estornos</p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {payment.refunds.map((refund) => (
                  <li key={refund.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <span>
                      {formatBRL(refund.amountCents)} · {refund.reason}
                      <span className="block text-xs text-muted">
                        {formatDateTime(refund.createdAt)} · {refund.toWallet ? 'crédito na carteira' : 'meio original'}
                      </span>
                    </span>
                    <Badge tone={refund.status === 'SUCCEEDED' ? 'success' : refund.status === 'FAILED' ? 'danger' : 'warning'}>
                      {refund.status === 'SUCCEEDED' ? 'Concluído' : refund.status === 'FAILED' ? 'Falhou' : 'Pendente'}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!payment.events?.length && (
            <div>
              <p className="mb-2 font-semibold">Notificações do provedor</p>
              <ul className="space-y-1 text-xs text-muted">
                {payment.events.map((event) => (
                  <li key={event.id}>
                    {formatDateTime(event.createdAt)} · {event.type} · {event.processedAt ? 'processada' : 'ignorada/pendente'}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {can('payments.manage') && ['PAID', 'PARTIALLY_REFUNDED'].includes(payment.status) && payment.purpose !== 'DEBT_SETTLEMENT' && (
            <RefundForm payment={payment} onDone={refresh} />
          )}
        </div>
      )}
    </Dialog>
  );
}

function PaymentsList() {
  const [filters, setFilters] = useUrlFilters({ status: '', method: '', purpose: '', page: '1', id: '' });
  const { data, error, isLoading, refetch } = useApi<Paginated<Payment>>('admin/finance/payments', {
    status: filters.status,
    method: filters.method,
    purpose: filters.purpose,
    page: filters.page,
    pageSize: 25,
  });

  return (
    <>
      <PageHeader title="Pagamentos" description="PIX, cartões, carteira e dinheiro. Estornos totais ou parciais ficam registrados no razão." />
      <FinanceNav />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Select
          className="sm:w-48"
          aria-label="Status"
          value={filters.status}
          placeholder="Qualquer status"
          options={PAYMENT_STATUSES.map((status) => ({ value: status, label: PAYMENT_STATUS_LABELS[status] }))}
          onChange={(e) => setFilters({ status: e.target.value })}
        />
        <Select
          className="sm:w-48"
          aria-label="Forma de pagamento"
          value={filters.method}
          placeholder="Qualquer forma"
          options={METHODS.map((method) => ({ value: method, label: PAYMENT_METHOD_LABELS[method] }))}
          onChange={(e) => setFilters({ method: e.target.value })}
        />
        <Select
          className="sm:w-48"
          aria-label="Origem"
          value={filters.purpose}
          placeholder="Qualquer origem"
          options={Object.entries(PAYMENT_PURPOSE_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(e) => setFilters({ purpose: e.target.value })}
        />
      </div>
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.data.length === 0 && <EmptyState icon={<CreditCard className="h-8 w-8" />} title="Nenhum pagamento encontrado" />}
      {!!data?.data.length && (
        <>
          <DataTable
            rows={data.data}
            rowKey={(row) => row.id}
            onRowClick={(row) => setFilters({ id: row.id, page: filters.page })}
            columns={[
              { key: 'date', header: 'Data', cell: (row) => formatDateTime(row.createdAt) },
              {
                key: 'ref',
                header: 'Referência',
                cell: (row) =>
                  row.order ? (
                    <span>
                      Pedido #{row.order.number}
                      <span className="block text-xs text-muted">{row.order.company.tradeName}</span>
                    </span>
                  ) : (
                    PAYMENT_PURPOSE_LABELS[row.purpose]
                  ),
              },
              { key: 'method', header: 'Forma', hideOnMobile: true, cell: (row) => PAYMENT_METHOD_LABELS[row.method] },
              { key: 'status', header: 'Status', cell: (row) => <Badge tone={PAYMENT_TONE[row.status]}>{PAYMENT_STATUS_LABELS[row.status]}</Badge> },
              { key: 'amount', header: 'Valor', className: 'text-right', cell: (row) => formatBRL(row.amountCents) },
            ]}
          />
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={(page) => setFilters({ page: String(page) })} />
        </>
      )}
      {filters.id && <PaymentDetail id={filters.id} onClose={() => setFilters({ id: '', page: filters.page })} onChanged={() => refetch()} />}
    </>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <PaymentsList />
    </Suspense>
  );
}
