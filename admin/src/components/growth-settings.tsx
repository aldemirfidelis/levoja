'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { formatBRL } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { Button, Card, Checkbox, ErrorState, Input, MoneyInput, Skeleton, useToast } from '@levoja/web-kit/ui';

export interface Tier {
  key: string;
  name: string;
  minPoints: number;
  multiplierBps: number;
  cashbackBps: number;
}

interface LoyaltySettings {
  enabled: boolean;
  pointsPerReal: number;
  pointValueCents: number;
  minRedeemPoints: number;
  expireAfterInactiveDays: number;
  tiers: Tier[];
}

interface ProgramRules {
  enabled: boolean;
  referrerRewardCents: number;
  referredRewardCents: number;
}

interface ReferralSettings {
  enabled: boolean;
  windowDays: number;
  maxPerReferrerPerMonth: number;
  customer: ProgramRules & { minOrderCents: number };
  driver: ProgramRules & { deliveriesRequired: number };
  company: ProgramRules & { ordersRequired: number };
}

interface PlatformSetting {
  key: string;
  value: unknown;
}

function useSetting<T>(key: 'loyalty' | 'referral') {
  const query = useApi<PlatformSetting[]>('admin/settings');
  const [form, setForm] = useState<T | null>(null);
  useEffect(() => {
    const stored = query.data?.find((setting) => setting.key === key);
    if (stored) setForm(stored.value as T);
  }, [query.data, key]);
  return { ...query, form, setForm };
}

const num = (value: string) => (value === '' ? 0 : Number(value.replace(',', '.')));

