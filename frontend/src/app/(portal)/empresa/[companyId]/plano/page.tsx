'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check } from 'lucide-react';
import {
  formatBRL,
  PLAN_FEATURE_LABELS,
  PLAN_LIMIT_LABELS,
  SUBSCRIPTION_INVOICE_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  type PlanFeature,
  type PlanLimitKey,
  type SubscriptionInvoiceStatus,
  type SubscriptionStatus,
} from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { Badge, Button, Card, ConfirmDialog, ErrorState, formatDate, PageHeader, Skeleton, useToast } from '@levoja/web-kit/ui';
import { useCompany } from '@/lib/company';

interface PlanCard {
  id: string;
  key: string;
  name: string;
  description: string | null;
  priceCents: number;
  priceLabel: string;
  features: PlanFeature[];
  limits: Record<PlanLimitKey, number | null>;
  trialDays: number;
}

interface SubscriptionView {
  enabled: boolean;
  effective: { plan: { key: string; name: string } | null; status: SubscriptionStatus | null; restricted: boolean; features: PlanFeature[]; limits: Record<PlanLimitKey, number | null> };
  usage: Record<Exclude<PlanLimitKey, 'apiRequestsPerMinute'>, number>;
  walletAvailableCents: number;
  subscription: {
    status: SubscriptionStatus;
    plan: { key: string; name: string };
    priceCents: number;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    trialEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    scheduledPlan: { key: string; name: string } | null;
    pastDueSince: string | null;
  } | null;
  invoices: { id: string; number: number; description: string; amountCents: number; status: SubscriptionInvoiceStatus; createdAt: string; paidAt: string | null }[];
  plans: PlanCard[];
}

