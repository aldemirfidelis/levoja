'use client';

import { FormEvent, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { BATCH_STATUS_LABELS, formatBRL } from '@levoja/shared';
import { api, Paginated, useApi } from '@levoja/web-kit/client';
import { Badge, Button, Card, Checkbox, DataTable, Dialog, EmptyState, formatDateTime, Input, Pagination, Select, SkeletonRows, useToast } from '@levoja/web-kit/ui';
import { BATCH_TONE, type B2bOverview, type BatchView, type CompanyLocation, type CostCenter } from '@/components/b2b';
import { useCompany } from '@/lib/company';
import { PlanAwareError } from '@/components/plan-gate';

function UploadDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { company } = useCompany();
  const toast = useToast();
  const { data: b2b } = useApi<B2bOverview>(`companies/${company.id}/b2b`);
  const { data: locations } = useApi<CompanyLocation[]>(`companies/${company.id}/b2b/locations`);
  const { data: centers } = useApi<CostCenter[]>(`companies/${company.id}/b2b/cost-centers`);
  const file = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ name: '', paymentMethod: '', locationId: '', costCenterId: '', scheduledFor: '', planRoutes: true });
  const [busy, setBusy] = useState(false);
  const payment = form.paymentMethod || (b2b?.canInvoice ? 'INVOICE' : 'WALLET');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const selected = file.current?.files?.[0];
    if (!selected) return toast.error(new Error('Escolha a planilha.'));
    const data = new FormData();
    data.append('file', selected);
    data.append('paymentMethod', payment);
    data.append('planRoutes', String(form.planRoutes));
    if (form.name) data.append('name', form.name);
    if (form.locationId) data.append('locationId', form.locationId);
    if (form.costCenterId) data.append('costCenterId', form.costCenterId);
    if (form.scheduledFor) data.append('scheduledFor', new Date(form.scheduledFor).toISOString());
    setBusy(true);
    try {
      const batch = await api.upload<{ id: string; ignoredHeaders: string[] }>(`companies/${company.id}/delivery-batches/upload`, data);
      toast.success(batch.ignoredHeaders.length ? `Lote enviado. Colunas ignoradas: ${batch.ignoredHeaders.join(', ')}.` : 'Lote enviado para validação.');
      onCreated(batch.id);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title="Importar lote de entregas" description="Envie uma planilha CSV ou Excel (até 2 MB). Endereços e preços são validados antes da confirmação.">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex flex-wrap gap-3 text-sm">
          <a href={api.fileUrl(`companies/${company.id}/delivery-batches/template.xlsx`)} className="inline-flex items-center gap-1.5 font-medium text-brand-600 hover:underline" download>
            <FileSpreadsheet className="h-4 w-4" aria-hidden /> Modelo Excel (com instruções)
          </a>
          <a href={api.fileUrl(`companies/${company.id}/delivery-batches/template.csv`)} className="inline-flex items-center gap-1.5 font-medium text-brand-600 hover:underline" download>
            <FileSpreadsheet className="h-4 w-4" aria-hidden /> Modelo CSV
          </a>
        </div>
        <label className="block text-sm font-medium text-fg">
          Planilha
          <input ref={file} type="file" required accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="mt-1 block w-full text-sm" />
        </label>
        <Input label="Nome do lote (opcional)" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={80} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Pagamento"
            value={payment}
            onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })}
            options={[...(b2b?.canInvoice ? [{ value: 'INVOICE', label: `Faturado (crédito ${formatBRL(b2b.availableCreditCents)})` }] : []), { value: 'WALLET', label: 'Saldo da carteira' }]}
          />
          <Input label="Agendar para (opcional)" type="datetime-local" value={form.scheduledFor} onChange={(event) => setForm({ ...form, scheduledFor: event.target.value })} hint="Mínimo de 1 hora de antecedência." />
          <Select
            label="Coleta"
            value={form.locationId}
            onChange={(event) => setForm({ ...form, locationId: event.target.value })}
            options={[{ value: '', label: 'Endereço da empresa' }, ...(locations ?? []).map((location) => ({ value: location.id, label: location.name }))]}
          />
          <Select
            label="Centro de custo padrão"
            value={form.costCenterId}
            onChange={(event) => setForm({ ...form, costCenterId: event.target.value })}
            options={[{ value: '', label: 'Nenhum (ou pela coluna da planilha)' }, ...(centers ?? []).filter((center) => center.isActive).map((center) => ({ value: center.id, label: `${center.code} — ${center.name}` }))]}
          />
        </div>
        <Checkbox label="Agrupar em rotas (várias paradas por entregador — menos custo e mais agilidade)" checked={form.planRoutes} onChange={(event) => setForm({ ...form, planRoutes: event.target.checked })} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} icon={<Upload className="h-4 w-4" />}>
            Enviar e validar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function BatchesPage() {
  const { company, can } = useCompany();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const { data, error, isLoading, refetch } = useApi<Paginated<BatchView>>(`companies/${company.id}/delivery-batches`, { page, pageSize: 20 }, {
    refetchInterval: (query) => (query.state.data?.data.some((batch) => batch.status === 'VALIDATING' || (batch.status === 'CONFIRMED' && !batch.completedAt)) ? 5_000 : false),
  });
  const open = (id: string) => router.push(`/empresa/${company.id}/corporativo/lotes/${id}`);

  return (
    <Card title="Entregas em lote" actions={can('company.deliveries.request') && <Button icon={<Upload className="h-4 w-4" />} onClick={() => setUploading(true)}>Importar planilha</Button>}>
      <p className="mb-4 text-sm text-muted">
        Importe dezenas ou centenas de entregas de uma vez. Validamos cada endereço e preço, agrupamos as entregas em rotas e acompanhamos tudo até a última entrega. Integrações também podem enviar lotes pela API.
      </p>
      {isLoading && <SkeletonRows rows={4} />}
      {error && <PlanAwareError error={error} onRetry={() => refetch()} />}
      {data?.data.length === 0 && <EmptyState icon={<FileSpreadsheet className="h-8 w-8" />} title="Nenhum lote ainda" description="Baixe o modelo, preencha e importe." />}
      {data && data.data.length > 0 && (
        <>
          <DataTable
            rows={data.data}
            rowKey={(row) => row.id}
            onRowClick={(row) => open(row.id)}
            columns={[
              { key: 'number', header: 'Lote', cell: (row) => <span className="font-medium">#{row.number}{row.name ? ` · ${row.name}` : ''}</span> },
              { key: 'status', header: 'Situação', cell: (row) => <Badge tone={BATCH_TONE[row.status]}>{row.completedAt ? 'Concluído' : BATCH_STATUS_LABELS[row.status]}</Badge> },
              {
                key: 'items',
                header: 'Entregas',
                cell: (row) =>
                  row.progress ? `${row.progress.finished}/${row.progress.total} finalizadas` : row.status === 'VALIDATING' ? `${row.itemsCount} linhas` : `${row.validCount} válidas · ${row.invalidCount} com erro`,
              },
              { key: 'total', header: 'Valor', className: 'text-right tabular-nums', cell: (row) => formatBRL(row.totalFeeCents), hideOnMobile: true },
              { key: 'source', header: 'Origem', cell: (row) => (row.source === 'API' ? 'API' : (row.fileName ?? row.source)), hideOnMobile: true },
              { key: 'created', header: 'Criado', cell: (row) => formatDateTime(row.createdAt), hideOnMobile: true },
            ]}
          />
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={setPage} />
        </>
      )}
      {uploading && (
        <UploadDialog
          onClose={() => setUploading(false)}
          onCreated={(id) => {
            setUploading(false);
            open(id);
          }}
        />
      )}
    </Card>
  );
}
