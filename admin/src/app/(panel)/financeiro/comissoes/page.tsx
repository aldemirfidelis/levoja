'use client';

import { FormEvent, useState } from 'react';
import { Percent, Plus } from 'lucide-react';
import { formatBRL } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { Badge, Button, Checkbox, DataTable, Dialog, EmptyState, ErrorState, errorMessage, formatDateTime, Input, MoneyInput, PageHeader, Select, SkeletonRows, useToast } from '@levoja/web-kit/ui';
import { CompanyPicker } from '@/components/company-picker';
import { FinanceNav } from '@/components/finance-nav';
import { useSession } from '@/lib/session';

interface Rule {
  id: string;
  name: string;
  companyId: string | null;
  companyName: string | null;
  segmentId: string | null;
  segmentName: string | null;
  percentBps: number;
  fixedCents: number;
  priority: number;
  isActive: boolean;
  validFrom: string | null;
  validTo: string | null;
}

const pct = (bps: number) => `${(bps / 100).toLocaleString('pt-BR')}%`;
const toDateInput = (value: string | null) => (value ? value.slice(0, 10) : '');

function RuleForm({ rule, onClose, onSaved }: { rule: Rule | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { data: segments } = useApi<{ id: string; name: string }[]>('segments');
  const [form, setForm] = useState({
    name: rule?.name ?? '',
    company: rule?.companyId ? { id: rule.companyId, name: rule.companyName ?? 'Empresa' } : null,
    segmentId: rule?.segmentId ?? '',
    percent: rule ? String(rule.percentBps / 100) : '12',
    fixedCents: rule?.fixedCents ?? 0,
    priority: String(rule?.priority ?? 0),
    isActive: rule?.isActive ?? true,
    validFrom: toDateInput(rule?.validFrom ?? null),
    validTo: toDateInput(rule?.validTo ?? null),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const percentBps = Math.round(Number(form.percent.replace(',', '.')) * 100);
    if (!(percentBps >= 0 && percentBps <= 5000)) return setError('A comissão deve estar entre 0% e 50%.');
    const body = {
      name: form.name.trim(),
      companyId: form.company?.id ?? null,
      segmentId: form.segmentId || null,
      percentBps,
      fixedCents: form.fixedCents ?? 0,
      priority: Number(form.priority) || 0,
      isActive: form.isActive,
      validFrom: form.validFrom ? new Date(`${form.validFrom}T00:00:00`).toISOString() : null,
      validTo: form.validTo ? new Date(`${form.validTo}T23:59:59`).toISOString() : null,
    };
    setBusy(true);
    try {
      if (rule) await api.patch(`admin/finance/commission-rules/${rule.id}`, body);
      else await api.post('admin/finance/commission-rules', body);
      toast.success('Regra salva. Vale para os próximos pedidos liquidados.');
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} size="lg" title={rule ? `Editar: ${rule.name}` : 'Nova regra de comissão'} description="Comissão = percentual sobre as vendas (após cupons da loja) + valor fixo por pedido.">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Input className="sm:col-span-2" label="Nome" required minLength={2} maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <CompanyPicker label="Empresa" value={form.company} onChange={(company) => setForm({ ...form, company })} />
        <Select
          label="Segmento"
          value={form.segmentId}
          placeholder="Todos os segmentos"
          options={(segments ?? []).map((segment) => ({ value: segment.id, label: segment.name }))}
          onChange={(e) => setForm({ ...form, segmentId: e.target.value })}
        />
        <Input label="Percentual (%)" inputMode="decimal" required value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} />
        <MoneyInput label="Valor fixo por pedido" value={form.fixedCents} onChange={(fixedCents) => setForm({ ...form, fixedCents: fixedCents ?? 0 })} />
        <Input label="Vigência: início" type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
        <Input label="Vigência: fim" type="date" value={form.validTo} min={form.validFrom || undefined} onChange={(e) => setForm({ ...form, validTo: e.target.value })} />
        <Input label="Prioridade" type="number" min={-1000} max={1000} hint="Desempate entre regras igualmente específicas (maior vence)." value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
        <Checkbox className="self-center" label="Regra ativa" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
        {error && <p className="text-sm text-danger sm:col-span-2" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function CommissionsPage() {
  const { can } = useSession();
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const { data, error, isLoading, refetch } = useApi<Rule[]>('admin/finance/commission-rules');
  const manage = can('pricing.manage');

  return (
    <>
      <PageHeader
        title="Comissões"
        description="Regra aplicada na liquidação de cada pedido: a mais específica (empresa > segmento > padrão), vigente e de maior prioridade. Sem regras, vale 12%."
        actions={manage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Nova regra</Button>}
      />
      <FinanceNav />
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.length === 0 && <EmptyState icon={<Percent className="h-8 w-8" />} title="Nenhuma regra cadastrada" description="Enquanto não houver regras, a comissão padrão de 12% é aplicada." />}
      {!!data?.length && (
        <DataTable
          rows={data}
          rowKey={(row) => row.id}
          onRowClick={manage ? (row) => setEditing(row) : undefined}
          columns={[
            {
              key: 'name',
              header: 'Regra',
              cell: (row) => (
                <span>
                  <span className="font-medium">{row.name}</span>
                  <span className="block text-xs text-muted">
                    {row.companyName ?? 'Todas as empresas'} · {row.segmentName ?? 'todos os segmentos'} · prioridade {row.priority}
                  </span>
                </span>
              ),
            },
            { key: 'rate', header: 'Comissão', cell: (row) => `${pct(row.percentBps)}${row.fixedCents ? ` + ${formatBRL(row.fixedCents)}` : ''}` },
            {
              key: 'validity',
              header: 'Vigência',
              hideOnMobile: true,
              cell: (row) => (row.validFrom || row.validTo ? `${row.validFrom ? formatDateTime(row.validFrom) : '…'} → ${row.validTo ? formatDateTime(row.validTo) : '…'}` : 'Permanente'),
            },
            { key: 'active', header: '', cell: (row) => (row.isActive ? <Badge tone="success">Ativa</Badge> : <Badge>Inativa</Badge>) },
          ]}
        />
      )}
      {editing && <RuleForm rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => refetch()} />}
    </>
  );
}
