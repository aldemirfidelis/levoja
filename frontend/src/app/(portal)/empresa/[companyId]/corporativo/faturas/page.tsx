'use client';

import { useState } from 'react';
import { Download, Receipt } from 'lucide-react';
import { formatBRL, INVOICE_STATUS_LABELS, type InvoiceStatus } from '@levoja/shared';
import { api, Paginated, useApi } from '@levoja/web-kit/client';
import { Badge, Button, Card, DataTable, DescriptionList, Dialog, EmptyState, formatDateTime, Pagination, PixCharge, SkeletonRows, Tone, useToast } from '@levoja/web-kit/ui';
import { useCompany } from '@/lib/company';
import { PlanAwareError } from '@/components/plan-gate';

interface Invoice {
  id: string;
  number: number;
  status: InvoiceStatus;
  contract: { number: number; title: string } | null;
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
  pendingPix?: { id: string; pixCopyPaste: string | null; pixExpiresAt: string | null; amountCents: number } | null;
}

const localDate = (value: string) => new Date(value).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const TONE: Record<InvoiceStatus, Tone> = { ISSUED: 'warning', PAID: 'success', OVERDUE: 'danger', CANCELED: 'neutral' };
/** Período [início, fim) — mostra o último dia incluído. */
const period = (invoice: Pick<Invoice, 'periodStart' | 'periodEnd'>) => `${localDate(invoice.periodStart)} a ${localDate(new Date(new Date(invoice.periodEnd).getTime() - 1).toISOString())}`;

function InvoiceDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { company, can } = useCompany();
  const toast = useToast();
  const path = `companies/${company.id}/b2b/invoices/${id}`;
  const { data, refetch } = useApi<Invoice>(path, undefined, { refetchInterval: (query) => (query.state.data?.pendingPix ? 5_000 : false) });
  const [paying, setPaying] = useState(false);
  if (!data) return null;
  const open = data.status === 'ISSUED' || data.status === 'OVERDUE';

  const pay = async () => {
    setPaying(true);
    try {
      await api.post(`${path}/pay`);
      await refetch();
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setPaying(false);
    }
  };

  return (
    <Dialog open onClose={onClose} size="lg" title={`Fatura #${data.number}`} description={data.contract ? `Contrato #${data.contract.number} — ${data.contract.title}` : undefined}>
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={TONE[data.status]}>{INVOICE_STATUS_LABELS[data.status]}</Badge>
          <a href={api.fileUrl(`${path}/export.csv`)} className="inline-flex items-center gap-1.5 font-medium text-brand-600 hover:underline" download>
            <Download className="h-4 w-4" aria-hidden /> Demonstrativo (CSV)
          </a>
        </div>
        <DescriptionList
          items={[
            { label: 'Período', value: period(data) },
            { label: 'Emissão', value: localDate(data.issuedAt) },
            { label: 'Vencimento', value: localDate(data.dueAt) },
            { label: 'Entregas', value: `${data.deliveriesCount} · ${formatBRL(data.deliveriesCents)}` },
            ...(data.minimumAdjustmentCents ? [{ label: 'Complemento da franquia mínima', value: formatBRL(data.minimumAdjustmentCents) }] : []),
            { label: 'Total', value: <strong>{formatBRL(data.totalCents)}</strong> },
            ...(data.paidAt ? [{ label: 'Pago em', value: `${formatDateTime(data.paidAt)}${data.paidReference ? ` · ${data.paidReference}` : ''}` }] : []),
            ...(data.cancelReason ? [{ label: 'Motivo do cancelamento', value: data.cancelReason }] : []),
          ]}
        />
        {data.byCostCenter.length > 0 && (
          <div>
            <p className="mb-2 font-semibold">Por centro de custo</p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {data.byCostCenter.map((group) => (
                <li key={group.costCenterId ?? 'none'} className="flex justify-between gap-2 px-3 py-2">
                  <span>
                    {group.code ? `${group.code} — ` : ''}
                    {group.name} <span className="text-muted">· {group.deliveries} entrega(s)</span>
                  </span>
                  <span className="tabular-nums">{formatBRL(group.amountCents)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {open && can('company.finance.read') && (
          <div className="rounded-lg border border-border p-4">
            {data.pendingPix?.pixCopyPaste ? (
              <PixCharge copyPaste={data.pendingPix.pixCopyPaste} expiresAt={data.pendingPix.pixExpiresAt} amountCents={data.pendingPix.amountCents} />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p>Pague com PIX: a baixa é automática. Transferências e boletos são baixados pelo nosso financeiro.</p>
                <Button loading={paying} onClick={pay}>
                  Pagar com PIX
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

export default function InvoicesPage() {
  const { company } = useCompany();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<InvoiceStatus | ''>('');
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error, isLoading, refetch } = useApi<Paginated<Invoice>>(`companies/${company.id}/b2b/invoices`, { page, pageSize: 20, status: status || undefined });

  return (
    <Card
      title="Faturas"
      actions={
        <div className="flex gap-1">
          {(['', 'ISSUED', 'OVERDUE', 'PAID'] as const).map((value) => (
            <Button key={value} size="sm" variant={status === value ? 'secondary' : 'ghost'} onClick={() => { setStatus(value); setPage(1); }}>
              {value ? INVOICE_STATUS_LABELS[value] : 'Todas'}
            </Button>
          ))}
        </div>
      }
    >
      {isLoading && <SkeletonRows rows={3} />}
      {error && <PlanAwareError error={error} onRetry={() => refetch()} />}
      {data?.data.length === 0 && <EmptyState icon={<Receipt className="h-8 w-8" />} title="Nenhuma fatura" description="As entregas faturadas são cobradas mensalmente, no dia de fechamento do contrato." />}
      {data && data.data.length > 0 && (
        <>
          <DataTable
            rows={data.data}
            rowKey={(row) => row.id}
            onRowClick={(row) => setSelected(row.id)}
            columns={[
              { key: 'number', header: 'Fatura', cell: (row) => <span className="font-medium">#{row.number}</span> },
              { key: 'period', header: 'Período', cell: (row) => period(row), hideOnMobile: true },
              { key: 'deliveries', header: 'Entregas', className: 'tabular-nums', cell: (row) => row.deliveriesCount, hideOnMobile: true },
              { key: 'total', header: 'Total', className: 'text-right tabular-nums', cell: (row) => formatBRL(row.totalCents) },
              { key: 'due', header: 'Vencimento', cell: (row) => localDate(row.dueAt) },
              { key: 'status', header: 'Situação', cell: (row) => <Badge tone={TONE[row.status]}>{INVOICE_STATUS_LABELS[row.status]}</Badge> },
            ]}
          />
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={setPage} />
        </>
      )}
      {selected && <InvoiceDialog id={selected} onClose={() => setSelected(null)} onChanged={() => void refetch()} />}
    </Card>
  );
}
