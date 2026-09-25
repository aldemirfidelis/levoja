'use client';

import { FormEvent, Suspense, useState } from 'react';
import { Gift, Trophy } from 'lucide-react';
import {
  formatBRL,
  LOYALTY_TRANSACTION_LABELS,
  REFERRAL_PROGRAM_LABELS,
  REFERRAL_STATUS_LABELS,
  type LoyaltyTransactionType,
  type ReferralProgram,
  type ReferralStatus,
} from '@levoja/shared';
import { api, Paginated, useApi } from '@levoja/web-kit/client';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  errorMessage,
  ErrorState,
  formatDateTime,
  Input,
  PageHeader,
  Pagination,
  Select,
  SkeletonRows,
  StatCard,
  Tabs,
  useToast,
  type Tone,
} from '@levoja/web-kit/ui';
import { SearchInput, useUrlFilters } from '@/components/list-filters';
import { LoyaltySettingsForm, ReferralSettingsForm, type Tier } from '@/components/growth-settings';
import { useSession } from '@/lib/session';

interface LoyaltyOverview {
  enabled: boolean;
  tiers: (Tier & { customers: number })[];
  outstandingPoints: number;
  liabilityCents: number;
  last30Days: { earnedPoints: number; redeemedPoints: number; expiredPoints: number; cashbackCents: number };
}

interface LoyaltyAccount {
  customerId: string;
  name: string;
  email: string | null;
  points: number;
  lifetimePoints: number;
  tier: string;
  lastEarnedAt: string | null;
}

interface LoyaltyEntry {
  id: string;
  type: LoyaltyTransactionType;
  points: number;
  description: string;
  createdAt: string;
}

interface ReferralsOverview {
  enabled: boolean;
  programs: { program: ReferralProgram; enabled: boolean; goal: string; counts: Partial<Record<ReferralStatus, number>> }[];
  paidCents: number;
}

interface ReferralRow {
  id: string;
  program: ReferralProgram;
  status: ReferralStatus;
  reason: string | null;
  expiresAt: string;
  rewardedAt: string | null;
  createdAt: string;
  referrerRewardCents: number;
  referredRewardCents: number;
  referrer: { id: string; name: string; email: string } | null;
  referred: { id: string; name: string; email: string } | null;
}

const STATUS_TONE: Record<ReferralStatus, Tone> = { PENDING: 'warning', REWARDED: 'success', REJECTED: 'danger', EXPIRED: 'neutral' };
const n = (value: number) => value.toLocaleString('pt-BR');

