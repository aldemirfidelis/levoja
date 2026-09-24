'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Calculator, Pencil, Plus, Trash2 } from 'lucide-react';
import { CONTRACT_STATUS_LABELS, formatBRL, INVOICE_STATUS_LABELS, VEHICLE_TYPE_LABELS, VEHICLE_TYPES, type ContractStatus, type InvoiceStatus } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { Badge, Button, Card, ConfirmDialog, DataTable, DescriptionList, Dialog, ErrorState, formatDate, Input, MoneyInput, PageHeader, Select, Skeleton, useToast } from '@levoja/web-kit/ui';
import { B2bNav, CONTRACT_TONE, INVOICE_TONE } from '@/components/b2b-nav';
import { ContractForm, type ContractValues } from '@/components/contract-form';
import { useSession } from '@/lib/session';

interface PriceRule {
  id: string;
  name: string;
  priority: number;
  vehicleType: keyof typeof VEHICLE_TYPE_LABELS | null;
  city: string | null;
  state: string | null;
  baseCents: number;
  perKmCents: number;
  includedKm: number;
  perMinuteCents: number;
  perKgCents: number;
  includedKg: number;
  minimumCents: number;
  maximumCents: number | null;
  nightSurchargeBps: number;
  rainSurchargeBps: number;
}

interface ContractDetail extends ContractValues {
  id: string;
  number: number;
  status: ContractStatus;
  company: { id: string; tradeName: string; status: string };
  activatedAt: string | null;
  endedAt: string | null;
  invoicedUntil: string | null;
  priceRules: PriceRule[];
  exposureCents: number;
  availableCreditCents: number;
  invoices: { id: string; number: number; status: InvoiceStatus; periodStart: string; periodEnd: string; totalCents: number; dueAt: string; paidAt: string | null }[];
}

type Action = 'activate' | 'suspend' | 'resume' | 'end';
const ACTIONS: Record<Action, { label: string; from: ContractStatus[]; tone: 'primary' | 'danger' | 'success'; needsReason: boolean; description: string }> = {
  activate: { label: 'Ativar', from: ['DRAFT'], tone: 'success', needsReason: false, description: 'A empresa passa a ter faturado, tabela especial e limite de crédito.' },
  suspend: { label: 'Suspender', from: ['ACTIVE'], tone: 'danger', needsReason: true, description: 'Novas entregas faturadas ficam bloqueadas até a reativação.' },
  resume: { label: 'Reativar', from: ['SUSPENDED'], tone: 'success', needsReason: false, description: 'O faturado volta a ser liberado.' },
  end: { label: 'Encerrar', from: ['DRAFT', 'ACTIVE', 'SUSPENDED'], tone: 'danger', needsReason: true, description: 'Emite a fatura final com o que estiver em aberto. Não pode ser desfeito.' },
};

const localDate = (value: string) => new Date(value).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

