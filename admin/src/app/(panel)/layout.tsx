'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  Building2,
  Bike,
  Briefcase,
  BrainCircuit,
  CreditCard,
  Globe2,
  MapPinned,
  Palette,
  ShieldAlert,
  Calculator,
  ShoppingBag,
  Star,
  Truck,
  FileClock,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  LineChart,
  Megaphone,
  Radar,
  LogOut,
  Menu,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  UserCircle,
  Users,
  Lock,
  TicketPercent,
  Trophy,
  Wallet,
  X,
} from 'lucide-react';
import { BrandLogo, cn, useTheme } from '@levoja/web-kit/ui';
import { SessionProvider, useSession } from '@/lib/session';

const NAV = [
  { href: '/', label: 'Visão geral', icon: LayoutDashboard, permission: null },
  { href: '/pedidos', label: 'Pedidos', icon: ShoppingBag, permission: 'orders.read' },
  { href: '/entregas', label: 'Entregas', icon: Truck, permission: 'deliveries.read' },
  { href: '/operacao', label: 'Operação', icon: Radar, permission: 'operations.view' },
  { href: '/suporte', label: 'Atendimento', icon: LifeBuoy, permission: 'support.tickets.read' },
  { href: '/relatorios', label: 'Relatórios', icon: LineChart, permission: 'reports.read' },
  { href: '/inteligencia', label: 'Inteligência', icon: BrainCircuit, permission: 'operations.view' },
  { href: '/antifraude', label: 'Antifraude', icon: ShieldAlert, permission: 'fraud.read' },
  { href: '/b2b', label: 'Corporativo (B2B)', icon: Briefcase, permission: 'contracts.read' },
  { href: '/empresas', label: 'Empresas', icon: Building2, permission: 'companies.read' },
  { href: '/entregadores', label: 'Entregadores', icon: Bike, permission: 'drivers.read' },
  { href: '/usuarios', label: 'Usuários', icon: Users, permission: 'users.read' },
  { href: '/financeiro', label: 'Financeiro', icon: Wallet, permission: 'payments.read' },
  { href: '/precos', label: 'Precificação', icon: Calculator, permission: 'pricing.read' },
  { href: '/cupons', label: 'Cupons', icon: TicketPercent, permission: 'coupons.manage' },
  { href: '/fidelidade', label: 'Fidelidade e indicação', icon: Trophy, permission: 'coupons.manage' },
  { href: '/comunicados', label: 'Comunicados', icon: Megaphone, permission: 'notifications.broadcast' },
  { href: '/papeis', label: 'Papéis e permissões', icon: ShieldCheck, permission: 'roles.read' },
  { href: '/avaliacoes', label: 'Avaliações', icon: Star, permission: 'reviews.moderate' },
  { href: '/contatos', label: 'Mensagens de contato', icon: Inbox, permission: 'support.tickets.read' },
  { href: '/auditoria', label: 'Auditoria', icon: FileClock, permission: 'audit.read' },
  { href: '/privacidade', label: 'Privacidade (LGPD)', icon: Lock, permission: 'privacy.manage' },
  { href: '/cidades', label: 'Cidades', icon: MapPinned, permission: 'operations.view' },
  { href: '/planos', label: 'Planos SaaS', icon: CreditCard, permission: 'plans.manage' },
  { href: '/marca', label: 'Marca', icon: Palette, permission: 'settings.manage' },
  { href: '/tenants', label: 'Tenants (white label)', icon: Globe2, permission: 'tenants.manage' },
  { href: '/configuracoes', label: 'Configurações', icon: Settings, permission: 'settings.manage' },
] as const;

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me, can, logout } = useSession();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((item) => !item.permission || can(item.permission));
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Menu principal">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setOpen(false)}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            isActive(item.href) ? 'bg-brand-500/10 text-brand-600' : 'text-muted hover:bg-surface-2 hover:text-fg',
          )}
          aria-current={isActive(item.href) ? 'page' : undefined}
        >
          <item.icon className="h-4 w-4 shrink-0" aria-hidden />
          {item.label}
        </Link>
      ))}
    </nav>
  );

  const footer = (
    <div className="border-t border-border p-3">
      <Link href="/conta" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-2">
        <UserCircle className="h-8 w-8 text-muted" aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{me.user.name}</p>
          <p className="truncate text-xs text-muted">{me.user.email}</p>
        </div>
      </Link>
      <div className="mt-2 flex gap-1">
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg"
          aria-label="Alternar tema"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          Tema
        </button>
        <button
          onClick={logout}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-danger"
        >
          <LogOut className="h-4 w-4" /> Sair
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-16 items-center gap-2 border-b border-border px-5">
          <BrandLogo className="text-lg font-extrabold text-brand-500" />
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-muted">Admin</span>
        </div>
        {nav}
        {footer}
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface px-4 lg:hidden">
        <BrandLogo className="text-lg font-extrabold text-brand-500" suffix="Admin" />
        <button onClick={() => setOpen(true)} aria-label="Abrir menu" className="rounded-lg p-2 hover:bg-surface-2">
          <Menu className="h-5 w-5" />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <BrandLogo className="font-extrabold text-brand-500" suffix="Admin" />
              <button onClick={() => setOpen(false)} aria-label="Fechar menu" className="rounded-lg p-2 hover:bg-surface-2">
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
