'use client';

import { FormEvent, useState } from 'react';
import { Layers, Plus } from 'lucide-react';
import { formatBRL, PLAN_FEATURE_LABELS, PLAN_FEATURES, PLAN_LIMIT_KEYS, PLAN_LIMIT_LABELS, type PlanFeature, type PlanLimitKey } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, ErrorState, Input, MoneyInput, PageHeader, SkeletonRows, Textarea, useToast } from '@levoja/web-kit/ui';
import { limitLabel, SaasNav } from '@/components/saas-nav';
import { useSession } from '@/lib/session';

interface Plan {
  id: string;
  key: string;
  name: string;
  description: string | null;
  priceCents: number;
  features: PlanFeature[];
  limits: Record<PlanLimitKey, number | null>;
  trialDays: number;
  isPublic: boolean;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
  subscribers: number;
}

interface SaasSetting {
  key: string;
  value: { enabled: boolean; graceDays: number; restrictAfterDays: number };
}

const emptyLimits = () => Object.fromEntries(PLAN_LIMIT_KEYS.map((key) => [key, ''])) as Record<PlanLimitKey, string>;

function PlanForm({ plan, onClose, onSaved }: { plan: Plan | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    key: plan?.key ?? '',
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    priceCents: plan?.priceCents ?? 0,
    features: new Set<PlanFeature>(plan?.features ?? ['catalog', 'orders']),
    limits: plan ? (Object.fromEntries(PLAN_LIMIT_KEYS.map((key) => [key, plan.limits[key] == null ? '' : String(plan.limits[key])])) as Record<PlanLimitKey, string>) : emptyLimits(),
    trialDays: plan?.trialDays ?? 0,
    isPublic: plan?.isPublic ?? true,
    isActive: plan?.isActive ?? true,
    isDefault: plan?.isDefault ?? false,
    sortOrder: plan?.sortOrder ?? 0,
  });
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const body = {
      name: form.name,
      description: form.description || undefined,
      priceCents: form.priceCents,
      features: [...form.features],
      limits: Object.fromEntries(PLAN_LIMIT_KEYS.map((key) => [key, form.limits[key] === '' ? null : Number(form.limits[key])])),
      trialDays: form.trialDays,
      isPublic: form.isPublic,
      isActive: form.isActive,
      isDefault: form.isDefault,
      sortOrder: form.sortOrder,
    };
    try {
      if (plan) await api.patch(`admin/saas/plans/${plan.id}`, body);
      else await api.post('admin/saas/plans', { ...body, key: form.key });
      toast.success(plan ? 'Plano atualizado.' : 'Plano criado.');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} size="lg" title={plan ? `Plano ${plan.name}` : 'Novo plano'} description="Mudanças de preço valem a partir do próximo período de cada assinatura. Recursos e limites valem na hora.">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Input label="Chave" required disabled={!!plan} pattern="[a-z0-9-]{2,40}" value={form.key} onChange={(event) => setForm({ ...form, key: event.target.value })} hint="Letras minúsculas, números e hífen." />
        <Input label="Nome" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <Textarea className="sm:col-span-2" label="Descrição" maxLength={300} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        <MoneyInput label="Mensalidade" value={form.priceCents} onChange={(cents) => setForm({ ...form, priceCents: cents ?? 0 })} hint="Zero = plano grátis." />
        <Input label="Dias de teste grátis" type="number" min={0} max={90} value={form.trialDays} onChange={(event) => setForm({ ...form, trialDays: Number(event.target.value) })} />
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-fg">Recursos incluídos</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {PLAN_FEATURES.map((feature) => (
              <Checkbox
                key={feature}
                label={PLAN_FEATURE_LABELS[feature]}
                checked={form.features.has(feature)}
                onChange={(event) => {
                  const next = new Set(form.features);
                  if (event.target.checked) next.add(feature);
                  else next.delete(feature);
                  setForm({ ...form, features: next });
                }}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-medium text-fg">Limites (vazio = sem limite)</legend>
          {PLAN_LIMIT_KEYS.map((key) => (
            <Input key={key} label={PLAN_LIMIT_LABELS[key]} type="number" min={0} value={form.limits[key]} onChange={(event) => setForm({ ...form, limits: { ...form.limits, [key]: event.target.value } })} />
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-4 sm:col-span-2">
          <Checkbox label="Disponível para contratação pelas empresas" checked={form.isPublic} onChange={(event) => setForm({ ...form, isPublic: event.target.checked })} />
          <Checkbox label="Ativo" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
          <Checkbox label="Plano padrão (empresas sem assinatura)" checked={form.isDefault} onChange={(event) => setForm({ ...form, isDefault: event.target.checked })} />
        </div>
        <Input label="Ordem de exibição" type="number" min={0} value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })} />
        <div className="flex items-end justify-end gap-2">
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

