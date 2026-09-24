import type { Metadata } from 'next';
import { Bike, Car, Clock, Eye, ShieldCheck, Truck, Wallet } from 'lucide-react';
import { CtaLink, FeatureGrid, PageHero, Section, SectionTitle, Steps } from '@/components/marketing';

export const metadata: Metadata = { title: 'Para entregadores' };

export default function ForDriversPage() {
  return (
    <>
      <PageHero
        eyebrow="Para entregadores"
        title="Faça entregas no seu tempo"
        description="Bicicleta, moto, carro ou utilitário. Você escolhe quando ficar online e quais entregas aceitar."
      >
        <CtaLink href="/cadastro/entregador">Quero ser entregador</CtaLink>
        <CtaLink href="/entrar?next=/entregador" variant="secondary">
          Continuar meu cadastro
        </CtaLink>
      </PageHero>
      <Section>
        <SectionTitle title="Por que entregar com a gente" />
        <FeatureGrid
          items={[
            { icon: <Clock className="h-6 w-6" />, title: 'Liberdade de horário', text: 'Fique online quando quiser. Sem jornada fixa.' },
            { icon: <Eye className="h-6 w-6" />, title: 'Valor antes do aceite', text: 'Veja distância, destino aproximado e quanto vai ganhar antes de aceitar.' },
            { icon: <Wallet className="h-6 w-6" />, title: 'Ganhos via PIX', text: 'Acompanhe ganhos do dia, semana e mês, gorjetas incluídas, e saque pelo app.' },
            { icon: <ShieldCheck className="h-6 w-6" />, title: 'Segurança', text: 'Clientes e empresas verificados, suporte na palma da mão e chat sem expor seu telefone.' },
          ]}
        />
      </Section>
      <Section muted>
        <SectionTitle title="Requisitos" />
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface p-6">
            <p className="mb-3 flex items-center gap-2 font-bold">
              <Bike className="h-5 w-5 text-brand-500" /> Bicicleta
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              <li>18 anos ou mais</li>
              <li>Documento de identidade e selfie</li>
              <li>Comprovante de endereço</li>
              <li>Chave PIX em seu nome</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-6">
            <p className="mb-3 flex items-center gap-2 font-bold">
              <Car className="h-5 w-5 text-brand-500" /> Moto, carro ou <Truck className="h-5 w-5 text-brand-500" /> utilitário
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              <li>18 anos ou mais, com CNH válida na categoria do veículo</li>
              <li>Documento do veículo (CRLV) e placa</li>
              <li>Selfie e comprovante de endereço</li>
              <li>Chave PIX em seu nome</li>
            </ul>
          </div>
        </div>
      </Section>
      <Section>
        <SectionTitle title="Como começar" />
        <Steps
          items={[
            { title: 'Cadastre-se', text: 'Crie sua conta informando seus dados e o tipo de veículo.' },
            { title: 'Envie os documentos', text: 'Pelo portal ou pelo app do entregador. Nossa equipe analisa em até 2 dias úteis.' },
            { title: 'Fique online', text: 'Aprovado, é só tocar em "Ficar online" e começar a receber ofertas.' },
          ]}
        />
      </Section>
    </>
  );
}
