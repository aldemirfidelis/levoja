'use client';

import Link from 'next/link';
import { PARTNER_STATUS_LABELS, PartnerStatus } from '@levoja/shared';
import { useApi } from '@levoja/web-kit/client';
import { Card, ErrorState, formatDateTime, PageHeader, Skeleton, StatCard } from '@levoja/web-kit/ui';
import { useSession } from '@/lib/session';
import type { Dashboard } from '@/lib/types';

const ORDER: PartnerStatus[] = ['UNDER_REVIEW', 'PENDING_DOCUMENTS', 'DRAFT', 'APPROVED', 'SUSPENDED', 'REJECTED', 'BLOCKED'];

function StatusBreakdown({ byStatus, href }: { byStatus: Record<string, number>; href: string }) {
  const total = Object.values(byStatus).reduce((sum, value) => sum + value, 0);
  if (!total) return <p className="text-sm text-muted">Nenhum cadastro ainda.</p>;
  return (
    <ul className="space-y-2">
      {ORDER.filter((status) => byStatus[status]).map((status) => (
        <li key={status}>
          <Link href={`${href}?status=${status}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
            <span className="text-fg">{PARTNER_STATUS_LABELS[status]}</span>
            <span className="flex items-center gap-3">
              <span className="hidden h-2 w-24 overflow-hidden rounded-full bg-surface-2 sm:block">
                <span className="block h-full rounded-full bg-brand-500" style={{ width: `${(byStatus[status] / total) * 100}%` }} />
              </span>
              <span className="w-8 text-right font-semibold tabular-nums">{byStatus[status]}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function DashboardPage() {
  const { me, can } = useSession();
  const { data, error, isLoading, refetch } = useApi<Dashboard>('admin/dashboard');

  return (
    <>
      <PageHeader title={`Olá, ${me.user.name.split(' ')[0]}`} description="Visão geral da plataforma" />
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}
      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Usuários" value={data.users.total.toLocaleString('pt-BR')} hint={`+${data.users.newLast30Days} nos últimos 30 dias`} />
            <StatCard label="Clientes" value={data.users.customers.toLocaleString('pt-BR')} />
            <StatCard
              label="Empresas aguardando análise"
              value={data.companies.awaitingReview}
              tone={data.companies.awaitingReview ? 'warning' : 'neutral'}
              hint={`${data.pendingDocuments.companies} documento(s) pendente(s)`}
            />
            <StatCard
              label="Entregadores aguardando análise"
              value={data.drivers.awaitingReview}
              tone={data.drivers.awaitingReview ? 'warning' : 'neutral'}
              hint={`${data.pendingDocuments.drivers} documento(s) pendente(s)`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {can('companies.read') && (
              <Card title={`Empresas (${data.companies.total})`} actions={<Link href="/empresas" className="text-sm text-brand-600 hover:underline">Ver todas</Link>}>
                <StatusBreakdown byStatus={data.companies.byStatus} href="/empresas" />
              </Card>
            )}
            {can('drivers.read') && (
              <Card title={`Entregadores (${data.drivers.total})`} actions={<Link href="/entregadores" className="text-sm text-brand-600 hover:underline">Ver todos</Link>}>
                <StatusBreakdown byStatus={data.drivers.byStatus} href="/entregadores" />
              </Card>
            )}
          </div>

          {can('privacy.manage') && data.privacyRequestsOpen > 0 && (
            <Card>
              <p className="text-sm">
                <strong>{data.privacyRequestsOpen}</strong> solicitação(ões) de titulares (LGPD) aguardando atendimento.{' '}
                <Link href="/privacidade" className="text-brand-600 hover:underline">
                  Atender
                </Link>
              </p>
            </Card>
          )}

          {can('audit.read') && (
            <Card title="Atividade recente" actions={<Link href="/auditoria" className="text-sm text-brand-600 hover:underline">Auditoria completa</Link>}>
              {data.recentActivity.length === 0 ? (
                <p className="text-sm text-muted">Sem atividade registrada.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.recentActivity.map((entry) => (
                    <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span>
                        <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{entry.action}</code>{' '}
                        <span className="text-muted">por {entry.actor?.name ?? 'sistema'}</span>
                      </span>
                      <span className="text-xs text-muted">{formatDateTime(entry.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
