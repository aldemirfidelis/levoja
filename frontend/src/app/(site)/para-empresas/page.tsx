import type { Metadata } from 'next';
import { BarChart3, Boxes, Check, Clock, FileCheck2, Truck, Users } from 'lucide-react';
import { formatBRL, PLAN_FEATURE_LABELS, type PlanFeature } from '@levoja/shared';
import { publicApi } from '@/lib/bff';
import { CtaLink, FeatureGrid, PageHero, Section, SectionTitle, Steps } from '@/components/marketing';

export const metadata: Metadata = { title: 'Para empresas' };

interface PublicPlan {
  key: string;
  name: string;
  description: string | null;
  priceCents: number;
  features: PlanFeature[];
  trialDays: number;
}

export default async function ForCompaniesPage() {
  const plans = (await publicApi<PublicPlan[]>('plans', 300)) ?? [];
  return (
    <>
      <PageHero
        eyebrow="Para empresas"
        title="Venda mais e entregue melhor"
        description="Restaurantes, farmácias, mercados e lojas: catálogo online, pedidos em tempo real e logística completa."
      >
        <CtaLink href="/cadastro/empresa">Cadastrar minha empresa</CtaLink>
        <CtaLink href="/entrar?next=/empresa" variant="secondary">
          Acessar o portal
        </CtaLink>
      </PageHero>
      <Section>
        <SectionTitle title="Como é o cadastro" />
        <Steps
          items={[
            { title: 'Cadastre-se', text: 'Informe os dados da empresa (CNPJ numérico ou alfanumérico) e do responsável.' },
            { title: 'Envie os documentos', text: 'Cartão CNPJ, documento do responsável, comprovante de endereço e licenças do seu segmento.' },
            { title: 'Comece a vender', text: 'Após a aprovação, monte o catálogo, defina horários e abra a loja.' },
          ]}
        />
      </Section>
      {plans.length > 0 && (
        <Section>
          <SectionTitle title="Planos" description="Comece grátis e mude de plano quando precisar. A mensalidade é descontada das suas vendas." center />
          <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
            {plans.map((plan) => (
              <div key={plan.key} className="flex flex-col rounded-xl border border-border bg-surface p-6">
                <h3 className="text-lg font-bold text-fg">{plan.name}</h3>
                <p className="mt-1 text-3xl font-extrabold text-fg">
                  {plan.priceCents ? formatBRL(plan.priceCents) : 'Grátis'}
                  {plan.priceCents > 0 && <span className="text-base font-normal text-muted">/mês</span>}
                </p>
                {plan.trialDays > 0 && plan.priceCents > 0 && <p className="text-sm text-muted">{plan.trialDays} dias grátis para experimentar</p>}
                {plan.description && <p className="mt-2 text-sm text-muted">{plan.description}</p>}
                <ul className="mt-4 flex-1 space-y-2 text-sm">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2 text-fg">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> {PLAN_FEATURE_LABELS[feature] ?? feature}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}
      <Section muted>
        <SectionTitle title="Ferramentas do portal da empresa" />
        <FeatureGrid
          items={[
            { icon: <Boxes className="h-6 w-6" />, title: 'Catálogo completo', text: 'Categorias, variações, adicionais, combos, estoque e promoções.' },
            { icon: <Clock className="h-6 w-6" />, title: 'Pedidos em tempo real', text: 'Aceite, prepare e acompanhe cada pedido até a entrega.' },
            { icon: <Truck className="h-6 w-6" />, title: 'Logística flexível', text: 'Entregadores da plataforma, frota própria ou os dois.' },
            { icon: <BarChart3 className="h-6 w-6" />, title: 'Indicadores', text: 'Vendas, ticket médio, tempo de preparo, avaliações e produtos mais vendidos.' },
            { icon: <Users className="h-6 w-6" />, title: 'Equipe com permissões', text: 'Proprietário, gerente, atendente e financeiro, cada um com seu acesso.' },
            { icon: <FileCheck2 className="h-6 w-6" />, title: 'Produtos regulados', text: 'Regras específicas para farmácias e itens com restrição de idade.' },
          ]}
        />
      </Section>
    </>
  );
}
