'use client';

import { use } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApi } from '@levoja/web-kit/client';
import { cn, ErrorState, PartnerStatusBadge, SkeletonRows } from '@levoja/web-kit/ui';
import { CompanyContext, CompanyView } from '@/lib/company';
import { OrderAlertsProvider, PendingOrdersBadge, PendingOrdersBanner } from '@/components/order-alerts';
import { OrderLabelAutoPrint } from '@/components/order-labels';
import { usePortal } from '@/lib/portal-session';

/** Páginas que usam toda a largura (quadros); as demais ficam numa coluna de leitura confortável. */
const WIDE_PAGES = ['/pedidos'];

const TABS: { path: string; label: string; permission: string | string[] | null; approvedOnly?: boolean }[] = [
  { path: '', label: 'Visão geral', permission: null },
  { path: '/assistente', label: 'Assistente', permission: 'company.reports.read', approvedOnly: true },
  { path: '/pedidos', label: 'Pedidos', permission: 'company.orders.read', approvedOnly: true },
  { path: '/entregas', label: 'Entregas', permission: 'company.orders.read', approvedOnly: true },
  { path: '/impressora', label: 'Impressora', permission: 'company.orders.read', approvedOnly: true },
  { path: '/mensagens', label: 'Mensagens', permission: 'company.orders.read', approvedOnly: true },
  { path: '/corporativo', label: 'Corporativo', permission: ['company.deliveries.request', 'company.finance.read', 'company.b2b.manage'], approvedOnly: true },
  { path: '/catalogo', label: 'Catálogo', permission: 'company.products.read' },
  { path: '/cupons', label: 'Cupons', permission: 'company.products.read', approvedOnly: true },
  { path: '/entrega', label: 'Área de entrega', permission: 'company.profile.manage' },
  { path: '/frota', label: 'Frota própria', permission: 'company.fleet.manage', approvedOnly: true },
  { path: '/dados', label: 'Dados', permission: 'company.profile.manage' },
  { path: '/endereco', label: 'Endereço e horários', permission: 'company.profile.manage' },
  { path: '/documentos', label: 'Documentos', permission: 'company.profile.manage' },
  { path: '/financeiro', label: 'Financeiro', permission: ['company.finance.read', 'company.profile.manage'] },
  { path: '/equipe', label: 'Equipe', permission: 'company.users.manage' },
  { path: '/integracoes', label: 'Integrações', permission: 'company.b2b.manage', approvedOnly: true },
  { path: '/marca', label: 'Marca própria', permission: 'company.profile.manage', approvedOnly: true },
  { path: '/plano', label: 'Plano', permission: 'company.profile.manage' },
  { path: '/indicacoes', label: 'Indique e ganhe', permission: 'company.profile.manage' },
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
  const ordersEnabled = data.status === 'APPROVED' && can('company.orders.read');
  const onOrders = pathname.startsWith(`${base}/pedidos`);
  const wide = WIDE_PAGES.some((path) => pathname.startsWith(`${base}${path}`));

  return (
    <CompanyContext.Provider value={{ company: data, reload: () => void refetch(), can }}>
      <OrderAlertsProvider key={companyId} companyId={companyId} enabled={ordersEnabled}>
        {ordersEnabled && <OrderLabelAutoPrint />}
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
        {(data.address?.lat == null || data.address?.lng == null) && !pathname.startsWith(`${base}/endereco`) && can('company.profile.manage') && (
          <p className="mb-6 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-fg" role="status">
            <strong>Sua loja não aparece para os clientes:</strong> falta marcar a localização do estabelecimento.{' '}
            <Link href={`${base}/endereco`} className="font-bold text-brand-600 hover:underline">
              Marcar no mapa
            </Link>
          </p>
        )}
        {ordersEnabled && !onOrders && <PendingOrdersBanner href={`${base}/pedidos`} className="mb-6" />}
        <div className="lg:flex lg:items-start lg:gap-8">
          {/* Celular: abas horizontais. Telas grandes: menu lateral fixo, com rolagem própria. */}
          <nav
            className="mb-6 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:thin] lg:sticky lg:top-20 lg:mb-0 lg:max-h-[calc(100vh-6rem)] lg:w-52 lg:shrink-0 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:border-b-0 lg:border-r lg:pr-3"
            aria-label="Seções da empresa"
          >
            {tabs.map((tab) => {
              const href = `${base}${tab.path}`;
              const active = tab.path === '' ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={tab.path}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    '-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium lg:mb-0 lg:rounded-lg lg:border-b-0',
                    active ? 'border-brand-500 text-brand-600 lg:bg-brand-500/10' : 'border-transparent text-muted hover:text-fg lg:hover:bg-surface-2',
                  )}
                >
                  {tab.label}
                  {tab.path === '/pedidos' && <PendingOrdersBadge />}
                </Link>
              );
            })}
          </nav>
          <div className={cn('min-w-0 flex-1', !wide && 'lg:max-w-5xl')}>{children}</div>
        </div>
      </OrderAlertsProvider>
    </CompanyContext.Provider>
  );
}
