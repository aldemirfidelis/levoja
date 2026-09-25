'use client';

import { use } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApi } from '@levoja/web-kit/client';
import { cn, ErrorState, PartnerStatusBadge, SkeletonRows } from '@levoja/web-kit/ui';
import { CompanyContext, CompanyView } from '@/lib/company';
import { usePortal } from '@/lib/portal-session';

const TABS: { path: string; label: string; permission: string | string[] | null; approvedOnly?: boolean }[] = [
  { path: '', label: 'Visão geral', permission: null },
  { path: '/assistente', label: 'Assistente', permission: 'company.reports.read', approvedOnly: true },
  { path: '/pedidos', label: 'Pedidos', permission: 'company.orders.read', approvedOnly: true },
  { path: '/entregas', label: 'Entregas', permission: 'company.orders.read', approvedOnly: true },
  { path: '/mensagens', label: 'Mensagens', permission: 'company.orders.read', approvedOnly: true },
  { path: '/corporativo', label: 'Corporativo', permission: ['company.deliveries.request', 'company.finance.read', 'company.b2b.manage'], approvedOnly: true },
  { path: '/catalogo', label: 'Catálogo', permission: 'company.products.read' },
  { path: '/cupons', label: 'Cupons', permission: 'company.products.read', approvedOnly: true },
  { path: '/entrega', label: 'Área de entrega', permission: 'company.profile.manage' },
  { path: '/dados', label: 'Dados', permission: 'company.profile.manage' },
  { path: '/endereco', label: 'Endereço e horários', permission: 'company.profile.manage' },
  { path: '/documentos', label: 'Documentos', permission: 'company.profile.manage' },
  { path: '/financeiro', label: 'Financeiro', permission: ['company.finance.read', 'company.profile.manage'] },
  { path: '/equipe', label: 'Equipe', permission: 'company.users.manage' },
  { path: '/integracoes', label: 'Integrações', permission: 'company.b2b.manage', approvedOnly: true },
  { path: '/marca', label: 'Marca própria', permission: 'company.profile.manage', approvedOnly: true },
  { path: '/plano', label: 'Plano', permission: 'company.profile.manage' },
  { path: '/suporte', label: 'Atendimento', permission: 'company.support.use' },
];

export default function CompanyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ companyId: string }> }) {
  const { companyId } = use(params);
  const pathname = usePathname();
  const { canInCompany } = usePortal();
  const { data, error, isLoading, refetch } = useApi<CompanyView>(`companies/${companyId}`);
  const base = `/empresa/${companyId}`;

  if (isLoading) return <SkeletonRows rows={6} />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  const can = (permission: string) => canInCompany(companyId, permission);
  const allowed = (permission: string | string[] | null) => !permission || (Array.isArray(permission) ? permission.some(can) : can(permission));
  const tabs = TABS.filter((tab) => allowed(tab.permission) && (!tab.approvedOnly || data.status === 'APPROVED'));

  return (
    <CompanyContext.Provider value={{ company: data, reload: () => void refetch(), can }}>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        {data.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.logoUrl} alt="" className="h-14 w-14 rounded-xl object-cover" />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-surface-2 text-xl font-bold text-muted">{data.tradeName[0]}</span>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold text-fg">{data.tradeName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <PartnerStatusBadge status={data.status} />
            <span>{data.segment.name}</span>
          </div>
        </div>
      </div>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border" aria-label="Seções da empresa">
        {tabs.map((tab) => {
          const href = `${base}${tab.path}`;
          const active = tab.path === '' ? pathname === base : pathname.startsWith(href);
          return (
            <Link
              key={tab.path}
              href={href}
              className={cn(
                '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
                active ? 'border-brand-500 text-brand-600' : 'border-transparent text-muted hover:text-fg',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </CompanyContext.Provider>
  );
}
