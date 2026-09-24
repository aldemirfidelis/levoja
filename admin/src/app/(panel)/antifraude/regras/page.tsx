'use client';

import { FormEvent, useEffect, useState } from 'react';
import { RISK_LEVEL_LABELS, RISK_SIGNAL_LABELS, RISK_SIGNAL_TYPES, formatBRL, type RiskSignalType } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { Button, Card, Checkbox, ErrorState, Input, MoneyInput, PageHeader, Select, Skeleton, useToast } from '@levoja/web-kit/ui';
import { FraudNav } from '@/components/intelligence-nav';
import { useSession } from '@/lib/session';

interface FraudSettings {
  enabled: boolean;
  halfLifeDays: number;
  mediumScore: number;
  highScore: number;
  caseScore: number;
  points: Record<RiskSignalType, number>;
  maxAccountsPerDevice: number;
  newAccountDays: number;
  newAccountHighValueCents: number;
  maxOrdersPerHour: number;
  paymentFailuresPerDay: number;
  maxCardsPerDay: number;
  maxSpeedKmh: number;
  cancellationZ: number;
  cancellationMinTotal: number;
  denyCashAtLevel: 'OFF' | 'MEDIUM' | 'HIGH';
  denyCashAboveCents: number;
  blockSharedFirstOrderCoupon: boolean;
  rejectMockedProof: boolean;
}

interface PlatformSetting {
  key: string;
  value: unknown;
  isDefault: boolean;
  updatedAt: string | null;
}

export default function FraudRulesPage() {
  const { can } = useSession();
  const toast = useToast();
  const editable = can('settings.manage');
  const { data, error, isLoading, refetch } = useApi<PlatformSetting[]>('admin/settings', undefined, { enabled: editable });
  const [form, setForm] = useState<FraudSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const stored = data?.find((setting) => setting.key === 'fraud');
    if (stored) setForm(stored.value as FraudSettings);
  }, [data]);

  if (!editable) {
    return (
      <>
        <PageHeader title="Antifraude" description="Regras do score de risco." />
        <FraudNav />
        <p className="text-sm text-muted">As regras do antifraude são editadas por quem gerencia as configurações da plataforma.</p>
      </>
    );
  }
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !form) return <Skeleton className="h-96" />;

  const set = <K extends keyof FraudSettings>(key: K, value: FraudSettings[K]) => setForm({ ...form, [key]: value });
  const num = (key: keyof FraudSettings) => (event: { target: { value: string } }) => set(key, Number(event.target.value) as never);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.put('admin/settings/fraud', { value: form });
      toast.success('Regras do antifraude salvas.');
      await refetch();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Antifraude"
        description="Score de risco configurável: cada sinal soma pontos que perdem peso com o tempo. O score define o nível e abre casos para a equipe; as ações automáticas são leves e reversíveis."
      />
      <FraudNav />
      <form onSubmit={save} className="space-y-6">
        <Card title="Score e níveis">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="sm:col-span-2 xl:col-span-4">
              <Checkbox label="Antifraude ativo (registrar sinais, calcular score e aplicar as ações abaixo)" checked={form.enabled} onChange={(event) => set('enabled', event.target.checked)} />
            </div>
            <Input label="Meia-vida do score (dias)" type="number" min={1} max={365} value={form.halfLifeDays} onChange={num('halfLifeDays')} hint="Após este prazo, um sinal vale metade." />
            <Input label="Risco médio a partir de" type="number" min={1} max={100} value={form.mediumScore} onChange={num('mediumScore')} />
            <Input label="Risco alto a partir de" type="number" min={1} max={100} value={form.highScore} onChange={num('highScore')} />
            <Input label="Abrir caso a partir de" type="number" min={1} max={100} value={form.caseScore} onChange={num('caseScore')} hint="Casos vão para revisão humana." />
          </div>
        </Card>

        <Card title="Pontos por sinal">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {RISK_SIGNAL_TYPES.filter((type) => type !== 'MANUAL').map((type) => (
              <Input
                key={type}
                label={RISK_SIGNAL_LABELS[type]}
                type="number"
                min={0}
                max={100}
                value={form.points[type]}
                onChange={(event) => set('points', { ...form.points, [type]: Number(event.target.value) })}
              />
            ))}
          </div>
        </Card>

        <Card title="Gatilhos">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Input label="Contas por aparelho (acima disso gera sinal)" type="number" min={1} max={20} value={form.maxAccountsPerDevice} onChange={num('maxAccountsPerDevice')} />
            <Input label="Conta nova até (dias)" type="number" min={0} max={90} value={form.newAccountDays} onChange={num('newAccountDays')} />
            <MoneyInput label="Pedido de valor alto em conta nova" value={form.newAccountHighValueCents} onChange={(cents) => set('newAccountHighValueCents', cents ?? 0)} />
            <Input label="Pedidos por hora (limite)" type="number" min={1} max={100} value={form.maxOrdersPerHour} onChange={num('maxOrdersPerHour')} />
            <Input label="Pagamentos recusados em 24 h" type="number" min={1} max={50} value={form.paymentFailuresPerDay} onChange={num('paymentFailuresPerDay')} />
            <Input label="Cartões diferentes em 24 h (limite)" type="number" min={1} max={20} value={form.maxCardsPerDay} onChange={num('maxCardsPerDay')} />
            <Input label="Velocidade máxima plausível no GPS (km/h)" type="number" min={50} max={1000} value={form.maxSpeedKmh} onChange={num('maxSpeedKmh')} />
            <Input label="Cancelamentos: desvio mínimo (z)" type="number" step="0.1" min={1} max={10} value={form.cancellationZ} onChange={num('cancellationZ')} hint="Quanto maior, mais extremo precisa ser." />
            <Input label="Cancelamentos: volume mínimo (30 dias)" type="number" min={3} max={1000} value={form.cancellationMinTotal} onChange={num('cancellationMinTotal')} />
          </div>
        </Card>

        <Card title="Ações automáticas (reversíveis)">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Exigir pagamento online a partir do nível"
              value={form.denyCashAtLevel}
              onChange={(event) => set('denyCashAtLevel', event.target.value as FraudSettings['denyCashAtLevel'])}
              options={[{ value: 'OFF', label: 'Nunca' }, ...(['MEDIUM', 'HIGH'] as const).map((level) => ({ value: level, label: `Risco ${RISK_LEVEL_LABELS[level].toLowerCase()}` }))]}
            />
            <MoneyInput
              label="…para pedidos acima de"
              value={form.denyCashAboveCents}
              onChange={(cents) => set('denyCashAboveCents', cents ?? 0)}
              hint={`Pedidos até ${formatBRL(form.denyCashAboveCents)} seguem aceitando dinheiro.`}
            />
            <Checkbox
              label="Recusar cupom de primeira compra já usado no mesmo aparelho ou endereço"
              checked={form.blockSharedFirstOrderCoupon}
              onChange={(event) => set('blockSharedFirstOrderCoupon', event.target.checked)}
            />
            <Checkbox label="Recusar conclusão de entrega com GPS simulado" checked={form.rejectMockedProof} onChange={(event) => set('rejectMockedProof', event.target.checked)} />
          </div>
          <p className="mt-3 text-xs text-muted">Contas liberadas pela equipe ao descartar um caso ficam isentas destas ações pelo período escolhido.</p>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" loading={busy}>
            Salvar regras
          </Button>
        </div>
      </form>
    </>
  );
}