const STATUS_TONE = { TRIALING: 'info', ACTIVE: 'success', PAST_DUE: 'danger', CANCELED: 'neutral' } as const;
const INVOICE_TONE = { OPEN: 'warning', PAID: 'success', VOID: 'neutral' } as const;

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const ratio = limit ? Math.min(1, used / limit) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-sm">
        <span className="text-fg">{label}</span>
        <span className="tabular-nums text-muted">
          {used.toLocaleString('pt-BR')} / {limit == null ? 'sem limite' : limit.toLocaleString('pt-BR')}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${limit == null ? 0 : Math.max(2, ratio * 100)}%`, background: ratio >= 1 ? 'var(--lj-danger)' : 'var(--lj-chart-1)' }} />
      </div>
    </div>
  );
}

export default function CompanyPlanPage() {
  const { company, can } = useCompany();
  const toast = useToast();
  const manage = can('company.subscription.manage');
  const { data, error, isLoading, refetch } = useApi<SubscriptionView>(`companies/${company.id}/subscription`);
  const [choosing, setChoosing] = useState<PlanCard | null>(null);
  const [canceling, setCanceling] = useState(false);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-96" />;
  const subscription = data.subscription;
  const currentKey = subscription && subscription.status !== 'CANCELED' ? subscription.plan.key : data.effective.plan?.key;
  const currentPrice = subscription && subscription.status !== 'CANCELED' ? subscription.priceCents : 0;

  const choose = async () => {
    if (!choosing) return;
    try {
      const result = await api.post<SubscriptionView>(`companies/${company.id}/subscription`, { planKey: choosing.key });
      const next = result.subscription;
      toast.success(
        next?.scheduledPlan
          ? `Troca para ${next.scheduledPlan.name} agendada para ${formatDate(next.currentPeriodEnd)}.`
          : next?.status === 'TRIALING'
            ? `Plano ${choosing.name} ativo — teste grátis até ${formatDate(next.trialEndsAt)}.`
            : `Plano ${choosing.name} ativo.`,
      );
      setChoosing(null);
      await refetch();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <PageHeader
        title="Plano"
        description={
          data.enabled
            ? 'Recursos e limites da sua empresa. A mensalidade é descontada do saldo da carteira; se o saldo ficar negativo, quite pelo Financeiro.'
            : 'A plataforma ainda não cobra planos: sua empresa tem todos os recursos liberados.'
        }
      />
      {data.effective.restricted && (
        <div className="mb-6 flex gap-3 rounded-lg border border-danger/40 bg-danger/5 p-4 text-sm" role="alert">
          <AlertTriangle className="h-5 w-5 shrink-0 text-danger" aria-hidden />
          <div>
            <p className="font-medium text-fg">Assinatura em atraso: recursos limitados aos do plano básico.</p>
            <p className="text-muted">
              Quite o saldo devedor em{' '}
              <Link href={`/empresa/${company.id}/financeiro`} className="text-brand-600 hover:underline">
                Financeiro
              </Link>{' '}
              para voltar a usar todos os recursos do seu plano.
            </p>
          </div>
        </div>
      )}
      {data.enabled && (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <Card title="Assinatura">
            {subscription && subscription.status !== 'CANCELED' ? (
              <div className="space-y-2 text-sm">
                <p className="flex flex-wrap items-center gap-2 text-lg font-semibold text-fg">
                  {subscription.plan.name}
                  <Badge tone={STATUS_TONE[subscription.status]}>{SUBSCRIPTION_STATUS_LABELS[subscription.status]}</Badge>
                </p>
                <p className="text-muted">
                  {subscription.priceCents ? `${formatBRL(subscription.priceCents)}/mês` : 'Grátis'} · período até {formatDate(subscription.currentPeriodEnd)}
                  {subscription.status === 'TRIALING' && subscription.trialEndsAt ? ` · teste grátis até ${formatDate(subscription.trialEndsAt)}` : ''}
                </p>
                {subscription.scheduledPlan && <p className="text-fg">Troca para {subscription.scheduledPlan.name} no fim do período.</p>}
                {subscription.cancelAtPeriodEnd && <p className="text-fg">Cancelamento agendado para o fim do período.</p>}
                {manage && (
                  <div className="flex gap-2 pt-2">
                    {subscription.cancelAtPeriodEnd ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          try {
                            await api.post(`companies/${company.id}/subscription/resume`);
                            toast.success('Cancelamento desfeito.');
                            await refetch();
                          } catch (err) {
                            toast.error(err);
                          }
                        }}
                      >
                        Manter assinatura
                      </Button>
                    ) : (
                      subscription.priceCents > 0 && (
                        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setCanceling(true)}>
                          Cancelar assinatura
                        </Button>
                      )
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">Sua empresa usa o plano {data.effective.plan?.name ?? 'padrão'}. Escolha um plano abaixo para liberar mais recursos.</p>
            )}
            <p className={`mt-3 text-sm ${data.walletAvailableCents < 0 ? 'text-danger' : 'text-muted'}`}>Saldo da carteira: {formatBRL(data.walletAvailableCents)}</p>
          </Card>
          <Card title="Uso dos limites">
            <div className="space-y-3">
              {(Object.keys(data.usage) as (keyof SubscriptionView['usage'])[]).map((key) => (
                <UsageBar key={key} label={PLAN_LIMIT_LABELS[key]} used={data.usage[key]} limit={data.effective.limits[key]} />
              ))}
              <p className="text-xs text-muted">Chamadas à API: {data.effective.limits.apiRequestsPerMinute == null ? 'sem limite' : `até ${data.effective.limits.apiRequestsPerMinute} por minuto`}.</p>
            </div>
          </Card>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.plans.map((plan) => {
          const current = plan.key === currentKey;
          return (
            <Card key={plan.id} className={current ? 'ring-2 ring-brand-500' : ''} title={<span className="flex items-center gap-2">{plan.name}{current && <Badge tone="brand">Atual</Badge>}</span>}>
              <p className="text-2xl font-semibold tabular-nums text-fg">{plan.priceLabel}</p>
              {plan.trialDays > 0 && plan.priceCents > 0 && <p className="text-xs text-muted">{plan.trialDays} dias grátis na primeira contratação</p>}
              {plan.description && <p className="mt-2 text-sm text-fg">{plan.description}</p>}
              <ul className="mt-3 space-y-1 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2 text-fg">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> {PLAN_FEATURE_LABELS[feature]}
                  </li>
                ))}
              </ul>
              {manage && data.enabled && !current && (
                <Button className="mt-4 w-full" variant={plan.priceCents > currentPrice ? 'primary' : 'secondary'} onClick={() => setChoosing(plan)}>
                  {plan.priceCents > currentPrice ? 'Contratar' : 'Mudar para este plano'}
                </Button>
              )}
            </Card>
          );
        })}
      </div>
      {data.invoices.length > 0 && (
        <Card title="Cobranças" className="mt-6">
          <ul className="divide-y divide-border text-sm">
            {data.invoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-fg">
                  #{invoice.number} · {invoice.description}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{formatBRL(invoice.amountCents)}</span>
                  <Badge tone={INVOICE_TONE[invoice.status]}>{SUBSCRIPTION_INVOICE_STATUS_LABELS[invoice.status]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <ConfirmDialog
        open={!!choosing}
        onClose={() => setChoosing(null)}
        title={`Mudar para o plano ${choosing?.name ?? ''}?`}
        description={
          choosing && choosing.priceCents > currentPrice
            ? currentPrice > 0
              ? 'O novo plano vale agora. A diferença proporcional até o fim do período é descontada da carteira.'
              : choosing.trialDays > 0
                ? `Você terá ${choosing.trialDays} dias grátis. Depois, ${choosing.priceLabel}, descontado da carteira.`
                : `A mensalidade de ${choosing.priceLabel} é descontada da carteira a partir de hoje.`
            : 'A troca vale a partir do próximo período (o atual já foi pago).'
        }
        confirmLabel="Confirmar"
        onConfirm={choose}
      />
      <ConfirmDialog
        open={canceling}
        onClose={() => setCanceling(false)}
        tone="danger"
        title="Cancelar a assinatura?"
        description="Os recursos continuam até o fim do período já pago; depois, sua empresa passa ao plano básico."
        confirmLabel="Cancelar assinatura"
        onConfirm={async () => {
          try {
            await api.post(`companies/${company.id}/subscription/cancel`);
            toast.success('Cancelamento agendado.');
            setCanceling(false);
            await refetch();
          } catch (err) {
            toast.error(err);
          }
        }}
      />
    </>
  );
}
