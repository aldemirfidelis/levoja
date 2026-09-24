import type { Metadata } from 'next';
import { ArrowRightLeft, Building2, MapPinned, PackageCheck, Route, ShoppingBag } from 'lucide-react';
import { CtaLink, FeatureGrid, PageHero, Section, SectionTitle, Steps } from '@/components/marketing';

export const metadata: Metadata = { title: 'Como funciona' };

export default function HowItWorksPage() {
  return (
    <>
      <PageHero
        eyebrow="Como funciona"
        title="Marketplace e logística sob demanda na mesma plataforma"
        description="Você pode comprar de estabelecimentos parceiros ou apenas contratar uma entrega. Empresas também podem solicitar entregas avulsas ou em lote."
      >
        <CtaLink href="/cadastro">Criar conta</CtaLink>
      </PageHero>

      <Section>
        <SectionTitle eyebrow="Modelo 1" title="Compre em estabelecimentos perto de você" />
        <Steps
          items={[
            { title: 'Escolha a loja e os produtos', text: 'Restaurantes, farmácias, mercados, lojas e conveniências que atendem o seu endereço.' },
            { title: 'Pague com segurança', text: 'PIX, cartão ou carteira digital. O valor do produto, da entrega e as taxas aparecem separados.' },
            { title: 'Receba e avalie', text: 'A loja prepara, um entregador coleta e você acompanha no mapa até confirmar o recebimento.' },
          ]}
        />
      </Section>

      <Section muted>
        <SectionTitle eyebrow="Modelo 2" title="Entrega avulsa: de um ponto a outro" description="Precisa enviar um documento, uma encomenda ou um presente? Não é preciso comprar nada." />
        <FeatureGrid
          items={[
            { icon: <MapPinned className="h-6 w-6" />, title: 'Origem e destino', text: 'Informe os endereços, o tipo de item, o peso aproximado e as dimensões.' },
            { icon: <ArrowRightLeft className="h-6 w-6" />, title: 'Cotação na hora', text: 'O valor considera distância, tempo, tipo de veículo e condições do momento.' },
            { icon: <PackageCheck className="h-6 w-6" />, title: 'Prova de entrega', text: 'O destinatário confirma com código, QR code, foto ou assinatura digital.' },
          ]}
        />
      </Section>

      <Section>
        <SectionTitle eyebrow="Para empresas" title="Logística para o seu negócio" />
        <FeatureGrid
          items={[
            { icon: <ShoppingBag className="h-6 w-6" />, title: 'Venda online', text: 'Catálogo, estoque, promoções e pedidos em tempo real no portal da empresa.' },
            { icon: <Route className="h-6 w-6" />, title: 'Entregas em lote', text: 'Importe dezenas de entregas por planilha ou API, com rotas otimizadas.' },
            { icon: <Building2 className="h-6 w-6" />, title: 'Frota própria', text: 'Use os entregadores da plataforma, sua própria frota ou os dois.' },
          ]}
        />
      </Section>
    </>
  );
}
