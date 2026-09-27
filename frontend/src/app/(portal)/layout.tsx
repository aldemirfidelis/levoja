'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Bike, Building2, LogOut, Moon, Sun, Truck, UserCircle } from 'lucide-react';
import { useApi } from '@levoja/web-kit/client';
import { cn, useTheme } from '@levoja/web-kit/ui';
import { Logo } from '@/components/site-chrome';
import { PortalSessionProvider, usePortal } from '@/lib/portal-session';
import { PortalNotifications } from '@/components/pwa';
import { StoreStatusControl } from '@/components/store-status-control';

/** Painel da empresa (menu lateral + quadro de pedidos) usa uma área mais larga que o resto do portal. */
const isWide = (pathname: string) => pathname.startsWith('/empresa/') && pathname !== '/empresa/nova';

/** Empresa cuja situação (aberta/pausada) aparece no topo: a da página atual ou, se a pessoa só tem uma, sempre ela. */
function headerCompanyId(pathname: string, companies: { id: string; status: string }[]): string | null {
  const [, section, id] = pathname.split('/');
  if (section === 'empresa' && id && id !== 'nova') return id;
  const approved = companies.filter((company) => company.status === 'APPROVED');
  return approved.length === 1 ? approved[0].id : null;
}

function PortalHeader() {
  const pathname = usePathname();
  const { me, logout } = usePortal();
  const { theme, setTheme } = useTheme();
  const { data: notifications } = useApi<{ unread: number }>('me/notifications', { pageSize: 1 }, { refetchInterval: 60_000 });

  const statusCompanyId = headerCompanyId(pathname, me.companies);

  const links = [
    ...(me.customerId ? [{ href: '/entregas', label: 'Entregas', icon: Truck }] : []),
    ...(me.companies.length ? [{ href: '/empresa', label: 'Empresa', icon: Building2 }] : []),
    ...(me.driver ? [{ href: '/entregador', label: 'Entregador', icon: Bike }] : []),
    { href: '/conta', label: 'Minha conta', icon: UserCircle },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface">
      <div className={cn('mx-auto flex flex-wrap items-center justify-between gap-x-3 px-4 sm:px-6', isWide(pathname) ? 'max-w-[96rem]' : 'max-w-6xl')}>
        <div className="flex h-16 items-center">
          <Logo className="text-xl" />
        </div>
        {/* Situação da loja sempre à vista: ao lado do menu em telas grandes; faixa própria embaixo no celular/tablet. */}
        {statusCompanyId && <StoreStatusControl key={statusCompanyId} companyId={statusCompanyId} className="order-last mb-3 w-full lg:order-none lg:mb-0 lg:ml-auto lg:w-72" />}
        <nav className="flex h-16 items-center gap-1" aria-label="Áreas">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
                pathname.startsWith(link.href) ? 'bg-brand-500/10 text-brand-600' : 'text-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              <link.icon className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{link.label}</span>
            </Link>
          ))}
          <Link href="/conta?aba=notificacoes" className="relative rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Notificações">
            <Bell className="h-5 w-5" />
            {!!notifications?.unread && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white">
                {notifications.unread > 9 ? '9+' : notifications.unread}
              </span>
            )}
          </Link>
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Alternar tema">
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
          <button onClick={logout} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-danger" aria-label="Sair">
            <LogOut className="h-5 w-5" />
          </button>
        </nav>
      </div>
    </header>
  );
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <PortalSessionProvider>
      <div className="min-h-screen">
        <PortalNotifications />
        <PortalHeader />
        <main className={cn('mx-auto px-4 py-8 sm:px-6', isWide(pathname) ? 'max-w-[96rem]' : 'max-w-6xl')}>{children}</main>
      </div>
    </PortalSessionProvider>
  );
}
