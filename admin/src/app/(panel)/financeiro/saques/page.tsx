'use client';

import { FormEvent, Suspense, useState } from 'react';
import { Banknote } from 'lucide-react';
import { formatBRL, WALLET_OWNER_LABELS, WalletOwnerType, WITHDRAWAL_STATUS_LABELS, WithdrawalStatus } from '@levoja/shared';
import { api, Paginated, useApi } from '@levoja/web-kit/client';
import { Badge, Button, ConfirmDialog, DataTable, Dialog, EmptyState, ErrorState, errorMessage, formatDateTime, Input, PageHeader, Pagination, SkeletonRows, Tabs, Tone, useToast } from '@levoja/web-kit/ui';
import { FinanceNav } from '@/components/finance-nav';
import { useUrlFilters } from '@/components/list-filters';
import { useSession } from '@/lib/session';

interface Withdrawal {
  id: string;
  amountCents: number;
  feeCents: number;
  status: WithdrawalStatus;
  statusLabel: string;
  destination: string;
  failureReason: string | null;
  providerTransferId: string | null;
  reviewedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  owner: { type: WalletOwnerType; id: string | null; name: string };
  walletAvailableCents: number;
}

const TONE: Record<WithdrawalStatus, Tone> = {
  REQUESTED: 'warning',
  PROCESSING: 'info',
  PAID: 'success',
  REJECTED: 'danger',
  FAILED: 'danger',
  CANCELED: 'neutral',
};

type Action = { kind: 'approve' | 'reject' | 'paid' | 'failed'; withdrawal: Withdrawal };

