'use client';

import { FormEvent, Suspense, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { formatBRL, PLAN_LIMIT_LABELS, SUBSCRIPTION_INVOICE_STATUS_LABELS, SUBSCRIPTION_STATUS_LABELS, type SubscriptionInvoiceStatus, type SubscriptionStatus } from '@levoja/shared';
import { api, Paginated, useApi } from '@levoja/web-kit/client';
import { Badge, Button, Checkbox, DataTable, DescriptionList, Dialog, EmptyState, ErrorState, formatDate, PageHeader, Pagination, Select, SkeletonRows, StatCard, useToast } from '@levoja/web-kit/ui';
import { limitLabel, SaasNav, SUBSCRIPTION_INVOICE_TONE, SUBSCRIPTION_TONE } from '@/components/saas-nav';
import { SearchInput, useUrlFilters } from '@/components/list-filters';

interface SubscriptionRow {
  id: string;
  companyId: string;
  status: SubscriptionStatus;
  priceCents: number;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  openCents: number;
  plan: { key: string; name: string };
  company: { id: string; tradeName: string };
}

interface CompanyPlanView {
  enabled: boolean;
  effective: { plan: { key: string; name: string } | null; restricted: boolean; features: string[]; limits: Record<string, number | null> };
  usage: Record<string, number>;
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
  } | null;
  invoices: { id: string; number: number; description: string; amountCents: number; status: SubscriptionInvoiceStatus; createdAt: string }[];
  plans: { key: string; name: string; priceCents: number }[];
}

interface PlanOption {
  key: string;
  name: string;
  priceCents: number;
  isActive: boolean;
}

