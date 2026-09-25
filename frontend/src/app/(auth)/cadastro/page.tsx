import type { Metadata } from 'next';
import { fetchTenantBranding } from '@levoja/web-kit/brand';
import Link from 'next/link';
import { Bike, Building2, ShoppingBag } from 'lucide-react';

export const metadata: Metadata = { title: 'Criar conta' };

const OPTIONS = [
  { href: '/cadastro/cliente', icon: ShoppingBag, title: 'Quero pedir', text: 'Compre de lojas próximas e envie encomendas.' },
  { href: '/cadastro/empresa', icon: Building2, title: 'Tenho uma empresa', text: 'Venda online e use nossa logística.' },
  { href: '/cadastro/entregador', icon: Bike, title: 'Quero entregar', text: 'Ganhe dinheiro fazendo entregas no seu horário.' },
];

export default async function SignupChooserPage() {
  const brand = await fetchTenantBranding(process.env.API_URL ?? 'http://localhost:3333', process.env.TENANT_SLUG ?? 'levoja');
  return (
    <div className="w-full max-w-3xl">
      <h1 className="text-center text-3xl font-extrabold text-fg">Como você quer usar {brand.appName === 'LevoJá' ? 'a LevoJá' : brand.appName}?</h1>
      <p className="mt-2 text-center text-muted">Você pode adicionar outros perfis depois, com a mesma conta.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {OPTIONS.map((option) => (
          <Link
            key={option.href}
            href={option.href}
            className="flex flex-col items-center rounded-2xl border border-border bg-surface p-6 text-center transition hover:border-brand-400 hover:shadow-md"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-600">
              <option.icon className="h-7 w-7" aria-hidden />
            </span>
            <span className="mt-4 font-bold text-fg">{option.title}</span>
            <span className="mt-1 text-sm text-muted">{option.text}</span>
          </Link>
        ))}
      </div>
      <p className="mt-8 text-center text-sm text-muted">
        Já tem conta?{' '}
        <Link href="/entrar" className="font-medium text-brand-600 hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}