function AdjustDialog({ account, onClose, onDone }: { account: LoyaltyAccount; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const history = useApi<Paginated<LoyaltyEntry>>(`admin/growth/loyalty/accounts/${account.customerId}/transactions`, { pageSize: 10 });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`admin/growth/loyalty/accounts/${account.customerId}/adjust`, { points: Number(points), reason });
      toast.success('Pontos ajustados e cliente notificado.');
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} size="lg" title={`Pontos de ${account.name}`} description={`Saldo: ${n(account.points)} pontos · total acumulado: ${n(account.lifetimePoints)}`}>
      <div className="space-y-5">
        <div>
          <h3 className="mb-2 text-sm font-semibold">Últimos movimentos</h3>
          {history.isLoading ? (
            <SkeletonRows rows={3} />
          ) : !history.data?.data.length ? (
            <p className="text-sm text-muted">Sem movimentos.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {history.data.data.map((entry) => (
                <li key={entry.id} className="flex justify-between gap-3 py-2">
                  <span>
                    {entry.description}
                    <span className="block text-xs text-muted">
                      {LOYALTY_TRANSACTION_LABELS[entry.type]} · {formatDateTime(entry.createdAt)}
                    </span>
                  </span>
                  <span className={entry.points < 0 ? 'font-semibold text-danger' : 'font-semibold text-success'}>
                    {entry.points > 0 ? '+' : ''}
                    {n(entry.points)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-[160px_1fr]">
          <Input label="Pontos (+/−)" type="number" required value={points} onChange={(e) => setPoints(e.target.value)} hint="Negativo debita." />
          <Input label="Motivo (aparece para o cliente)" required minLength={5} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          {error && (
            <p className="text-sm text-danger sm:col-span-2" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Fechar
            </Button>
            <Button type="submit" loading={busy} disabled={!Number(points) || reason.trim().length < 5}>
              Ajustar pontos
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}

function LoyaltyTab() {
  const toast = useToast();
  const [filters, setFilters] = useUrlFilters({ search: '', tier: '', page: '1' });
  const overview = useApi<LoyaltyOverview>('admin/growth/loyalty');
  const accounts = useApi<Paginated<LoyaltyAccount>>('admin/growth/loyalty/accounts', { search: filters.search, tier: filters.tier, page: filters.page, pageSize: 25 });
  const [adjusting, setAdjusting] = useState<LoyaltyAccount | null>(null);
  const [running, setRunning] = useState(false);

  if (overview.error) return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />;
  if (overview.isLoading || !overview.data) return <SkeletonRows />;
  const data = overview.data;
  const tierName = (key: string) => data.tiers.find((tier) => tier.key === key)?.name ?? key;

  const run = async () => {
    setRunning(true);
    try {
      const result = await api.post<{ expired: number; retiered: number }>('admin/growth/loyalty/run');
      toast.success(`${result.expired} saldo(s) expirado(s) e ${result.retiered} nível(is) revisto(s).`);
      await Promise.all([overview.refetch(), accounts.refetch()]);
    } catch (err) {
      toast.error(err);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {!data.enabled && <p className="rounded-lg bg-warning/10 px-4 py-3 text-sm text-fg">O programa está desligado: nenhum ponto é gerado. Ative na aba Regras.</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Pontos em circulação" value={n(data.outstandingPoints)} hint={`Passivo: ${formatBRL(data.liabilityCents)}`} />
        <StatCard label="Ganhos em 30 dias" value={n(data.last30Days.earnedPoints)} tone="success" />
        <StatCard label="Resgatados em 30 dias" value={n(data.last30Days.redeemedPoints)} hint={`Expirados: ${n(data.last30Days.expiredPoints)}`} />
        <StatCard label="Cashback pago em 30 dias" value={formatBRL(data.last30Days.cashbackCents)} tone="warning" />
      </div>
      <Card
        title="Clientes por nível"
        actions={
          <Button size="sm" variant="secondary" loading={running} onClick={run}>
            Rodar expiração e revisão agora
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {data.tiers.map((tier) => (
            <div key={tier.key} className="rounded-lg border border-border p-4">
              <p className="flex items-center gap-2 font-semibold">
                <Trophy className="h-4 w-4 text-warning" aria-hidden /> {tier.name}
              </p>
              <p className="text-2xl font-extrabold">{n(tier.customers)}</p>
              <p className="text-xs text-muted">
                a partir de {n(tier.minPoints)} pts/ano · {tier.multiplierBps / 10_000}x pontos{tier.cashbackBps ? ` · ${tier.cashbackBps / 100}% cashback` : ''}
              </p>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Contas">
        <div className="mb-4 flex flex-wrap gap-3">
          <SearchInput value={filters.search} onChange={(search) => setFilters({ search, page: '1' })} placeholder="Nome ou e-mail do cliente" />
          <Select aria-label="Nível" className="w-48" value={filters.tier} placeholder="Todos os níveis" options={data.tiers.map((tier) => ({ value: tier.key, label: tier.name }))} onChange={(e) => setFilters({ tier: e.target.value, page: '1' })} />
        </div>
        {accounts.isLoading && <SkeletonRows />}
        {accounts.error && <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} />}
        {accounts.data?.data.length === 0 && <EmptyState icon={<Trophy className="h-8 w-8" />} title="Nenhuma conta encontrada" description="As contas surgem no primeiro pedido entregue com o programa ativo." />}
        {!!accounts.data?.data.length && (
          <>
            <DataTable
              rows={accounts.data.data}
              rowKey={(row) => row.customerId}
              onRowClick={setAdjusting}
              columns={[
                {
                  key: 'name',
                  header: 'Cliente',
                  cell: (row) => (
                    <span>
                      <span className="font-medium">{row.name}</span>
                      <span className="block text-xs text-muted">{row.email}</span>
                    </span>
                  ),
                },
                { key: 'tier', header: 'Nível', cell: (row) => <Badge tone="brand">{tierName(row.tier)}</Badge> },
                { key: 'points', header: 'Saldo', cell: (row) => n(row.points) },
                { key: 'lifetime', header: 'Acumulado', cell: (row) => n(row.lifetimePoints) },
                { key: 'last', header: 'Último ganho', cell: (row) => formatDateTime(row.lastEarnedAt) },
              ]}
            />
            <Pagination page={accounts.data.meta.page} totalPages={accounts.data.meta.totalPages} total={accounts.data.meta.total} onChange={(page) => setFilters({ page: String(page) })} />
          </>
        )}
      </Card>
      {adjusting && <AdjustDialog account={adjusting} onClose={() => setAdjusting(null)} onDone={() => void Promise.all([overview.refetch(), accounts.refetch()])} />}
    </div>
  );
}

function ReferralsTab() {
  const toast = useToast();
  const [filters, setFilters] = useUrlFilters({ status: '', program: '', page: '1' });
  const overview = useApi<ReferralsOverview>('admin/growth/referrals');
  const list = useApi<Paginated<ReferralRow>>('admin/growth/referrals/list', { status: filters.status, program: filters.program, page: filters.page, pageSize: 25 });
  const [action, setAction] = useState<{ row: ReferralRow; kind: 'approve' | 'reject' } | null>(null);

  if (overview.error) return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />;
  if (overview.isLoading || !overview.data) return <SkeletonRows />;
  const data = overview.data;

  return (
    <div className="space-y-6">
      {!data.enabled && <p className="rounded-lg bg-warning/10 px-4 py-3 text-sm text-fg">O Indique e ganhe está desligado: códigos informados no cadastro são ignorados. Ative na aba Regras.</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.programs.map((program) => (
          <StatCard
            key={program.program}
            label={`${REFERRAL_PROGRAM_LABELS[program.program]}${program.enabled ? '' : ' (pausado)'}`}
            value={n(Object.values(program.counts).reduce((sum, count) => sum + (count ?? 0), 0))}
            hint={`${n(program.counts.REWARDED ?? 0)} pagas · ${n(program.counts.PENDING ?? 0)} aguardando · ${n(program.counts.REJECTED ?? 0)} retidas/recusadas`}
          />
        ))}
        <StatCard label="Total pago em recompensas" value={formatBRL(data.paidCents)} tone="success" />
      </div>
      <Card title="Indicações">
        <div className="mb-4 flex flex-wrap gap-3">
          <Select
            aria-label="Situação"
            className="w-52"
            value={filters.status}
            placeholder="Todas as situações"
            options={(Object.keys(REFERRAL_STATUS_LABELS) as ReferralStatus[]).map((status) => ({ value: status, label: REFERRAL_STATUS_LABELS[status] }))}
            onChange={(e) => setFilters({ status: e.target.value, page: '1' })}
          />
          <Select
            aria-label="Programa"
            className="w-48"
            value={filters.program}
            placeholder="Todos os programas"
            options={(Object.keys(REFERRAL_PROGRAM_LABELS) as ReferralProgram[]).map((program) => ({ value: program, label: REFERRAL_PROGRAM_LABELS[program] }))}
            onChange={(e) => setFilters({ program: e.target.value, page: '1' })}
          />
        </div>
        {list.isLoading && <SkeletonRows />}
        {list.error && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {list.data?.data.length === 0 && <EmptyState icon={<Gift className="h-8 w-8" />} title="Nenhuma indicação encontrada" />}
        {!!list.data?.data.length && (
          <>
            <DataTable
              rows={list.data.data}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: 'referrer',
                  header: 'Quem indicou',
                  cell: (row) => (
                    <span>
                      <span className="font-medium">{row.referrer?.name ?? '—'}</span>
                      <span className="block text-xs text-muted">{row.referrer?.email}</span>
                    </span>
                  ),
                },
                {
                  key: 'referred',
                  header: 'Indicado',
                  cell: (row) => (
                    <span>
                      <span className="font-medium">{row.referred?.name ?? '—'}</span>
                      <span className="block text-xs text-muted">
                        {REFERRAL_PROGRAM_LABELS[row.program]} · {formatDateTime(row.createdAt)}
                      </span>
                    </span>
                  ),
                },
                {
                  key: 'status',
                  header: 'Situação',
                  cell: (row) => (
                    <span>
                      <Badge tone={STATUS_TONE[row.status]}>{REFERRAL_STATUS_LABELS[row.status]}</Badge>
                      {row.reason && <span className="mt-1 block max-w-xs text-xs text-muted">{row.reason}</span>}
                    </span>
                  ),
                },
                { key: 'reward', header: 'Recompensas', cell: (row) => `${formatBRL(row.referrerRewardCents)} + ${formatBRL(row.referredRewardCents)}` },
                {
                  key: 'actions',
                  header: '',
                  cell: (row) =>
                    row.status === 'PENDING' || row.status === 'REJECTED' ? (
                      <span className="flex gap-1">
                        <Button size="sm" variant="secondary" onClick={() => setAction({ row, kind: 'approve' })}>
                          Liberar
                        </Button>
                        {row.status === 'PENDING' && (
                          <Button size="sm" variant="ghost" onClick={() => setAction({ row, kind: 'reject' })}>
                            Recusar
                          </Button>
                        )}
                      </span>
                    ) : null,
                },
              ]}
            />
            <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onChange={(page) => setFilters({ page: String(page) })} />
          </>
        )}
      </Card>
      {action && (
        <ConfirmDialog
          open
          onClose={() => setAction(null)}
          title={action.kind === 'approve' ? 'Liberar a recompensa?' : 'Recusar a indicação?'}
          description={
            action.kind === 'approve'
              ? `${formatBRL(action.row.referrerRewardCents)} para ${action.row.referrer?.name ?? 'quem indicou'} e ${formatBRL(action.row.referredRewardCents)} para ${action.row.referred?.name ?? 'o indicado'}, direto nas carteiras. A decisão fica na auditoria.`
              : 'A indicação é encerrada sem recompensa. A decisão fica na auditoria.'
          }
          confirmLabel={action.kind === 'approve' ? 'Liberar' : 'Recusar'}
          tone={action.kind === 'approve' ? 'success' : 'danger'}
          reason={{ label: action.kind === 'approve' ? 'Observação da análise' : 'Motivo', required: true }}
          onConfirm={async (text) => {
            if (action.kind === 'approve') await api.post(`admin/growth/referrals/${action.row.id}/approve`, { note: text });
            else await api.post(`admin/growth/referrals/${action.row.id}/reject`, { reason: text });
            toast.success(action.kind === 'approve' ? 'Recompensa liberada.' : 'Indicação recusada.');
            await Promise.all([list.refetch(), overview.refetch()]);
          }}
        />
      )}
    </div>
  );
}

type Tab = 'fidelidade' | 'indicacoes' | 'regras';

function GrowthPage() {
  const { can } = useSession();
  const [filters, setFilters] = useUrlFilters({ aba: 'fidelidade' });
  const tab = filters.aba as Tab;
  return (
    <>
      <PageHeader title="Fidelidade e indicação" description="Pontos, níveis e cashback dos clientes; Indique e ganhe para clientes, entregadores e empresas, com antifraude e revisão da equipe." />
      <Tabs
        value={tab}
        onChange={(aba) => setFilters({ aba })}
        items={[
          { value: 'fidelidade', label: 'Fidelidade' },
          { value: 'indicacoes', label: 'Indicações' },
          ...(can('settings.manage') ? [{ value: 'regras' as const, label: 'Regras' }] : []),
        ]}
      />
      {tab === 'fidelidade' && <LoyaltyTab />}
      {tab === 'indicacoes' && <ReferralsTab />}
      {tab === 'regras' && can('settings.manage') && (
        <div className="space-y-10">
          <LoyaltySettingsForm />
          <ReferralSettingsForm />
        </div>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <GrowthPage />
    </Suspense>
  );
}