export default function PlansPage() {
  const { can } = useSession();
  const toast = useToast();
  const { data, error, isLoading, refetch } = useApi<Plan[]>('admin/saas/plans');
  const settings = useApi<SaasSetting[]>('admin/settings', undefined, { enabled: can('settings.manage') });
  const saas = settings.data?.find((setting) => setting.key === 'saas')?.value;
  const [editing, setEditing] = useState<Plan | null | 'new'>(null);
  const [toggling, setToggling] = useState(false);

  const toggle = async () => {
    if (!saas) return;
    setToggling(true);
    try {
      await api.put('admin/settings/saas', { value: { ...saas, enabled: !saas.enabled } });
      toast.success(saas.enabled ? 'Cobrança por planos desligada: todas as empresas com todos os recursos.' : 'Cobrança por planos ligada.');
      await settings.refetch();
    } catch (err) {
      toast.error(err);
    } finally {
      setToggling(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Planos SaaS"
        description="Recursos, limites e mensalidade de cada plano para empresas. A mensalidade é lançada na carteira da empresa; cobranças em aberto além da carência deixam a assinatura em atraso."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            Novo plano
          </Button>
        }
      />
      <SaasNav />
      {saas && (
        <Card className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div>
              <p className="font-medium text-fg">{saas.enabled ? 'Cobrança por planos ligada' : 'Cobrança por planos desligada'}</p>
              <p className="text-muted">
                {saas.enabled
                  ? `Recursos e limites seguem o plano de cada empresa. Carência de ${saas.graceDays} dia(s) para cobranças em aberto; após mais ${saas.restrictAfterDays} dia(s) em atraso, valem os recursos do plano padrão.`
                  : 'Todas as empresas têm todos os recursos, sem cobrança. Ligue quando os planos estiverem definidos.'}
              </p>
            </div>
            <Button variant={saas.enabled ? 'secondary' : 'primary'} loading={toggling} onClick={() => void toggle()}>
              {saas.enabled ? 'Desligar' : 'Ligar cobrança por planos'}
            </Button>
          </div>
        </Card>
      )}
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.length === 0 && <EmptyState icon={<Layers className="h-8 w-8" />} title="Nenhum plano" />}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.map((plan) => (
          <Card
            key={plan.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {plan.name}
                {plan.isDefault && <Badge tone="brand">Padrão</Badge>}
                {!plan.isActive && <Badge>Inativo</Badge>}
                {!plan.isPublic && <Badge tone="info">Sob consulta</Badge>}
              </span>
            }
            actions={
              <Button size="sm" variant="ghost" onClick={() => setEditing(plan)}>
                Editar
              </Button>
            }
          >
            <p className="text-2xl font-semibold tabular-nums text-fg">
              {plan.priceCents ? formatBRL(plan.priceCents) : 'Grátis'}
              {plan.priceCents > 0 && <span className="text-sm font-normal text-muted">/mês</span>}
            </p>
            <p className="mt-1 text-sm text-muted">
              {plan.subscribers} empresa(s) · {plan.trialDays ? `${plan.trialDays} dias grátis` : 'sem teste grátis'} · chave <code>{plan.key}</code>
            </p>
            {plan.description && <p className="mt-2 text-sm text-fg">{plan.description}</p>}
            <ul className="mt-3 space-y-1 text-sm text-fg">
              {plan.features.map((feature) => (
                <li key={feature}>✓ {PLAN_FEATURE_LABELS[feature] ?? feature}</li>
              ))}
            </ul>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted">
              {PLAN_LIMIT_KEYS.map((key) => (
                <div key={key} className="contents">
                  <dt>{PLAN_LIMIT_LABELS[key]}</dt>
                  <dd className="text-right tabular-nums text-fg">{limitLabel(plan.limits[key])}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>
      {editing && (
        <PlanForm
          plan={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refetch();
          }}
        />
      )}
    </>
  );
}
