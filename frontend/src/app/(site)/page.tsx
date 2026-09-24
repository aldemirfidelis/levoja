import Link from 'next/link';
import { BadgeCheck, Bike, Building2, Clock, MapPin, ShieldCheck, ShoppingBag, Truck, Wallet } from 'lucide-react';
import { publicApi } from '@/lib/bff';
import { SegmentIcon } from '@/components/segment-icon';
import { CtaLink, FeatureGrid, Section, SectionTitle, Steps } from '@/components/marketing';

interface Segment {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  kind: 'MARKETPLACE' | 'ON_DEMAND';
}

export default async function HomePage() {
  const segments = (await publicApi<Segment[]>('segments')) ?? [];

  return (
    <>
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-500 to-brand-700 px-4 py-20 text-white sm:px-6 sm:py-28">
        <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm font-medium">
              <MapPin className="h-4 w-4" aria-hidden /> Entregas na sua cidade, em minutos
            </p>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">Tudo o que você precisa, entregue já.</h1>
            <p className="mt-6 max-w-xl text-lg text-white/90">
              Peça comida, remédios, mercado e produtos de lojas perto de você — ou envie documentos e encomendas com um entregador em poucos toques.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/entregas/nova" className="inline-flex h-12 items-center rounded-xl bg-white px-6 font-semibold text-brand-700 hover:bg-white/90">
                Pedir uma entrega
              </Link>
              <Link href="/cadastro/entregador" className="inline-flex h-12 items-center rounded-xl border border-white/40 px-6 font-semibold hover:bg-white/10">
                Quero ser entregador
              </Link>
              <Link href="/cadastro/empresa" className="inline-flex h-12 items-center rounded-xl border border-white/40 px-6 font-semibold hover:bg-white/10">
                Cadastrar minha empresa
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { icon: ShoppingBag, title: 'Marketplace', text: 'Restaurantes, farmácias, mercados e lojas em um só lugar.' },
              { icon: Truck, title: 'Entrega avulsa', text: 'Envie o que precisar de um ponto a outro, sem comprar nada.' },
              { icon: Clock, title: 'Agendada ou imediata', text: 'Entregue agora ou escolha dia e hora.' },
              { icon: ShieldCheck, title: 'Prova de entrega', text: 'Código, QR code, foto ou assinatura.' },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl bg-white/10 p-5 backdrop-blur">
                <item.icon className="mb-3 h-7 w-7" aria-hidden />
                <p className="font-bold">{item.title}</p>
                <p className="mt-1 text-sm text-white/80">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {segments.length > 0 && (
        <Section>
          <SectionTitle eyebrow="Categorias" title="O que você quer receber hoje?" />
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {segments.map((segment) => (
              <li key={segment.id}>
                <Link
                  href={segment.kind === 'ON_DEMAND' ? '/entregas/nova' : '/para-clientes'}
                  className="flex h-full flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-5 text-center transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600">
                    <SegmentIcon name={segment.icon} className="h-6 w-6" />
                  </span>
                  <span className="text-sm font-semibold text-fg">{segment.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section muted>
        <SectionTitle eyebrow="Como funciona" title="Do pedido à porta, com acompanhamento em tempo real" center />
        <Steps
          items={[
            { title: 'Escolha', text: 'Encontre estabelecimentos próximos ou informe origem e destino de uma entrega avulsa.' },
            { title: 'Confirme', text: 'Veja o valor completo antes de pagar: produto, entrega e taxas, sem surpresas.' },
            { title: 'Acompanhe', text: 'Siga o entregador no mapa e receba notificações a cada etapa até a entrega.' },
          ]}
        />
      </Section>

      <Section>
        <SectionTitle eyebrow="Para todos" title="Uma plataforma, três jeitos de participar" />
        <div className="grid gap-6 lg:grid-cols-3">
          {[
            {
              icon: ShoppingBag,
              title: 'Clientes',
              text: 'Compre de quem está perto e envie encomendas com segurança. Pague com PIX ou cartão.',
              href: '/cadastro/cliente',
              cta: 'Criar conta',
            },
            {
              icon: Building2,
              title: 'Empresas',
              text: 'Venda online, use nossos entregadores ou sua própria frota e acompanhe tudo em um painel.',
              href: '/cadastro/empresa',
              cta: 'Cadastrar minha empresa',
            },
            {
              icon: Bike,
              title: 'Entregadores',
              text: 'Escolha seus horários, veja o valor antes de aceitar e receba seus ganhos via PIX.',
              href: '/cadastro/entregador',
              cta: 'Quero ser entregador',
            },
          ].map((card) => (
            <div key={card.title} className="flex flex-col rounded-2xl border border-border bg-surface p-7">
              <card.icon className="h-9 w-9 text-brand-500" aria-hidden />
              <h3 className="mt-4 text-xl font-bold text-fg">{card.title}</h3>
              <p className="mt-2 flex-1 text-muted">{card.text}</p>
              <Link href={card.href} className="mt-6 font-semibold text-brand-600 hover:underline">
                {card.cta} →
              </Link>
            </div>
          ))}
        </div>
      </Section>

      <Section muted>
        <SectionTitle eyebrow="Confiança" title="Segurança em cada etapa" />
        <FeatureGrid
          items={[
            { icon: <BadgeCheck className="h-6 w-6" />, title: 'Parceiros verificados', text: 'Empresas e entregadores passam por análise documental antes de operar.' },
            { icon: <ShieldCheck className="h-6 w-6" />, title: 'Privacidade (LGPD)', text: 'Dados sensíveis criptografados e telefones protegidos pelo chat da plataforma.' },
            { icon: <Wallet className="h-6 w-6" />, title: 'Pagamento protegido', text: 'Valores separados e transparentes, com estorno quando algo dá errado.' },
          ]}
        />
      </Section>

      <Section>
        <div className="rounded-3xl bg-fg px-6 py-12 text-center sm:px-12">
          <h2 className="text-3xl font-extrabold text-bg sm:text-4xl">Pronto para começar?</h2>
          <p className="mx-auto mt-3 max-w-xl text-bg/70">Crie sua conta gratuitamente em menos de um minuto.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <CtaLink href="/cadastro">Criar conta</CtaLink>
            <CtaLink href="/entrar" variant="secondary">
              Entrar
            </CtaLink>
          </div>
        </div>
      </Section>
    </>
  );
}
