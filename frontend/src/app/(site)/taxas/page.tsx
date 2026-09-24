import type { Metadata } from 'next';
import { PageHero, Section, SectionTitle } from '@/components/marketing';

export const metadata: Metadata = { title: 'Taxas' };

const ROWS = [
  { item: 'Valor da entrega', who: 'Cliente (ou a empresa, em frete grátis)', how: 'Valor base + distância (km) + adicionais do momento, como horário, chuva ou alta demanda. Sempre exibido antes da confirmação.' },
  { item: 'Taxa de serviço', who: 'Cliente', how: 'Percentual ou valor fixo que mantém a plataforma, o suporte e a segurança das transações.' },
  { item: 'Comissão sobre vendas', who: 'Empresa', how: 'Percentual sobre o valor dos produtos, conforme o plano contratado.' },
  { item: 'Repasse ao entregador', who: 'Entregador recebe', how: 'Valor base + km + adicionais por região, horário e demanda. Gorjetas vão integralmente para o entregador.' },
];

export default function FeesPage() {
  return (
    <>
      <PageHero
        eyebrow="Transparência"
        title="Como funcionam as taxas"
        description="Os valores variam por cidade, região e momento, e são sempre mostrados antes de qualquer confirmação — nada de surpresas."
      />
      <Section>
        <SectionTitle title="Composição dos valores" />
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-3">Item</th>
                <th className="px-5 py-3">Quem paga</th>
                <th className="px-5 py-3">Como é calculado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ROWS.map((row) => (
                <tr key={row.item}>
                  <td className="px-5 py-4 font-semibold text-fg">{row.item}</td>
                  <td className="px-5 py-4 text-muted">{row.who}</td>
                  <td className="px-5 py-4 text-muted">{row.how}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-6 text-sm text-muted">
          Empresas encontram os percentuais exatos do seu plano no portal (Financeiro). Entregadores veem o valor de cada entrega na oferta, antes de aceitar.
        </p>
      </Section>
    </>
  );
}