function CompanyPlanDialog({ companyId, name, onClose, onChanged }: { companyId: string; name: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { data, refetch } = useApi<CompanyPlanView>(`admin/saas/companies/${companyId}`);
  const plans = useApi<PlanOption[]>('admin/saas/plans');
  const [planKey, setPlanKey] = useState('');
  const [immediate, setImmediate] = useState(true);
  const [busy, setBusy] = useState(false);
  if (!data) return null;

  const choose = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post(`admin/saas/companies/${companyId}/plan`, { planKey, immediate });
      toast.success('Plano alterado.');
      await refetch();
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    try {
      await api.post(`admin/saas/companies/${companyId}/cancel`);
      toast.success('Cancelamento registrado.');
      await refetch();
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  };

  const subscription = data.subscription;
  return (
    <Dialog open onClose={onClose} size="lg" title={name} description={data.effective.plan ? `Plano em vigor: ${data.effective.plan.name}${data.effective.restricted ? ' (restrito por atraso)' : ''}` : 'Sem plano'}>
      <div className="space-y-5 text-sm">
        {subscription ? (
          <DescriptionList
            items={[
              { label: 'Assinatura', value: <Badge tone={SUBSCRIPTION_TONE[subscription.status]}>{SUBSCRIPTION_STATUS_LABELS[subscription.status]}</Badge> },
              { label: 'Plano', value: `${subscription.plan.name} · ${subscription.priceCents ? `${formatBRL(subscription.priceCents)}/mês` : 'grátis'}` },
              { label: 'Período', value: `${formatDate(subscription.currentPeriodStart)} a ${formatDate(subscription.currentPeriodEnd)}` },
              ...(subscription.trialEndsAt && subscription.status === 'TRIALING' ? [{ label: 'Teste grátis até', value: formatDate(subscription.trialEndsAt) }] : []),
              ...(subscription.scheduledPlan ? [{ label: 'Troca agendada', value: `Para ${subscription.scheduledPlan.name} no fim do período` }] : []),
              ...(subscription.cancelAtPeriodEnd ? [{ label: 'Cancelamento', value: 'No fim do período' }] : []),
              { label: 'Carteira da empresa', value: <span className={data.walletAvailableCents < 0 ? 'text-danger' : ''}>{formatBRL(data.walletAvailableCents)}</span> },
            ]}
          />
        ) : (
          <p className="text-muted">A empresa usa o plano padrão (sem assinatura).</p>
        )}
        <div>
          <p className="mb-1 font-medium text-fg">Uso</p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {Object.entries(data.usage).map(([key, value]) => (
              <li key={key} className="flex justify-between gap-2">
                <span className="text-muted">{PLAN_LIMIT_LABELS[key as keyof typeof PLAN_LIMIT_LABELS]}</span>
                <span className="tabular-nums">
                  {value} / {limitLabel(data.effective.limits[key])}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <form onSubmit={choose} className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
          <Select
            label="Trocar para"
            className="min-w-52"
            required
            value={planKey}
            placeholder="Escolha o plano"
            options={(plans.data ?? []).filter((plan) => plan.isActive).map((plan) => ({ value: plan.key, label: `${plan.name} (${plan.priceCents ? formatBRL(plan.priceCents) : 'grátis'})` }))}
            onChange={(event) => setPlanKey(event.target.value)}
          />
          <Checkbox label="Aplicar agora (também para plano menor)" checked={immediate} onChange={(event) => setImmediate(event.target.checked)} />
          <Button type="submit" loading={busy} disabled={!planKey}>
            Aplicar
          </Button>
          {subscription && subscription.status !== 'CANCELED' && !subscription.cancelAtPeriodEnd && (
            <Button type="button" variant="ghost" className="text-danger" onClick={() => void cancel()}>
              Cancelar assinatura
            </Button>
          )}
        </form>
        {data.invoices.length > 0 && (
          <div>
            <p className="mb-1 font-medium text-fg">Cobranças</p>
            <ul className="divide-y divide-border">
              {data.invoices.map((invoice) => (
                <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    #{invoice.number} · {invoice.description}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{formatBRL(invoice.amountCents)}</span>
                    <Badge tone={SUBSCRIPTION_INVOICE_TONE[invoice.status]}>{SUBSCRIPTION_INVOICE_STATUS_LABELS[invoice.status]}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function SubscriptionsView() {
  const [filters, setFilters] = useUrlFilters({ status: '', search: '', page: '1' });
  const { data, error, isLoading, refetch } = useApi<Paginated<SubscriptionRow> & { mrrCents: number; paying: number }>('admin/saas/subscriptions', { ...filters, pageSize: 25 });
  const [open, setOpen] = useState<SubscriptionRow | null>(null);

  return (
    <>
      <PageHeader title="Planos SaaS" description="Assinaturas das empresas: situação, período, próxima cobrança e valores em aberto." />
      <SaasNav />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Receita recorrente mensal (MRR)" value={formatBRL(data?.mrrCents ?? 0)} hint={`${data?.paying ?? 0} assinatura(s) ativa(s) ou em atraso`} />
      </div>
      <div className="mb-4 flex flex-wrap gap-3">
        <SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Empresa" />
        <Select
          aria-label="Situação"
          className="w-44"
          value={filters.status}
          onChange={(event) => setFilters({ status: event.target.value })}
          options={[{ value: '', label: 'Todas as situações' }, ...Object.entries(SUBSCRIPTION_STATUS_LABELS).map(([value, label]) => ({ value, label }))]}
        />
      </div>
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.data.length === 0 && <EmptyState icon={<CreditCard className="h-8 w-8" />} title="Nenhuma assinatura" description="Empresas sem assinatura usam o plano padrão." />}
      {data && data.data.length > 0 && (
        <>
          <DataTable
            rows={data.data}
            rowKey={(row) => row.id}
            onRowClick={(row) => setOpen(row)}
            columns={[
              { key: 'company', header: 'Empresa', cell: (row) => <span className="font-medium">{row.company.tradeName}</span> },
              { key: 'plan', header: 'Plano', cell: (row) => row.plan.name },
              { key: 'status', header: 'Situação', cell: (row) => <Badge tone={SUBSCRIPTION_TONE[row.status]}>{SUBSCRIPTION_STATUS_LABELS[row.status]}</Badge> },
              { key: 'price', header: 'Mensalidade', className: 'text-right tabular-nums', cell: (row) => (row.priceCents ? formatBRL(row.priceCents) : 'Grátis'), hideOnMobile: true },
              { key: 'open', header: 'Em aberto', className: 'text-right tabular-nums', cell: (row) => (row.openCents ? <span className="text-danger">{formatBRL(row.openCents)}</span> : '—'), hideOnMobile: true },
              { key: 'end', header: 'Próxima renovação', cell: (row) => (row.cancelAtPeriodEnd ? `Encerra em ${formatDate(row.currentPeriodEnd)}` : formatDate(row.currentPeriodEnd)), hideOnMobile: true },
            ]}
          />
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={(page) => setFilters({ page: String(page) })} />
        </>
      )}
      {open && <CompanyPlanDialog companyId={open.companyId} name={open.company.tradeName} onClose={() => setOpen(null)} onChanged={() => void refetch()} />}
    </>
  );
}

export default function SubscriptionsPage() {
  return (
    <Suspense>
      <SubscriptionsView />
    </Suspense>
  );
}
