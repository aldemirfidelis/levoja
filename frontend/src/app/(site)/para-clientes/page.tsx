import type { Metadata } from 'next';
import { Bell, CalendarClock, CreditCard, MapPin, Star, Tag } from 'lucide-react';
import { CtaLink, FeatureGrid, PageHero, Section, SectionTitle } from '@/components/marketing';

export const metadata: Metadata = { title: 'Para clientes' };

export default function ForCustomersPage() {
  return (
    <>
      <PageHero
        eyebrow="Para clientes"
        title="Peça o que quiser. Envie o que precisar."
        description="Comida, farmácia, mercado, lojas e entregas avulsas com acompanhamento em tempo real."
      >
        <CtaLink href="/cadastro/cliente">Criar minha conta</CtaLink>
        <CtaLink href="/entrar" variant="secondary">
          Já tenho conta
        </CtaLink>
      </PageHero>
      <Section>
        <SectionTitle title="Tudo pensado para ser simples" />
        <FeatureGrid
          items={[
            { icon: <MapPin className="h-6 w-6" />, title: 'Só o que atende você', text: 'Mostramos apenas estabelecimentos que entregam no seu endereço.' },
            { icon: <CreditCard className="h-6 w-6" />, title: 'Preço transparente', text: 'Produto, entrega e taxas separados antes de você confirmar.' },
            { icon: <Bell className="h-6 w-6" />, title: 'Avisos em cada etapa', text: 'Pedido aceito, em preparo, coletado, chegando — por push, e-mail ou WhatsApp.' },
            { icon: <CalendarClock className="h-6 w-6" />, title: 'Agende quando quiser', text: 'Receba agora ou escolha o dia e o horário da entrega.' },
            { icon: <Tag className="h-6 w-6" />, title: 'Cupons e promoções', text: 'Descontos, frete grátis e benefícios para quem pede com frequência.' },
            { icon: <Star className="h-6 w-6" />, title: 'Avaliações reais', text: 'Avalie lojas e entregadores e ajude a comunidade a escolher melhor.' },
          ]}
        />
      </Section>
    </>
  );
}
