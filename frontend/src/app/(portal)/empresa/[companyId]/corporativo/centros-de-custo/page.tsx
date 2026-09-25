'use client';

import { FormEvent, useState } from 'react';
import { Plus, Wallet } from 'lucide-react';
import { formatBRL } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { Badge, Button, Card, DataTable, Dialog, EmptyState, Input, MoneyInput, SkeletonRows, useToast } from '@levoja/web-kit/ui';
import type { CostCenter } from '@/components/b2b';
import { useCompany } from '@/lib/company';
import { PlanAwareError } from '@/components/plan-gate';

/** Gasto do mês x orçamento (cor indica o nível; o valor vem escrito ao lado). */
function BudgetBar({ center }: { center: CostCenter }) {
  if (center.monthlyBudgetCents == null) return <span className="text-sm text-muted">{formatBRL(center.spentThisMonthCents)} no mês · sem limite</span>;
  const share = center.monthlyBudgetCents ? Math.min(1, center.spentThisMonthCents / center.monthlyBudgetCents) : 1;
  const color = share >= 0.9 ? 'var(--lj-danger)' : share >= 0.7 ? 'var(--lj-warning)' : 'var(--lj-chart-1)';
  return (
    <div className="min-w-40">
      <p className="text-sm tabular-nums">
        {formatBRL(center.spentThisMonthCents)} de {formatBRL(center.monthlyBudgetCents)}
      </p>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function CostCenterDialog({ center, onClose, onSaved }: { center: CostCenter | null; onClose: () => void; onSaved: () => void }) {
  const { company } = useCompany();
  const toast = useToast();
  const [code, setCode] = useState(center?.code ?? '');
  const [name, setName] = useState(center?.name ?? '');
  const [budget, setBudget] = useState<number | null>(center?.monthlyBudgetCents ?? null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (center) await api.patch(`companies/${company.id}/b2b/cost-centers/${center.id}`, { name, monthlyBudgetCents: budget });
      else await api.post(`companies/${company.id}/b2b/cost-centers`, { code, name, monthlyBudgetCents: budget });
      toast.success('Centro de custo salvo.');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={center ? `Editar ${center.code}` : 'Novo centro de custo'} description="O código também é usado na coluna centro_custo das planilhas de lote.">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Código" required disabled={!!center} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={20} pattern="[A-Za-z0-9._\-]{1,20}" hint="Letras, números, ponto, hífen ou sublinhado." />
        <Input label="Nome" required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
        <MoneyInput label="Orçamento mensal (opcional)" value={budget} onChange={setBudget} hint="Entregas acima do orçamento do mês são recusadas." />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
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

export default function CostCentersPage() {
  const { company, can } = useCompany();
  const toast = useToast();
  const manage = can('company.b2b.manage');
  const { data, error, isLoading, refetch } = useApi<CostCenter[]>(`companies/${company.id}/b2b/cost-centers`);
  const [editing, setEditing] = useState<CostCenter | 'new' | null>(null);

  const toggle = async (center: CostCenter) => {
    try {
      await api.patch(`companies/${company.id}/b2b/cost-centers/${center.id}`, { isActive: !center.isActive });
      toast.success(center.isActive ? 'Centro de custo desativado.' : 'Centro de custo reativado.');
      await refetch();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Card title="Centros de custo" actions={manage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Novo centro de custo</Button>}>
      <p className="mb-4 text-sm text-muted">Classifique as entregas por área ou projeto. A fatura e o relatório corporativo mostram o gasto de cada centro de custo.</p>
      {isLoading && <SkeletonRows rows={3} />}
      {error && <PlanAwareError error={error} onRetry={() => refetch()} />}
      {data?.length === 0 && <EmptyState icon={<Wallet className="h-8 w-8" />} title="Nenhum centro de custo" />}
      {data && data.length > 0 && (
        <DataTable
          rows={data}
          rowKey={(row) => row.id}
          columns={[
            { key: 'code', header: 'Código', cell: (row) => <span className="font-mono text-sm font-semibold">{row.code}</span> },
            { key: 'name', header: 'Nome', cell: (row) => row.name },
            { key: 'budget', header: 'Mês atual', cell: (row) => <BudgetBar center={row} /> },
            { key: 'status', header: 'Situação', cell: (row) => <Badge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'Ativo' : 'Inativo'}</Badge>, hideOnMobile: true },
            ...(manage
              ? [
                  {
                    key: 'actions',
                    header: '',
                    className: 'text-right',
                    cell: (row: CostCenter) => (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                          Editar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void toggle(row)}>
                          {row.isActive ? 'Desativar' : 'Reativar'}
                        </Button>
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
      {editing && (
        <CostCenterDialog
          center={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refetch();
          }}
        />
      )}
    </Card>
  );
}