function RuleDialog({ contractId, rule, onClose, onSaved }: { contractId: string; rule: PriceRule | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: rule?.name ?? '',
    priority: rule?.priority ?? 0,
    vehicleType: rule?.vehicleType ?? '',
    city: rule?.city ?? '',
    state: rule?.state ?? '',
    baseCents: rule?.baseCents ?? 0,
    perKmCents: rule?.perKmCents ?? 0,
    includedKm: rule?.includedKm ?? 0,
    perMinuteCents: rule?.perMinuteCents ?? 0,
    perKgCents: rule?.perKgCents ?? 0,
    includedKg: rule?.includedKg ?? 0,
    minimumCents: rule?.minimumCents ?? 0,
    maximumCents: rule?.maximumCents ?? null,
    nightSurcharge: rule ? rule.nightSurchargeBps / 100 : 0,
    rainSurcharge: rule ? rule.rainSurchargeBps / 100 : 0,
  });
  const [busy, setBusy] = useState(false);
  const num = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: Number(event.target.value.replace(',', '.')) || 0 });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = {
      name: form.name,
      priority: form.priority,
      vehicleType: form.vehicleType || null,
      city: form.city || null,
      state: form.state || null,
      baseCents: form.baseCents,
      perKmCents: form.perKmCents,
      includedKm: form.includedKm,
      perMinuteCents: form.perMinuteCents,
      perKgCents: form.perKgCents,
      includedKg: form.includedKg,
      minimumCents: form.minimumCents,
      maximumCents: form.maximumCents,
      nightSurchargeBps: Math.round(form.nightSurcharge * 100),
      rainSurchargeBps: Math.round(form.rainSurcharge * 100),
    };
    setBusy(true);
    try {
      if (rule) await api.patch(`admin/b2b/contracts/${contractId}/rules/${rule.id}`, body);
      else await api.post(`admin/b2b/contracts/${contractId}/rules`, body);
      toast.success('Regra salva.');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} size="lg" title={rule ? `Editar regra "${rule.name}"` : 'Nova regra da tabela especial'} description="A regra mais específica (veículo, cidade, UF) e de maior prioridade é aplicada. Sem adicional de demanda.">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4">
        <Input className="sm:col-span-3" label="Nome" required minLength={2} maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <Input label="Prioridade" type="number" min={-100} max={100} value={form.priority} onChange={num('priority')} />
        <Select label="Veículo" value={form.vehicleType} onChange={(event) => setForm({ ...form, vehicleType: event.target.value })} options={[{ value: '', label: 'Qualquer' }, ...VEHICLE_TYPES.map((type) => ({ value: type, label: VEHICLE_TYPE_LABELS[type] }))]} />
        <Input className="sm:col-span-2" label="Cidade (opcional)" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
        <Input label="UF" maxLength={2} value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value.toUpperCase() })} />
        <MoneyInput label="Valor base" required value={form.baseCents} onChange={(cents) => setForm({ ...form, baseCents: cents ?? 0 })} />
        <Input label="Km inclusos" inputMode="decimal" value={form.includedKm} onChange={num('includedKm')} />
        <MoneyInput label="Por km adicional" value={form.perKmCents || null} onChange={(cents) => setForm({ ...form, perKmCents: cents ?? 0 })} />
        <MoneyInput label="Por minuto" value={form.perMinuteCents || null} onChange={(cents) => setForm({ ...form, perMinuteCents: cents ?? 0 })} />
        <Input label="Kg inclusos" inputMode="decimal" value={form.includedKg} onChange={num('includedKg')} />
        <MoneyInput label="Por kg adicional" value={form.perKgCents || null} onChange={(cents) => setForm({ ...form, perKgCents: cents ?? 0 })} />
        <MoneyInput label="Mínimo" value={form.minimumCents || null} onChange={(cents) => setForm({ ...form, minimumCents: cents ?? 0 })} />
        <MoneyInput label="Máximo" value={form.maximumCents} onChange={(cents) => setForm({ ...form, maximumCents: cents })} />
        <Input label="Adicional noturno (%)" inputMode="decimal" value={form.nightSurcharge} onChange={num('nightSurcharge')} />
        <Input label="Adicional de chuva (%)" inputMode="decimal" value={form.rainSurcharge} onChange={num('rainSurcharge')} />
        <div className="flex justify-end gap-2 sm:col-span-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy}>
            Salvar regra
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Simulator({ contractId }: { contractId: string }) {
  const toast = useToast();
  const [input, setInput] = useState({ distanceKm: '5', weightKg: '', vehicleType: '', city: '', state: '' });
  const [result, setResult] = useState<{ standardCents: number | null; contractCents: number | null; source: string; rule: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      setResult(
        await api.post(`admin/b2b/contracts/${contractId}/simulate`, {
          distanceKm: Number(input.distanceKm.replace(',', '.')),
          weightKg: input.weightKg ? Number(input.weightKg.replace(',', '.')) : undefined,
          vehicleType: input.vehicleType || undefined,
          city: input.city || undefined,
          state: input.state || undefined,
        }),
      );
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const source: Record<string, string> = { SPECIAL_TABLE: 'tabela especial', DISCOUNT: 'desconto do contrato', STANDARD: 'tabela padrão' };
  return (
    <Card title="Simular preço">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-6">
        <Input label="Distância (km)" required inputMode="decimal" value={input.distanceKm} onChange={(event) => setInput({ ...input, distanceKm: event.target.value })} />
        <Input label="Peso (kg)" inputMode="decimal" value={input.weightKg} onChange={(event) => setInput({ ...input, weightKg: event.target.value })} />
        <Select label="Veículo" value={input.vehicleType} onChange={(event) => setInput({ ...input, vehicleType: event.target.value })} options={[{ value: '', label: 'Qualquer' }, ...VEHICLE_TYPES.map((type) => ({ value: type, label: VEHICLE_TYPE_LABELS[type] }))]} />
        <Input label="Cidade" value={input.city} onChange={(event) => setInput({ ...input, city: event.target.value })} />
        <Input label="UF" maxLength={2} value={input.state} onChange={(event) => setInput({ ...input, state: event.target.value.toUpperCase() })} />
        <div className="flex items-end">
          <Button type="submit" variant="secondary" loading={busy} icon={<Calculator className="h-4 w-4" />}>
            Simular
          </Button>
        </div>
      </form>
      {result && (
        <p className="mt-4 text-sm">
          Contrato: <strong>{result.contractCents == null ? '—' : formatBRL(result.contractCents)}</strong> ({source[result.source]}
          {result.rule ? ` · ${result.rule}` : ''}) · Tabela padrão: {result.standardCents == null ? 'sem regra' : formatBRL(result.standardCents)}
          {result.contractCents != null && result.standardCents ? ` · ${Math.round((1 - result.contractCents / result.standardCents) * 1000) / 10}% de diferença` : ''}
        </p>
      )}
    </Card>
  );
}

export default function ContractPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const toast = useToast();
  const manage = can('contracts.manage');
  const { data, error, isLoading, refetch } = useApi<ContractDetail>(`admin/b2b/contracts/${id}`);
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [rule, setRule] = useState<PriceRule | 'new' | null>(null);
  const [removing, setRemoving] = useState<PriceRule | null>(null);
  const [closing, setClosing] = useState(false);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-96" />;
  const share = data.creditLimitCents ? Math.min(1, data.exposureCents / data.creditLimitCents) : 0;

  const runAction = async (reason: string) => {
    if (!action) return;
    try {
      await api.post(`admin/b2b/contracts/${id}/${action}`, reason ? { reason } : {});
      toast.success('Contrato atualizado.');
      setAction(null);
      await refetch();
    } catch (err) {
      toast.error(err);
    }
  };

  const closeNow = async () => {
    try {
      const result = await api.post<{ number?: number; message?: string }>(`admin/b2b/contracts/${id}/invoices/close`);
      toast.success(result.number ? `Fatura #${result.number} emitida.` : (result.message ?? 'Nada a faturar.'));
      setClosing(false);
      await refetch();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <PageHeader
        back={
          <Link href="/b2b" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" /> Contratos
          </Link>
        }
        title={`Contrato #${data.number} · ${data.title}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={CONTRACT_TONE[data.status]}>{CONTRACT_STATUS_LABELS[data.status]}</Badge>
            <Link href={`/empresas/${data.company.id}`} className="text-brand-600 hover:underline">
              {data.company.tradeName}
            </Link>
          </span>
        }
        actions={
          manage && (
            <div className="flex flex-wrap gap-2">
              {data.status !== 'ENDED' && (
                <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                  Editar condições
                </Button>
              )}
              {(Object.keys(ACTIONS) as Action[])
                .filter((key) => ACTIONS[key].from.includes(data.status))
                .map((key) => (
                  <Button key={key} variant={ACTIONS[key].tone === 'danger' ? 'ghost' : 'primary'} className={ACTIONS[key].tone === 'danger' ? 'text-danger' : undefined} onClick={() => setAction(key)}>
                    {ACTIONS[key].label}
                  </Button>
                ))}
            </div>
          )
        }
      />
      <B2bNav />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Condições">
            <DescriptionList
              items={[
                { label: 'Vigência', value: `${formatDate(data.startsOn)}${data.endsOn ? ` a ${formatDate(data.endsOn)}` : ' (sem término)'}` },
                { label: 'Fechamento', value: `Dia ${data.billingDay} · vencimento em ${data.paymentTermDays} dia(s)` },
                { label: 'Limite de crédito', value: formatBRL(data.creditLimitCents) },
                { label: 'Franquia mínima', value: data.minimumMonthlyCents ? formatBRL(data.minimumMonthlyCents) : '—' },
                { label: 'Desconto sobre a tabela padrão', value: data.discountBps ? `${(data.discountBps / 100).toLocaleString('pt-BR')}%` : '—' },
                { label: 'Bloqueio por atraso', value: `Após ${data.blockAfterOverdueDays} dia(s) de fatura vencida` },
                { label: 'Centro de custo', value: data.requireCostCenter ? 'Obrigatório' : 'Opcional' },
                { label: 'Aviso aos destinatários', value: data.notifyRecipients ? 'SMS ativo' : 'Desativado' },
                { label: 'Faturado até', value: data.invoicedUntil ? localDate(data.invoicedUntil) : 'Nenhuma fatura ainda' },
                ...(data.notes ? [{ label: 'Observações', value: data.notes }] : []),
              ]}
            />
          </Card>

          <Card title="Tabela especial" actions={manage && data.status !== 'ENDED' && <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setRule('new')}>Nova regra</Button>}>
            {data.priceRules.length === 0 ? (
              <p className="text-sm text-muted">Sem regras próprias: vale a tabela padrão{data.discountBps ? ` com ${(data.discountBps / 100).toLocaleString('pt-BR')}% de desconto` : ''}.</p>
            ) : (
              <DataTable
                rows={data.priceRules}
                rowKey={(row) => row.id}
                columns={[
                  { key: 'name', header: 'Regra', cell: (row) => <span className="font-medium">{row.name}</span> },
                  { key: 'filters', header: 'Aplica-se a', cell: (row) => [row.vehicleType ? VEHICLE_TYPE_LABELS[row.vehicleType] : 'Qualquer veículo', row.city, row.state].filter(Boolean).join(' · '), hideOnMobile: true },
                  {
                    key: 'price',
                    header: 'Preço',
                    cell: (row) =>
                      `${formatBRL(row.baseCents)}${row.includedKm ? ` até ${row.includedKm} km` : ''}${row.perKmCents ? ` + ${formatBRL(row.perKmCents)}/km` : ''}${row.minimumCents ? ` · mín. ${formatBRL(row.minimumCents)}` : ''}`,
                  },
                  { key: 'priority', header: 'Prioridade', className: 'tabular-nums', cell: (row) => row.priority, hideOnMobile: true },
                  ...(manage && data.status !== 'ENDED'
                    ? [
                        {
                          key: 'actions',
                          header: '',
                          className: 'text-right',
                          cell: (row: PriceRule) => (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" aria-label={`Editar ${row.name}`} onClick={() => setRule(row)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="ghost" aria-label={`Excluir ${row.name}`} className="text-danger" onClick={() => setRemoving(row)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            )}
          </Card>

          <Simulator contractId={id} />
        </div>

        <div className="space-y-6">
          <Card title="Crédito">
            <p className="text-sm text-muted">Em aberto (entregas faturadas não pagas)</p>
            <p className="text-2xl font-bold tabular-nums">{formatBRL(data.exposureCents)}</p>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={data.creditLimitCents} aria-valuenow={data.exposureCents} aria-label="Uso do limite de crédito">
              <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: share >= 0.9 ? 'var(--lj-danger)' : share >= 0.7 ? 'var(--lj-warning)' : 'var(--lj-chart-1)' }} />
            </div>
            <p className="mt-2 text-sm">
              {Math.round(share * 100)}% do limite · disponível <strong>{formatBRL(data.availableCreditCents)}</strong>
            </p>
          </Card>
          <Card
            title="Faturas"
            actions={
              can('invoices.manage') &&
              data.activatedAt &&
              data.status !== 'ENDED' && (
                <Button size="sm" variant="secondary" onClick={() => setClosing(true)}>
                  Fechar período agora
                </Button>
              )
            }
          >
            {data.invoices.length === 0 ? (
              <p className="text-sm text-muted">Nenhuma fatura emitida.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {data.invoices.map((invoice) => (
                  <li key={invoice.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/b2b/faturas?open=${invoice.id}`} className="text-brand-600 hover:underline">
                      #{invoice.number} · {localDate(invoice.periodStart)}
                    </Link>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{formatBRL(invoice.totalCents)}</span>
                      <Badge tone={INVOICE_TONE[invoice.status]}>{INVOICE_STATUS_LABELS[invoice.status]}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {editing && (
        <Dialog open onClose={() => setEditing(false)} size="lg" title="Editar condições">
          <ContractForm
            initial={data}
            locked={data.status !== 'DRAFT'}
            submitLabel="Salvar"
            onCancel={() => setEditing(false)}
            onSubmit={async (values) => {
              try {
                // Início e dia de fechamento só mudam antes da ativação.
                const { startsOn: _startsOn, billingDay: _billingDay, ...afterActivation } = values;
                await api.patch(`admin/b2b/contracts/${id}`, data.status === 'DRAFT' ? values : afterActivation);
                toast.success('Condições atualizadas.');
                setEditing(false);
                await refetch();
              } catch (err) {
                toast.error(err);
              }
            }}
          />
        </Dialog>
      )}
      {action && (
        <ConfirmDialog
          open
          onClose={() => setAction(null)}
          onConfirm={runAction}
          tone={ACTIONS[action].tone}
          title={`${ACTIONS[action].label} o contrato?`}
          confirmLabel={ACTIONS[action].label}
          description={ACTIONS[action].description}
          reason={ACTIONS[action].needsReason ? { label: 'Motivo (enviado à empresa)', required: true } : undefined}
        />
      )}
      {rule && <RuleDialog contractId={id} rule={rule === 'new' ? null : rule} onClose={() => setRule(null)} onSaved={() => { setRule(null); void refetch(); }} />}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        tone="danger"
        title={`Excluir a regra "${removing?.name ?? ''}"?`}
        confirmLabel="Excluir"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await api.delete(`admin/b2b/contracts/${id}/rules/${removing.id}`);
            toast.success('Regra excluída.');
            setRemoving(null);
            await refetch();
          } catch (err) {
            toast.error(err);
          }
        }}
      />
      <ConfirmDialog
        open={closing}
        onClose={() => setClosing(false)}
        onConfirm={closeNow}
        title="Fechar o período agora?"
        confirmLabel="Emitir fatura"
        description="Emite a fatura com as entregas faturadas concluídas até agora; o próximo período começa neste momento."
      />
    </>
  );
}
