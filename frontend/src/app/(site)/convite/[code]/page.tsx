'use client';

import { use } from 'react';
import { Bike, Gift, ShoppingBag, Store } from 'lucide-react';
import { formatBRL, normalizeReferralCode, type ReferralProgram } from '@levoja/shared';
import { useApi } from '@levoja/web-kit/client';
import { SkeletonRows } from '@levoja/web-kit/ui';
import { CtaLink, PageHero, Section } from '@/components/marketing';

interface Validation {
  valid: boolean;
  reason?: string;
  referredRewardCents?: number;
  goal?: string;
}

const OPTIONS: { program: ReferralProgram; title: string; text: string; href: string; cta: string; icon: typeof Store }[] = [
  { program: 'CUSTOMER', title: 'Para pedir', text: 'Peça em restaurantes, mercados e farmácias ou envie encomendas.', href: '/cadastro/cliente', cta: 'Criar conta de cliente', icon: ShoppingBag },
  { program: 'DRIVER', title: 'Para entregar', text: 'Ganhe fazendo entregas com moto, bike, carro ou van.', href: '/cadastro/entregador', cta: 'Quero ser entregador', icon: Bike },
  { program: 'COMPANY', title: 'Para vender', text: 'Coloque sua loja no marketplace e use a logística de entregas.', href: '/cadastro/empresa', cta: 'Cadastrar minha empresa', icon: Store },
];

function Option({ code, option }: { code: string; option: (typeof OPTIONS)[number] }) {
  const { data } = useApi<Validation>('referrals/validate', { code, program: option.program }, { retry: false });
  if (!data?.valid) return null;
  const Icon = option.icon;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-6">
      <Icon className="h-8 w-8 text-brand-500" aria-hidden />
      <h2 className="text-lg font-bold text-fg">{option.title}</h2>
      <p className="text-sm text-muted">{option.text}</p>
      {data.referredRewardCents ? (
        <p className="text-sm text-fg">
          Bônus de <strong>{formatBRL(data.referredRewardCents)}</strong> ao cumprir a meta: {data.goal ? data.goal.charAt(0).toLowerCase() + data.goal.slice(1) : ''}.
        </p>
      ) : null}
      <div className="mt-auto pt-2">
        <CtaLink href={`${option.href}?indicacao=${code}`}>{option.cta}</CtaLink>
      </div>
    </div>
  );
}

/** Link de convite do "Indique e ganhe": mostra os cadastros em que o código vale (sem revelar quem indicou). */
export default function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = use(params);
  const code = normalizeReferralCode(decodeURIComponent(raw));
  const any = useApi<Validation>('referrals/validate', { code, program: 'CUSTOMER' }, { retry: false });

  return (
    <>
      <PageHero eyebrow="Convite" title="Você recebeu um convite" description={`Cadastre-se com o código ${code} e aproveite o bônus de boas-vindas.`}>
        <div className="inline-flex items-center gap-3 rounded-xl border-2 border-dashed border-brand-500 bg-surface px-6 py-3">
          <Gift className="h-6 w-6 text-brand-500" aria-hidden />
          <span className="font-mono text-2xl font-extrabold tracking-widest text-fg">{code}</span>
        </div>
      </PageHero>
      <Section>
        {any.isLoading ? (
          <SkeletonRows rows={3} />
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-3">
              {OPTIONS.map((option) => (
                <Option key={option.program} code={code} option={option} />
              ))}
            </div>
            <p className="mt-8 text-center text-sm text-muted">
              Vai usar o app? Baixe o app do LevoJá (ou o app do entregador) e informe o código <strong className="text-fg">{code}</strong> no cadastro.
              {any.data && !any.data.valid && any.data.reason ? ` ${any.data.reason}` : ''}
            </p>
          </>
        )}
      </Section>
    </>
  );
}
