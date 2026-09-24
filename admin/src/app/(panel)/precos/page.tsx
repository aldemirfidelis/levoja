'use client';

import { FormEvent, useState } from 'react';
import { Calculator, Plus } from 'lucide-react';
import { formatBRL, VEHICLE_TYPE_LABELS, VEHICLE_TYPES } from '@levoja/shared';
import { api, useApi, useApiMutation } from '@levoja/web-kit/client';
import { Badge, Button, Card, Checkbox, DataTable, Dialog, ErrorState, errorMessage, Input, PageHeader, Select, SkeletonRows, Tabs, useToast } from '@levoja/web-kit/ui';
import { useSession } from '@/lib/session';

type Target = 'CUSTOMER_FEE' | 'DRIVER_PAYOUT';

interface Rule {
  id: string;
  name: string;
  target: Target;
  isActive: boolean;
  priority: number;
  vehicleType: string | null;
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
  demandSurchargeMaxBps: number;
}

interface Quote {
  totalCents: number;
  ruleName: string;
  lines: { label: string; cents: number }[];
}

const pct = (bps: number) => `${(bps / 100).toLocaleString('pt-BR')}%`;

function RuleForm({ rule, target, onClose }: { rule: Rule | null; target: Target; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: rule?.name ?? '',
    isActive: rule?.isActive ?? true,
    priority: rule?.priority ?? 10,
    vehicleType: rule?.vehicleType ?? '',
    city: rule?.city ?? '',
    state: rule?.state ?? '',
    base: ((rule?.baseCents ?? 600) / 100).toString(),
    perKm: ((rule?.perKmCents ?? 150) / 100).toString(),
    includedKm: (rule?.includedKm ?? 2).toString(),
    perMinute: ((rule?.perMinuteCents ?? 0) / 100).toString(),
    perKg: ((rule?.perKgCents ?? 0) / 100).toString(),
    includedKg: (rule?.includedKg ?? 0).toString(),
    minimum: ((rule?.minimumCents ?? 600) / 100).toString(),
    maximum: rule?.maximumCents != null ? (rule.maximumCents / 100).toString() : '',
    night: ((rule?.nightSurchargeBps ?? 0) / 100).toString(),
    rain: ((rule?.rainSurchargeBps ?? 0) / 100).toString(),
    demand: ((rule?.demandSurchargeMaxBps ?? 0) / 100).toString(),
  });
  const [error, setError] = useState<string>();
  const cents = (value: string) => Math.round(Number(value.replace(',', '.')) * 100);
  const num = (value: string) => Number(value.replace(',', '.'));
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });

  const save = useApiMutation(() => {
    const body = {
      name: form.name,
      target,
      isActive: form.isActive,
      priority: Number(form.priority),
      vehicleType: form.vehicleType || null,
      city: form.city || null,
      state: form.state ? form.state.toUpperCase() : null,
      baseCents: cents(form.base),
      perKmCents: cents(form.perKm),
      includedKm: num(form.includedKm),
      perMinuteCents: cents(form.perMinute),
      perKgCents: cents(form.perKg),
      includedKg: num(form.includedKg),
      minimumCents: cents(form.minimum),
      maximumCents: form.maximum ? cents(form.maximum) : null,
      nightSurchargeBps: Math.round(num(form.night) * 100),
      rainSurchargeBps: Math.round(num(form.rain) * 100),
      demandSurchargeMaxBps: Math.round(num(form.demand) * 100),
    };
    return rule ? api.patch(`admin/pricing-rules/${rule.id}`, body) : api.post('admin/pricing-rules', body);
  }, ['admin/pricing-rules']);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await save.mutateAsync(undefined);
      toast.success('Regra salva. Vale em até 1 minuto.');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onClose={onClose} size="lg" title={rule ? `Editar regra: ${rule.name}` : 'Nova regra de preço'} description="VALOR BASE + KM excedente + MINUTOS + PESO excedente + adicionais, limitado ao mínimo/máximo.">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
        <Input className="sm:col-span-2" label="Nome" required value={form.name} onChange={set('name')} />
        <Input label="Prioridade" type="number" min={0} value={form.priority} onChange={set('priority')} hint="Maior vence." />
        <Select label="Veículo" value={form.vehicleType} placeholder="Qualquer" options={VEHICLE_TYPES.map((type) => ({ value: type, label: VEHICLE_TYPE_LABELS[type] }))} onChange={set('vehicleType')} />
        <Input label="Cidade" placeholder="Qualquer" value={form.city} onChange={set('city')} />
        <Input label="UF" placeholder="Qualquer" maxLength={2} value={form.state} onChange={set('state')} />
        <Input label="Valor base (R$)" inputMode="decimal" value={form.base} onChange={set('base')} />
        <Input label="Por km (R$)" inputMode="decimal" value={form.perKm} onChange={set('perKm')} />
        <Input label="Km incluídos" inputMode="decimal" value={form.includedKm} onChange={set('includedKm')} />
        <Input label="Por minuto (R$)" inputMode="decimal" value={form.perMinute} onChange={set('perMinute')} />
        <Input label="Por kg excedente (R$)" inputMode="decimal" value={form.perKg} onChange={set('perKg')} />
        <Input label="Kg incluídos" inputMode="decimal" value={form.includedKg} onChange={set('includedKg')} />
        <Input label="Mínimo (R$)" inputMode="decimal" value={form.minimum} onChange={set('minimum')} />
        <Input label="Máximo (R$)" inputMode="decimal" placeholder="Sem limite" value={form.maximum} onChange={set('maximum')} />
        <span />
        <Input label="Adicional noturno (%)" hint="22h às 6h" inputMode="decimal" value={form.night} onChange={set('night')} />
        <Input label="Adicional de chuva (%)" hint="Cidades em ops.rainCities" inputMode="decimal" value={form.rain} onChange={set('rain')} />
        <Input label="Teto do adicional de demanda (%)" inputMode="decimal" value={form.demand} onChange={set('demand')} />
        <Checkbox className="sm:col-span-3" label="Regra ativa" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
        {error && <p className="text-sm text-danger sm:col-span-3">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Simulator({ target }: { target: Target }) {
  const toast = useToast();
  const [form, setForm] = useState({ distanceKm: '5', durationMin: '18', weightKg: '', vehicleType: 'MOTORCYCLE', city: 'São Paulo', state: 'SP' });
  const [quote, setQuote] = useState<Quote | null>(null);
  const run = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setQuote(
        await api.post<Quote>('admin/pricing-rules/simulate', {
          target,
          distanceKm: Number(form.distanceKm),
          durationMin: Number(form.durationMin),
          weightKg: form.weightKg ? Number(form.weightKg) : undefined,
          vehicleType: form.vehicleType,
          city: form.city || undefined,
          state: form.state || undefined,
        }),
      );
    } catch (error) {
      toast.error(error);
    }
  };
  return (
    <Card title="Simulador">
      <form onSubmit={run} className="grid gap-3 sm:grid-cols-3">
        <Input label="Distância (km)" value={form.distanceKm} onChange={(e) => setForm({ ...form, distanceKm: e.target.value })} />
        <Input label="Tempo (min)" value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: e.target.value })} />
        <Input label="Peso (kg)" value={form.weightKg} onChange={(e) => setForm({ ...form, weightKg: e.target.value })} />
        <Select label="Veículo" value={form.vehicleType} options={VEHICLE_TYPES.map((type) => ({ value: type, label: VEHICLE_TYPE_LABELS[type] }))} onChange={(e) => setForm({ ...form, vehicleType: e.target.value })} />
        <Input label="Cidade" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        <Input label="UF" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
        <Button type="submit" className="sm:col-span-3 sm:w-fit" icon={<Calculator className="h-4 w-4" />}>
          Calcular agora
        </Button>
      </form>
      {quote && (
        <div className="mt-4 rounded-lg bg-surface-2 p-4 text-sm">
          <p className="mb-2 text-muted">Regra aplicada: {quote.ruleName}</p>
          <ul className="space-y-1">
            {quote.lines.map((line, index) => (
              <li key={index} className="flex justify-between">
                <span>{line.label}</span>
                <span className="tabular-nums">{formatBRL(line.cents)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex justify-between border-t border-border pt-2 font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatBRL(quote.totalCents)}</span>
          </p>
        </div>
      )}
    </Card>
  );
}

export default function PricingPage() {
  const { can } = useSession();
  const [target, setTarget] = useState<Target>('CUSTOMER_FEE');
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const { data, error, isLoading, refetch } = useApi<Rule[]>('admin/pricing-rules');
  const rules = (data ?? []).filter((rule) => rule.target === target);

  return (
    <>
      <PageHeader
        title="Precificação"
        description="Regras do valor de entrega (cliente) e do repasse ao entregador. A regra ativa mais específica e de maior prioridade é aplicada."
        actions={can('pricing.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Nova regra</Button>}
      />
      <Tabs
        value={target}
        onChange={setTarget}
        items={[
          { value: 'CUSTOMER_FEE', label: 'Valor da entrega (cliente)' },
          { value: 'DRIVER_PAYOUT', label: 'Repasse ao entregador' },
        ]}
      />
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <DataTable
          rows={rules}
          rowKey={(row) => row.id}
          onRowClick={can('pricing.manage') ? (row) => setEditing(row) : undefined}
          columns={[
            {
              key: 'name',
              header: 'Regra',
              cell: (row) => (
                <div>
                  <p className="font-medium">{row.name}</p>
                  <p className="text-xs text-muted">
                    {row.vehicleType ? VEHICLE_TYPE_LABELS[row.vehicleType as keyof typeof VEHICLE_TYPE_LABELS] : 'Qualquer veículo'}
                    {row.city ? ` · ${row.city}` : ''}
                    {row.state ? `/${row.state}` : ''} · prioridade {row.priority}
                  </p>
                </div>
              ),
            },
            { key: 'formula', header: 'Fórmula', cell: (row) => `${formatBRL(row.baseCents)} + ${formatBRL(row.perKmCents)}/km (após ${row.includedKm} km)` },
            { key: 'min', header: 'Mín.', hideOnMobile: true, cell: (row) => formatBRL(row.minimumCents) },
            {
              key: 'extras',
              header: 'Adicionais',
              hideOnMobile: true,
              cell: (row) => <span className="text-xs text-muted">noite {pct(row.nightSurchargeBps)} · chuva {pct(row.rainSurchargeBps)} · demanda até {pct(row.demandSurchargeMaxBps)}</span>,
            },
            { key: 'active', header: '', cell: (row) => (row.isActive ? <Badge tone="success">Ativa</Badge> : <Badge>Inativa</Badge>) },
          ]}
        />
        <Simulator target={target} />
      </div>
      {editing && <RuleForm rule={editing === 'new' ? null : editing} target={target} onClose={() => setEditing(null)} />}
    </>
  );
}
