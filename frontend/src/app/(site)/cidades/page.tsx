import type { Metadata } from 'next';
import { MapPin } from 'lucide-react';
import { PageHero, Section, SectionTitle } from '@/components/marketing';
import { WaitlistForm } from '@/components/public-scale';
import { publicApi } from '@/lib/bff';

export const metadata: Metadata = { title: 'Onde atendemos' };

interface PublicCity {
  name: string;
  state: string;
  status: 'ACTIVE' | 'PREPARING';
  statusLabel: string;
}

export default async function CitiesPage() {
  const cities = (await publicApi<PublicCity[]>('cities', 300)) ?? [];
  const active = cities.filter((city) => city.status === 'ACTIVE');
  const soon = cities.filter((city) => city.status === 'PREPARING');
  return (
    <>
      <PageHero eyebrow="Cidades" title="Onde atendemos" description="Estamos crescendo cidade a cidade. Veja onde já operamos e peça para ser avisado quando chegarmos à sua." />
      <Section>
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <SectionTitle title="Em operação" />
            {active.length === 0 ? (
              <p className="text-muted">Em breve divulgaremos as cidades atendidas.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {active.map((city) => (
                  <li key={`${city.name}-${city.state}`} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-fg">
                    <MapPin className="h-4 w-4 text-brand-500" aria-hidden /> {city.name}/{city.state}
                  </li>
                ))}
              </ul>
            )}
            {soon.length > 0 && (
              <>
                <h3 className="mt-8 text-lg font-semibold text-fg">Chegando em breve</h3>
                <p className="mt-1 text-sm text-muted">{soon.map((city) => `${city.name}/${city.state}`).join(' · ')}</p>
              </>
            )}
          </div>
          <div className="rounded-xl border border-border bg-surface p-6">
            <SectionTitle title="Ainda não chegamos aí?" description="Deixe seu e-mail: avisamos no lançamento. A lista de espera também nos ajuda a decidir as próximas cidades." />
            <WaitlistForm />
          </div>
        </div>
      </Section>
    </>
  );
}
