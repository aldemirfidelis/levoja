'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { BrandLogo, cn, useBrand } from '@levoja/web-kit/ui';

const NAV = [
  { href: '/como-funciona', label: 'Como funciona' },
  { href: '/para-clientes', label: 'Clientes' },
  { href: '/para-empresas', label: 'Empresas' },
  { href: '/para-entregadores', label: 'Entregadores' },
  { href: '/solucoes-empresariais', label: 'Soluções empresariais' },
  { href: '/ajuda', label: 'Ajuda' },
];

export function Logo({ className }: { className?: string }) {
  const brand = useBrand();
  return (
    <Link href="/" className={cn('text-2xl font-extrabold tracking-tight text-brand-500', className)} aria-label={`${brand.appName} — página inicial`}>
      <BrandLogo />
    </Link>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Principal">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                pathname === item.href ? 'text-brand-600' : 'text-muted hover:text-fg',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <Link href="/entrar" className="rounded-lg px-4 py-2 text-sm font-semibold text-fg hover:bg-surface-2">
            Entrar
          </Link>
          <Link href="/cadastro" className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">
            Criar conta
          </Link>
        </div>
        <button className="rounded-lg p-2 hover:bg-surface-2 lg:hidden" onClick={() => setOpen(!open)} aria-label={open ? 'Fechar menu' : 'Abrir menu'} aria-expanded={open}>
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>
      {open && (
        <nav className="border-t border-border bg-surface px-4 pb-4 lg:hidden" aria-label="Principal (celular)">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-3 font-medium text-fg hover:bg-surface-2">
              {item.label}
            </Link>
          ))}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link href="/entrar" onClick={() => setOpen(false)} className="rounded-lg border border-border px-4 py-3 text-center font-semibold">
              Entrar
            </Link>
            <Link href="/cadastro" onClick={() => setOpen(false)} className="rounded-lg bg-brand-500 px-4 py-3 text-center font-semibold text-white">
              Criar conta
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}

const FOOTER = [
  {
    title: 'Plataforma',
    links: [
      ['/como-funciona', 'Como funciona'],
      ['/cidades', 'Onde atendemos'],
      ['/taxas', 'Taxas'],
      ['/seguranca', 'Segurança'],
      ['/solucoes-empresariais', 'Soluções empresariais'],
    ],
  },
  {
    title: 'Participe',
    links: [
      ['/cadastro/cliente', 'Criar conta de cliente'],
      ['/cadastro/empresa', 'Cadastrar minha empresa'],
      ['/cadastro/entregador', 'Quero ser entregador'],
    ],
  },
  {
    title: 'Suporte',
    links: [
      ['/ajuda', 'Central de ajuda'],
      ['/faq', 'Perguntas frequentes'],
      ['/contato', 'Contato'],
    ],
  },
  {
    title: 'Legal',
    links: [
      ['/termos', 'Termos de uso'],
      ['/privacidade', 'Política de privacidade'],
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-5">
        <div className="md:col-span-1">
          <Logo />
          <p className="mt-3 text-sm text-muted">Marketplace, delivery e logística sob demanda.</p>
        </div>
        {FOOTER.map((group) => (
          <div key={group.title}>
            <p className="text-sm font-semibold text-fg">{group.title}</p>
            <ul className="mt-3 space-y-2">
              {group.links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="text-sm text-muted hover:text-fg">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border py-6 text-center text-xs text-muted">
        © {new Date().getFullYear()} <BrandName />. Todos os direitos reservados.
      </div>
    </footer>
  );
}

function BrandName() {
  return <>{useBrand().appName}</>;
}