function MarkPaidDialog({ withdrawal, onClose, onDone }: { withdrawal: Withdrawal; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post(`admin/finance/withdrawals/${withdrawal.id}/mark-paid`, { transferReference: reference.trim() });
      toast.success('Saque confirmado. O parceiro foi avisado.');
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="sm" title="Confirmar transferência" description={`${formatBRL(withdrawal.amountCents)} para ${withdrawal.owner.name} (${withdrawal.destination}).`}>
      <form onSubmit={submit} className="space-y-4">
        <Input label="Identificador da transferência (E2E ID / comprovante)" required minLength={3} maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} autoFocus />
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" loading={busy}>
            Confirmar pagamento
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function WithdrawalsList() {
  const { can } = useSession();
  const toast = useToast();
  const [filters, setFilters] = useUrlFilters({ status: 'REQUESTED', page: '1' });
  const [action, setAction] = useState<Action | null>(null);
  const { data, error, isLoading, refetch } = useApi<Paginated<Withdrawal> & { mode: 'manual' | 'automatic' }>(
    'admin/finance/withdrawals',
    { status: filters.status === 'ALL' ? '' : filters.status, page: filters.page, pageSize: 25 },
    { refetchInterval: 60_000 },
  );
  const manage = can('payouts.manage');
  const post = async (path: string, body?: unknown, message?: string) => {
    await api.post(path, body);
    if (message) toast.success(message);
    await refetch();
  };

  return (
    <>
      <PageHeader
        title="Saques"
        description={
          data?.mode === 'manual'
            ? 'Modo manual: aprove, faça a transferência PIX pelo banco e confirme com o identificador da transação. Recusas e falhas devolvem o valor ao saldo.'
            : 'Aprovar envia o PIX automaticamente pelo provedor de repasses. Recusas e falhas devolvem o valor ao saldo.'
        }
      />
      <FinanceNav />
      <Tabs
        value={filters.status}
        onChange={(status) => setFilters({ status })}
        items={[
          { value: 'REQUESTED', label: 'Aguardando análise' },
          { value: 'PROCESSING', label: 'Em processamento' },
          { value: 'PAID', label: 'Pagos' },
          { value: 'ALL', label: 'Todos' },
        ]}
      />
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.data.length === 0 && <EmptyState icon={<Banknote className="h-8 w-8" />} title="Nenhum saque nesta situação" />}
      {!!data?.data.length && (
        <>
          <DataTable
            rows={data.data}
            rowKey={(row) => row.id}
            columns={[
              { key: 'date', header: 'Solicitado', cell: (row) => formatDateTime(row.createdAt) },
              {
                key: 'owner',
                header: 'Titular',
                cell: (row) => (
                  <span>
                    {row.owner.name}
                    <span className="block text-xs text-muted">
                      {WALLET_OWNER_LABELS[row.owner.type]} · {row.destination}
                    </span>
                  </span>
                ),
              },
              {
                key: 'amount',
                header: 'Valor',
                className: 'text-right',
                cell: (row) => (
                  <span>
                    {formatBRL(row.amountCents)}
                    {row.feeCents > 0 && <span className="block text-xs text-muted">+ tarifa {formatBRL(row.feeCents)}</span>}
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                cell: (row) => (
                  <span>
                    <Badge tone={TONE[row.status]}>{WITHDRAWAL_STATUS_LABELS[row.status]}</Badge>
                    {row.failureReason && <span className="mt-1 block text-xs text-muted">{row.failureReason}</span>}
                    {row.providerTransferId && <span className="mt-1 block text-xs text-muted">Ref.: {row.providerTransferId}</span>}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: '',
                className: 'text-right',
                cell: (row) =>
                  manage && (
                    <div className="flex flex-wrap justify-end gap-2">
                      {row.status === 'REQUESTED' && (
                        <>
                          <Button size="sm" variant="success" onClick={() => setAction({ kind: 'approve', withdrawal: row })}>
                            Aprovar
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'reject', withdrawal: row })}>
                            Recusar
                          </Button>
                        </>
                      )}
                      {row.status === 'PROCESSING' && (
                        <>
                          <Button size="sm" onClick={() => setAction({ kind: 'paid', withdrawal: row })}>
                            Confirmar pagamento
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'failed', withdrawal: row })}>
                            Marcar falha
                          </Button>
                        </>
                      )}
                    </div>
                  ),
              },
            ]}
          />
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={(page) => setFilters({ page: String(page) })} />
        </>
      )}

      {action?.kind === 'approve' && (
        <ConfirmDialog
          open
          onClose={() => setAction(null)}
          onConfirm={() => post(`admin/finance/withdrawals/${action.withdrawal.id}/approve`, undefined, data?.mode === 'manual' ? 'Aprovado. Faça a transferência e confirme o pagamento.' : 'Saque aprovado e enviado.')}
          title="Aprovar saque"
          description={`${formatBRL(action.withdrawal.amountCents)} para ${action.withdrawal.owner.name} — ${action.withdrawal.destination}.`}
          confirmLabel="Aprovar"
          tone="success"
        />
      )}
      {action?.kind === 'reject' && (
        <ConfirmDialog
          open
          onClose={() => setAction(null)}
          onConfirm={(reason) => post(`admin/finance/withdrawals/${action.withdrawal.id}/reject`, { reason }, 'Saque recusado; o valor voltou ao saldo.')}
          title="Recusar saque"
          description="O valor e a tarifa voltam ao saldo disponível e o parceiro é notificado com o motivo."
          confirmLabel="Recusar"
          tone="danger"
          reason={{ label: 'Motivo', required: true }}
        />
      )}
      {action?.kind === 'failed' && (
        <ConfirmDialog
          open
          onClose={() => setAction(null)}
          onConfirm={(reason) => post(`admin/finance/withdrawals/${action.withdrawal.id}/mark-failed`, { reason }, 'Falha registrada; o valor voltou ao saldo.')}
          title="Transferência não concluída"
          description="Use quando o banco devolver ou recusar a transferência. O valor volta ao saldo."
          confirmLabel="Registrar falha"
          tone="danger"
          reason={{ label: 'Motivo informado pelo banco', required: true }}
        />
      )}
      {action?.kind === 'paid' && <MarkPaidDialog withdrawal={action.withdrawal} onClose={() => setAction(null)} onDone={() => refetch()} />}
    </>
  );
}

export default function WithdrawalsPage() {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <WithdrawalsList />
    </Suspense>
  );
}
