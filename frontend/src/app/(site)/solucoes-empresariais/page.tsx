import type { Metadata } from 'next';
import { FileSpreadsheet, Landmark, Layers, Network, Receipt, Repeat } from 'lucide-react';
import { CtaLink, FeatureGrid, PageHero, Section, SectionTitle } from '@/components/marketing';

export const metadata: Metadata = { title: 'Soluções empresariais' };

export default function BusinessSolutionsPage() {
  return (
    <>
      <PageHero
        eyebrow="B2B"
        title="Logística corporativa sob medida"
        description="Entregas recorrentes, em lote, documentos e transferências entre unidades, com contrato, faturamento mensal e relatórios."
      >
        <CtaLink href="/contato">Falar com um especialista</CtaLink>
      </PageHero>
      <Section>
        <SectionTitle title="O que sua empresa pode fazer" />
        <FeatureGrid
          items={[
            { icon: <FileSpreadsheet className="h-6 w-6" />, title: 'Entregas em lote', text: 'Importe entregas por CSV, Excel ou API. Validamos endereços e distribuímos as rotas.' },
            { icon: <Repeat className="h-6 w-6" />, title: 'Rotas recorrentes', text: 'Coletas e entregas programadas entre filiais, clientes e fornecedores.' },
            { icon: <Receipt className="h-6 w-6" />, title: 'Faturamento mensal', text: 'Contratos, tabelas especiais, limites de crédito e centros de custo.' },
            { icon: <Landmark className="h-6 w-6" />, title: 'Documentos com prova', text: 'Envio de documentos com assinatura digital e comprovante de entrega.' },
            { icon: <Network className="h-6 w-6" />, title: 'API e integrações', text: 'Integre seu ERP ou e-commerce e acompanhe tudo por webhooks.' },
            { icon: <Layers className="h-6 w-6" />, title: 'White label', text: 'Plataforma com a sua marca, domínio e regras para a sua operação.' },
          ]}
        />
      </Section>
    </>
  );
}
