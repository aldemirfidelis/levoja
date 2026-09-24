import type { Metadata } from 'next';
import Link from 'next/link';
import { Bike, Building2, HelpCircle, Lock, Mail, ShoppingBag } from 'lucide-react';
import { PageHero, Section } from '@/components/marketing';

export const metadata: Metadata = { title: 'Central de ajuda' };

const TOPICS = [
  { icon: ShoppingBag, title: 'Pedidos e entregas', text: 'Pagamentos, cancelamentos, reembolsos e acompanhamento.', href: '/faq' },
  { icon: Building2, title: 'Para empresas', text: 'Cadastro, documentos, catálogo e repasses.', href: '/para-empresas' },
  { icon: Bike, title: 'Para entregadores', text: 'Requisitos, análise do cadastro, ganhos e saques.', href: '/para-entregadores' },
  { icon: Lock, title: 'Conta e privacidade', text: 'Senha, verificação em duas etapas e seus dados (LGPD).', href: '/seguranca' },
  { icon: HelpCircle, title: 'Perguntas frequentes', text: 'Respostas rápidas para as dúvidas mais comuns.', href: '/faq' },
  { icon: Mail, title: 'Fale conosco', text: 'Envie sua mensagem. Respondemos em até 2 dias úteis.', href: '/contato' },
];

export default function HelpPage() {
  return (
    <>
      <PageHero
        eyebrow="Central de ajuda"
        title="Como podemos ajudar?"
        description="Problemas com um pedido em andamento? Use o suporte no app — ele já identifica o pedido e agiliza o atendimento."
      />
      <Section>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {TOPICS.map((topic) => (
            <Link key={topic.title} href={topic.href} className="rounded-2xl border border-border bg-surface p-6 transition hover:border-brand-300 hover:shadow-md">
              <topic.icon className="h-7 w-7 text-brand-500" aria-hidden />
              <h2 className="mt-4 font-bold text-fg">{topic.title}</h2>
              <p className="mt-1 text-sm text-muted">{topic.text}</p>
            </Link>
          ))}
        </div>
      </Section>
    </>
  );
}
