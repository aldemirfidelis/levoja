'use client';

import { Suspense, useState } from 'react';
import { Receipt, RefreshCw } from 'lucide-react';
import { formatBRL, SUBSCRIPTION_INVOICE_STATUS_LABELS, type SubscriptionInvoiceStatus } from '@levoja/shared';
import { api, Paginated, useApi } from '@levoja/web-kit/client';
import { Badge, Button, ConfirmDialog, DataTable, EmptyState, ErrorState, formatDate, formatDateTime, PageHeader, Pagination, Select, SkeletonRows, useToast } from '@levoja/web-kit/ui';
import { SaasNav, SUBSCRIPTION_INVOICE_TONE } from '@/components/saas-nav';
import { useUrlFilters } from '@/components/list-filters';

interface InvoiceRow {
  id: string;
  number: number;
  companyName: string | null;
  description: string;
  periodStart: string;
  periodEnd: string;
  amountCents: number;
  status: SubscriptionInvoiceStatus;
  paidAt: string | null;
  createdAt: string;
}

function InvoicesView() {
  const toast = useToast();
  const [filters, setFilters] = useUrlFilters({ status: '', page: '1' });
  const { data, error, isLoading, refetch } = useApi<Paginated<InvoiceRow>>('admin/saas/invoices', { ...filters, pageSize: 25 });
  const [voiding, setVoiding] = useState<InvoiceRow | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      const result = await api.post<{ renewed: number }>('admin/saas/billing/run');
      toast.success(`${result.renewed} assinatura(s) renovada(s); pagamentos conferidos.`);
      await refetch();
    } catch (err) {
      toast.error(err);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Planos SaaS"
        description="Mensalidades lançadas nas carteiras das empresas. Ficam pagas quando a carteira cobre o valor (vendas ou quitação por PIX)."
        actions={
          <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={running} onClick={() => void run()}>
            Renovar e conferir agora
          </Button>
        }
      />
      <SaasNav />
      <Select
        aria-label="Situação"
        className="mb-4 sm:w-48"
        value={filters.status}
        onChange={(event) => setFilters({ status: event.target.value })}
        options={[{ value: '', label: 'Todas' }, ...Object.entries(SUBSCRIPTION_INVOICE_STATUS_LABELS).map(([value, label]) => ({ value, label }))]}
      />
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.data.length === 0 && <EmptyState icon={<Receipt className="h-8 w-8" />} title="Nenhuma cobrança" />}
      {data && data.data.length > 0 && (
        <>
          <DataTable
            rows={data.data}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'number',
                header: 'Cobrança',
                cell: (row) => (
                  <div>
                    <p className="font-medium">
                      #{row.number} · {row.companyName ?? '—'}
                    </p>
                    <p className="text-xs text-muted">{row.description}</p>
                  </div>
                ),
              },
              { key: 'period', header: 'Período', cell: (row) => `${formatDate(row.periodStart)} a ${formatDate(new Date(new Date(row.periodEnd).getTime() - 1))}`, hideOnMobile: true },
              { key: 'amount', header: 'Valor', className: 'text-right tabular-nums', cell: (row) => formatBRL(row.amountCents) },
              { key: 'status', header: 'Situação', cell: (row) => <Badge tone={SUBSCRIPTION_INVOICE_TONE[row.status]}>{SUBSCRIPTION_INVOICE_STATUS_LABELS[row.status]}</Badge> },
              { key: 'paid', header: 'Paga em', cell: (row) => formatDateTime(row.paidAt), hideOnMobile: true },
              {
                key: 'actions',
                header: '',
                cell: (row) =>
                  row.status !== 'VOID' && (
                    <Button size="sm" variant="ghost" onClick={() => setVoiding(row)}>
                      Anular
                    </Button>
                  ),
              },
            ]}
          />
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={(page) => setFilters({ page: String(page) })} />
        </>
      )}
      <ConfirmDialog
        open={!!voiding}
        onClose={() => setVoiding(null)}
        tone="danger"
        title={`Anular a cobrança #${voiding?.number ?? ''}?`}
        description="O valor volta para a carteira da empresa. A decisão fica registrada na auditoria."
        confirmLabel="Anular"
        reason={{ label: 'Motivo', required: true }}
        onConfirm={async (reason) => {
          try {
            await api.post(`admin/saas/invoices/${voiding!.id}/void`, { reason });
            toast.success('Cobrança anulada.');
            setVoiding(null);
            await refetch();
          } catch (err) {
            toast.error(err);
          }
        }}
      />
    </>
  );
}

export default function SubscriptionInvoicesPage() {
  return (
    <Suspense>
      <InvoicesView />
    </Suspense>
  );
}