/** Regras da fidelidade: pontos por real, valor do ponto, níveis (multiplicador e cashback) e expiração. */
export function LoyaltySettingsForm({ onSaved }: { onSaved?: () => void }) {
  const toast = useToast();
  const { form, setForm, error, isLoading, refetch } = useSetting<LoyaltySettings>('loyalty');
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !form) return <Skeleton className="h-80" />;

  const set = <K extends keyof LoyaltySettings>(key: K, value: LoyaltySettings[K]) => setForm({ ...form, [key]: value });
  const setTier = (index: number, patch: Partial<Tier>) => set('tiers', form.tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.put('admin/settings/loyalty', { value: { ...form, tiers: [...form.tiers].sort((a, b) => a.minPoints - b.minPoints) } });
      toast.success('Regras da fidelidade salvas.');
      await refetch();
      onSaved?.();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-6">
      <Card title="Programa de fidelidade">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="sm:col-span-2 xl:col-span-4">
            <Checkbox label="Programa ativo (pedidos entregues geram pontos e cashback; clientes veem o programa no app)" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          </div>
          <Input label="Pontos por R$ 1 em produtos" type="number" step="0.1" min={0} max={100} value={form.pointsPerReal} onChange={(e) => set('pointsPerReal', num(e.target.value))} />
          <Input
            label="Valor de 1 ponto no resgate (centavos)"
            type="number"
            step="0.01"
            min={0.01}
            max={100}
            value={form.pointValueCents}
            onChange={(e) => set('pointValueCents', num(e.target.value))}
            hint={`1.000 pontos = ${formatBRL(Math.floor(1000 * form.pointValueCents))}`}
          />
          <Input label="Resgate mínimo (pontos)" type="number" min={1} value={form.minRedeemPoints} onChange={(e) => set('minRedeemPoints', num(e.target.value))} />
          <Input label="Expirar saldo após (dias sem pontuar)" type="number" min={0} max={3650} value={form.expireAfterInactiveDays} onChange={(e) => set('expireAfterInactiveDays', num(e.target.value))} hint="0 = não expira" />
        </div>
      </Card>

      <Card
        title="Níveis"
        actions={
          <Button type="button" size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} disabled={form.tiers.length >= 8} onClick={() => set('tiers', [...form.tiers, { key: `nivel-${form.tiers.length + 1}`, name: 'Novo nível', minPoints: 10_000, multiplierBps: 10_000, cashbackBps: 0 }])}>
            Adicionar nível
          </Button>
        }
      >
        <div className="space-y-3">
          {form.tiers.map((tier, index) => (
            <div key={index} className="grid items-end gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]">
              <Input label="Chave" value={tier.key} pattern="[a-z0-9-]{2,20}" onChange={(e) => setTier(index, { key: e.target.value.toLowerCase() })} />
              <Input label="Nome" value={tier.name} onChange={(e) => setTier(index, { name: e.target.value })} />
              <Input label="Pontos/ano para chegar" type="number" min={0} value={tier.minPoints} onChange={(e) => setTier(index, { minPoints: num(e.target.value) })} />
              <Input label="Multiplicador (x)" type="number" step="0.05" min={0} value={tier.multiplierBps / 10_000} onChange={(e) => setTier(index, { multiplierBps: Math.round(num(e.target.value) * 10_000) })} />
              <Input label="Cashback (%)" type="number" step="0.1" min={0} max={50} value={tier.cashbackBps / 100} onChange={(e) => setTier(index, { cashbackBps: Math.round(num(e.target.value) * 100) })} />
              <Button type="button" variant="ghost" aria-label={`Remover ${tier.name}`} disabled={form.tiers.length <= 1} onClick={() => set('tiers', form.tiers.filter((_, i) => i !== index))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          O nível vem dos pontos ganhos nos últimos 12 meses: sobe na hora e é revisto todo dia. Um nível precisa começar em 0 ponto. Cashback é custo da plataforma e entra na carteira do cliente.
        </p>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" loading={busy}>
          Salvar fidelidade
        </Button>
      </div>
    </form>
  );
}

function ProgramCard({
  title,
  rules,
  onChange,
  goal,
}: {
  title: string;
  rules: ProgramRules;
  onChange: (patch: Partial<ProgramRules>) => void;
  goal: React.ReactNode;
}) {
  return (
    <Card title={title}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Checkbox label="Programa ativo" checked={rules.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
        </div>
        <MoneyInput label="Recompensa de quem indica" value={rules.referrerRewardCents} onChange={(cents) => onChange({ referrerRewardCents: cents ?? 0 })} />
        <MoneyInput label="Bônus de quem é indicado" value={rules.referredRewardCents} onChange={(cents) => onChange({ referredRewardCents: cents ?? 0 })} />
        {goal}
      </div>
    </Card>
  );
}

/** Regras do Indique e ganhe: recompensas, metas e limites por programa. */
export function ReferralSettingsForm({ onSaved }: { onSaved?: () => void }) {
  const toast = useToast();
  const { form, setForm, error, isLoading, refetch } = useSetting<ReferralSettings>('referral');
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !form) return <Skeleton className="h-80" />;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.put('admin/settings/referral', { value: form });
      toast.success('Regras de indicação salvas.');
      await refetch();
      onSaved?.();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-6">
      <Card title="Indique e ganhe">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="sm:col-span-2 xl:col-span-3">
            <Checkbox label="Programa ativo (códigos no cadastro dos apps e do portal)" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          </div>
          <Input label="Prazo para cumprir a meta (dias)" type="number" min={1} max={365} value={form.windowDays} onChange={(e) => setForm({ ...form, windowDays: num(e.target.value) })} />
          <Input label="Indicações por pessoa em 30 dias" type="number" min={1} max={1000} value={form.maxPerReferrerPerMonth} onChange={(e) => setForm({ ...form, maxPerReferrerPerMonth: num(e.target.value) })} hint="Acima disso, a indicação fica retida para revisão." />
        </div>
        <p className="mt-3 text-xs text-muted">
          Antifraude: se quem indica e quem é indicado usarem o mesmo aparelho, a recompensa fica retida e um sinal de risco é aberto. A equipe decide em Indicações.
        </p>
      </Card>
      <div className="grid gap-6 xl:grid-cols-3">
        <ProgramCard
          title="Clientes"
          rules={form.customer}
          onChange={(patch) => setForm({ ...form, customer: { ...form.customer, ...patch } })}
          goal={<MoneyInput label="Meta: 1º pedido entregue a partir de" value={form.customer.minOrderCents} onChange={(cents) => setForm({ ...form, customer: { ...form.customer, minOrderCents: cents ?? 0 } })} />}
        />
        <ProgramCard
          title="Entregadores"
          rules={form.driver}
          onChange={(patch) => setForm({ ...form, driver: { ...form.driver, ...patch } })}
          goal={<Input label="Meta: entregas concluídas" type="number" min={1} max={1000} value={form.driver.deliveriesRequired} onChange={(e) => setForm({ ...form, driver: { ...form.driver, deliveriesRequired: num(e.target.value) } })} />}
        />
        <ProgramCard
          title="Empresas"
          rules={form.company}
          onChange={(patch) => setForm({ ...form, company: { ...form.company, ...patch } })}
          goal={<Input label="Meta: pedidos entregues" type="number" min={1} max={10000} value={form.company.ordersRequired} onChange={(e) => setForm({ ...form, company: { ...form.company, ordersRequired: num(e.target.value) } })} />}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={busy}>
          Salvar indicação
        </Button>
      </div>
    </form>
  );
}
