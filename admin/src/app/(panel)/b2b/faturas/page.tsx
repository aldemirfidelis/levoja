'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { Download, Receipt } from 'lucide-react';
import { formatBRL, INVOICE_STATUS_LABELS, type InvoiceStatus } from '@levoja/shared';
import { api, Paginated, useApi } from '@levoja/web-kit/client';
import { Badge, Button, ConfirmDialog, DataTable, DescriptionList, Dialog, EmptyState, ErrorState, formatDateTime, Input, PageHeader, Pagination, Select, SkeletonRows, StatCard, useToast } from '@levoja/web-kit/ui';
import { B2bNav, INVOICE_TONE } from '@/components/b2b-nav';
import { SearchInput, useUrlFilters } from '@/components/list-filters';
import { useSession } from '@/lib/session';

interface InvoiceRow {
  id: string;
  number: number;
  status: InvoiceStatus;
  contract: { id: string; number: number; title: string } | null;
  company: { id: string; tradeName: string } | null;
  periodStart: string;
  periodEnd: string;
  deliveriesCount: number;
  deliveriesCents: number;
  minimumAdjustmentCents: number;
  totalCents: number;
  byCostCenter: { costCenterId: string | null; code: string | null; name: string; deliveries: number; amountCents: number }[];
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  paidReference: string | null;
  cancelReason: string | null;
}

interface InvoiceDetail extends InvoiceRow {
  payments: { id: string; method: string; provider: string; status: string; amountCents: number; paidAt: string | null; createdAt: string }[];
}

const localDate = (value: string) => new Date(value).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const period = (row: Pick<InvoiceRow, 'periodStart' | 'periodEnd'>) => `${localDate(row.periodStart)} a ${localDate(new Date(new Date(row.periodEnd).getTime() - 1).toISOString())}`;

function InvoiceDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const { data, refetch } = useApi<InvoiceDetail>(`admin/b2b/invoices/${id}`);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [canceling, setCanceling] = useState(false);
  if (!data) return null;
  const open = data.status === 'ISSUED' || data.status === 'OVERDUE';

  const markPaid = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post(`admin/b2b/invoices/${id}/mark-paid`, { reference });
      toast.success('Pagamento registrado.');
      await refetch();
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (reason: string) => {
    try {
      await api.post(`admin/b2b/invoices/${id}/cancel`, { reason });
      toast.success('Fatura cancelada; as entregas voltam para o próximo fechamento.');
      setCanceling(false);
      await refetch();
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Dialog open onClose={onClose} size="lg" title={`Fatura #${data.number}`} description={`${data.company?.tradeName ?? ''}${data.contract ? ` · contrato #${data.contract.number}` : ''}`}>
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={INVOICE_TONE[data.status]}>{INVOICE_STATUS_LABELS[data.status]}</Badge>
          <a href={api.fileUrl(`admin/b2b/invoices/${id}/export.csv`)} className="inline-flex items-center gap-1.5 font-medium text-brand-600 hover:underline" download>
            <Download className="h-4 w-4" aria-hidden /> Demonstrativo (CSV)
          </a>
        </div>
        <DescriptionList
          items={[
            { label: 'Período', value: period(data) },
            { label: 'Vencimento', value: localDate(data.dueAt) },
            { label: 'Entregas', value: `${data.deliveriesCount} · ${formatBRL(data.deliveriesCents)}` },
            { label: 'Franquia mínima', value: data.minimumAdjustmentCents ? formatBRL(data.minimumAdjustmentCents) : '—' },
            { label: 'Total', value: <strong>{formatBRL(data.totalCents)}</strong> },
            ...(data.paidAt ? [{ label: 'Pago em', value: `${formatDateTime(data.paidAt)}${data.paidReference ? ` · ${data.paidReference}` : ''}` }] : []),
            ...(data.cancelReason ? [{ label: 'Cancelamento', value: data.cancelReason }] : []),
          ]}
        />
        {data.byCostCenter.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.byCostCenter.map((group) => (
              <li key={group.costCenterId ?? 'none'} className="flex justify-between gap-2 px-3 py-2">
                <span>
                  {group.code ? `${group.code} — ` : ''}
                  {group.name} <span className="text-muted">· {group.deliveries}</span>
                </span>
                <span className="tabular-nums">{formatBRL(group.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
        {data.payments.length > 0 && (
          <div>
            <p className="mb-1 font-semibold">Pagamentos</p>
            <ul className="space-y-1">
              {data.payments.map((payment) => (
                <li key={payment.id} className="flex justify-between gap-2">
                  <span>
                    {payment.method} ({payment.provider}) · {payment.status}
                  </span>
                  <span className="tabular-nums">{formatBRL(payment.amountCents)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {open && can('invoices.manage') && (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <form onSubmit={markPaid} className="flex flex-wrap items-end gap-2">
              <Input className="min-w-60 flex-1" label="Baixa manual — referência do pagamento" required minLength={3} maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Ex.: TED 0001234, boleto 123" />
              <Button type="submit" loading={busy}>
                Registrar pagamento
              </Button>
            </form>
            <Button variant="ghost" className="text-danger" onClick={() => setCanceling(true)}>
              Cancelar fatura
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={canceling}
        onClose={() => setCanceling(false)}
        onConfirm={cancel}
        tone="danger"
        title="Cancelar a fatura?"
        confirmLabel="Cancelar fatura"
        description="As entregas voltam para o próximo fechamento e a franquia mínima (se houver) é estornada."
        reason={{ label: 'Motivo', required: true }}
      />
    </Dialog>
  );
}

function InvoicesView() {
  const [filters, setFilters] = useUrlFilters({ status: '', search: '', page: '1', open: '' });
  const { data, error, isLoading, refetch } = useApi<Paginated<InvoiceRow> & { totals: Partial<Record<InvoiceStatus, { count: number; totalCents: number }>> }>('admin/b2b/invoices', {
    status: filters.status,
    search: filters.search,
    page: filters.page,
    pageSize: 25,
  });
  const total = (status: InvoiceStatus) => data?.totals[status] ?? { count: 0, totalCents: 0 };

  return (
    <>
      <PageHeader title="Corporativo (B2B)" description="Faturas mensais dos contratos: emissão automática no dia de fechamento, pagamento por PIX ou baixa manual." />
      <B2bNav />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Em aberto" value={formatBRL(total('ISSUED').totalCents)} hint={`${total('ISSUED').count} fatura(s)`} />
        <StatCard label="Vencidas" value={formatBRL(total('OVERDUE').totalCents)} hint={`${total('OVERDUE').count} fatura(s)`} tone={total('OVERDUE').count ? 'danger' : 'neutral'} />
        <StatCard label="Pagas" value={formatBRL(total('PAID').totalCents)} hint={`${total('PAID').count} fatura(s)`} tone="success" />
        <StatCard label="Canceladas" value={total('CANCELED').count} />
      </div>
      <div className="mb-4 flex flex-wrap gap-3">
        <SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Número ou empresa" />
        <Select
          aria-label="Situação"
          className="w-44"
          value={filters.status}
          onChange={(event) => setFilters({ status: event.target.value })}
          options={[{ value: '', label: 'Todas as situações' }, ...Object.entries(INVOICE_STATUS_LABELS).map(([value, label]) => ({ value, label }))]}
        />
      </div>
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.data.length === 0 && <EmptyState icon={<Receipt className="h-8 w-8" />} title="Nenhuma fatura" />}
      {data && data.data.length > 0 && (
        <>
          <DataTable
            rows={data.data}
            rowKey={(row) => row.id}
            onRowClick={(row) => setFilters({ open: row.id, page: filters.page })}
            columns={[
              {
                key: 'number',
                header: 'Fatura',
                cell: (row) => (
                  <div>
                    <p className="font-medium">#{row.number}</p>
                    <p className="text-xs text-muted">{row.company?.tradeName}</p>
                  </div>
                ),
              },
              {
                key: 'contract',
                header: 'Contrato',
                cell: (row) =>
                  row.contract ? (
                    <Link href={`/b2b/contratos/${row.contract.id}`} className="text-brand-600 hover:underline" onClick={(event) => event.stopPropagation()}>
                      #{row.contract.number}
                    </Link>
                  ) : (
                    '—'
                  ),
                hideOnMobile: true,
              },
              { key: 'period', header: 'Período', cell: (row) => period(row), hideOnMobile: true },
              { key: 'total', header: 'Total', className: 'text-right tabular-nums', cell: (row) => formatBRL(row.totalCents) },
              { key: 'due', header: 'Vencimento', cell: (row) => localDate(row.dueAt) },
              { key: 'status', header: 'Situação', cell: (row) => <Badge tone={INVOICE_TONE[row.status]}>{INVOICE_STATUS_LABELS[row.status]}</Badge> },
            ]}
          />
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={(page) => setFilters({ page: String(page) })} />
        </>
      )}
      {filters.open && <InvoiceDialog id={filters.open} onClose={() => setFilters({ open: '', page: filters.page })} onChanged={() => void refetch()} />}
    </>
  );
}

export default function InvoicesPage() {
  return (
    <Suspense>
      <InvoicesView />
    </Suspense>
  );
}
