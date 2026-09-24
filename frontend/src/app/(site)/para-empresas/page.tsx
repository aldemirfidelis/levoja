import type { Metadata } from 'next';
import { BarChart3, Boxes, Clock, FileCheck2, Truck, Users } from 'lucide-react';
import { CtaLink, FeatureGrid, PageHero, Section, SectionTitle, Steps } from '@/components/marketing';

export const metadata: Metadata = { title: 'Para empresas' };

export default function ForCompaniesPage() {
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
