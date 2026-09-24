'use client';

import { FormEvent, Suspense, useState } from 'react';
import { Wallet } from 'lucide-react';
import { formatBRL, LEDGER_ENTRY_LABELS, LedgerEntryType, WALLET_OWNER_LABELS, WalletOwnerType } from '@levoja/shared';
import { api, Paginated, useApi } from '@levoja/web-kit/client';
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  errorMessage,
  formatDateTime,
  MoneyInput,
  PageHeader,
  Pagination,
  Select,
  SignedAmount,
  SkeletonRows,
  StatCard,
  Textarea,
  useToast,
  WalletStatement,
} from '@levoja/web-kit/ui';
import { FinanceNav } from '@/components/finance-nav';
import { SearchInput, useUrlFilters } from '@/components/list-filters';
import { useSession } from '@/lib/session';

interface WalletRow {
  id: string;
  ownerType: WalletOwnerType;
  ownerId: string | null;
  ownerName: string;
  availableCents: number;
  pendingCents: number;
  updatedAt: string;
}

interface WalletDetail extends WalletRow {
  monthTotals: Partial<Record<LedgerEntryType, number>>;
  drift: boolean;
}

function AdjustmentForm({ wallet, onDone }: { wallet: WalletRow; onDone: () => void }) {
  const toast = useToast();
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!amount) return setError('Informe o valor.');
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`admin/finance/wallets/${wallet.id}/adjustments`, { amountCents: direction === 'credit' ? amount : -amount, reason: reason.trim() });
      toast.success('Ajuste lançado e registrado na auditoria.');
      setAmount(null);
      setReason('');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
      <p className="text-sm font-semibold sm:col-span-2">Ajuste manual</p>
      <Select
        label="Tipo"
        value={direction}
        options={[
          { value: 'credit', label: 'Crédito (a plataforma deve ao titular)' },
          { value: 'debit', label: 'Débito (o titular deve à plataforma)' },
        ]}
        onChange={(e) => setDirection(e.target.value as 'credit' | 'debit')}
      />
      <MoneyInput label="Valor" value={amount} onChange={setAmount} required />
      <Textarea className="sm:col-span-2" label="Justificativa" required minLength={5} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: produto faltante cobrado da loja no pedido #1234" />
      {error && <p className="text-sm text-danger sm:col-span-2" role="alert">{error}</p>}
      <p className="text-xs text-muted sm:col-span-2">A contrapartida é lançada na carteira da plataforma, mantendo o razão fechado.</p>
      <Button type="submit" loading={busy} className="sm:w-fit">
        Lançar ajuste
      </Button>
    </form>
  );
}

function WalletDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useSession();
  const { data, error, isLoading, refetch } = useApi<WalletDetail>(`admin/finance/wallets/${id}`);
  const [version, setVersion] = useState(0);
  return (
    <Dialog open onClose={onClose} size="lg" title={data ? data.ownerName : 'Carteira'} description={data ? WALLET_OWNER_LABELS[data.ownerType] : undefined}>
      {isLoading && <SkeletonRows rows={4} />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && (
        <div className="space-y-5">
          {data.drift && <p className="rounded-lg bg-danger/10 p-3 text-sm text-danger">Saldo em cache diverge dos lançamentos. Acione o suporte técnico.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard label="Disponível" value={formatBRL(data.availableCents)} tone={data.availableCents < 0 ? 'danger' : 'neutral'} />
            <StatCard label="A liberar" value={formatBRL(data.pendingCents)} />
          </div>
          {Object.keys(data.monthTotals).length > 0 && (
            <div className="text-sm">
              <p className="mb-2 font-semibold">Neste mês</p>
              <ul className="grid gap-1 sm:grid-cols-2">
                {Object.entries(data.monthTotals).map(([type, cents]) => (
                  <li key={type} className="flex justify-between rounded bg-surface-2 px-3 py-1.5">
                    <span>{LEDGER_ENTRY_LABELS[type as LedgerEntryType]}</span>
                    <SignedAmount cents={cents ?? 0} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {can('payments.manage') && (
            <AdjustmentForm
              wallet={data}
              onDone={() => {
                void refetch();
                setVersion((v) => v + 1);
                onChanged();
              }}
            />
          )}
          <div>
            <p className="mb-2 text-sm font-semibold">Extrato</p>
            <WalletStatement key={version} path={`admin/finance/wallets/${id}/transactions`} />
          </div>
        </div>
      )}
    </Dialog>
  );
}

function WalletsList() {
  const [filters, setFilters] = useUrlFilters({ ownerType: '', balance: '', search: '', page: '1', id: '' });
  const { data, error, isLoading, refetch } = useApi<Paginated<WalletRow>>('admin/finance/wallets', {
    ownerType: filters.ownerType,
    balance: filters.balance,
    search: filters.search,
    page: filters.page,
    pageSize: 25,
  });
  return (
    <>
      <PageHeader title="Carteiras" description="Saldos de entregadores, empresas e clientes. Saldo negativo = valor devido à plataforma (ex.: dinheiro recebido em entregas)." />
      <FinanceNav />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Nome do titular" />
        <Select
          className="sm:w-48"
          aria-label="Titular"
          value={filters.ownerType}
          placeholder="Todos os titulares"
          options={(['DRIVER', 'COMPANY', 'CUSTOMER'] as const).map((type) => ({ value: type, label: WALLET_OWNER_LABELS[type] }))}
          onChange={(e) => setFilters({ ownerType: e.target.value })}
        />
        <Select
          className="sm:w-48"
          aria-label="Saldo"
          value={filters.balance}
          placeholder="Qualquer saldo"
          options={[
            { value: 'negative', label: 'Devedores' },
            { value: 'positive', label: 'Com saldo a receber' },
          ]}
          onChange={(e) => setFilters({ balance: e.target.value })}
        />
      </div>
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.data.length === 0 && <EmptyState icon={<Wallet className="h-8 w-8" />} title="Nenhuma carteira encontrada" />}
      {!!data?.data.length && (
        <>
          <DataTable
            rows={data.data}
            rowKey={(row) => row.id}
            onRowClick={(row) => setFilters({ id: row.id, page: filters.page })}
            columns={[
              { key: 'owner', header: 'Titular', cell: (row) => row.ownerName },
              { key: 'type', header: 'Tipo', cell: (row) => <Badge>{WALLET_OWNER_LABELS[row.ownerType]}</Badge> },
              { key: 'available', header: 'Disponível', className: 'text-right', cell: (row) => <span className={row.availableCents < 0 ? 'text-danger' : ''}>{formatBRL(row.availableCents)}</span> },
              { key: 'pending', header: 'A liberar', className: 'text-right', hideOnMobile: true, cell: (row) => formatBRL(row.pendingCents) },
              { key: 'updated', header: 'Última movimentação', hideOnMobile: true, cell: (row) => formatDateTime(row.updatedAt) },
            ]}
          />
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={(page) => setFilters({ page: String(page) })} />
        </>
      )}
      {filters.id && <WalletDialog id={filters.id} onClose={() => setFilters({ id: '', page: filters.page })} onChanged={() => refetch()} />}
    </>
  );
}

export default function WalletsPage() {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <WalletsList />
    </Suspense>
  );
}
