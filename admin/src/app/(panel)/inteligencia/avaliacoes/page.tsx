'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Star } from 'lucide-react';
import { REVIEW_THEME_LABELS, type ReviewTheme } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { BarList, Button, Card, ColumnChart, EmptyState, ErrorState, PageHeader, Select, Skeleton, StatCard, useToast } from '@levoja/web-kit/ui';
import { IntelligenceNav, percent } from '@/components/intelligence-nav';
import { useUrlFilters } from '@/components/list-filters';

interface ReviewSummary {
  days: number;
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  pending: number;
  themes: { theme: ReviewTheme; total: number; negative: number }[];
  weekly: { week: string; total: number; negative: number; rating: number }[];
}

const SUBJECTS = [
  { value: '', label: 'Todas as avaliações' },
  { value: 'COMPANY', label: 'Lojas' },
  { value: 'DRIVER', label: 'Entregadores' },
  { value: 'CUSTOMER', label: 'Clientes' },
];

function ReviewInsights() {
  const toast = useToast();
  const [filters, setFilters] = useUrlFilters({ subjectType: '', days: '90' });
  const { data, error, isLoading, refetch } = useApi<ReviewSummary>('admin/intelligence/reviews/summary', filters);
  const [busy, setBusy] = useState(false);

  const process = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ lexicon: number; ai: number }>('admin/intelligence/reviews/process');
      toast.success(`Análise concluída: ${result.lexicon} pelo léxico e ${result.ai} refinadas pela IA.`);
      await refetch();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const share = (value: number) => (data?.total ? percent(value / data.total) : '—');

  return (
    <>
      <PageHeader
        title="Inteligência"
        description="Sentimento e temas dos comentários. Cada avaliação é analisada na hora pelo léxico; com a IA ligada, os comentários são refinados em lotes. A nota e o texto originais nunca mudam."
        actions={
          <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={busy} onClick={() => void process()}>
            Analisar pendentes
          </Button>
        }
      />
      <IntelligenceNav />
      <div className="mb-4 flex flex-wrap gap-3">
        <Select aria-label="Avaliado" className="w-52" value={filters.subjectType} onChange={(event) => setFilters({ subjectType: event.target.value })} options={SUBJECTS} />
        <Select
          aria-label="Período"
          className="w-40"
          value={filters.days}
          onChange={(event) => setFilters({ days: event.target.value })}
          options={[
            { value: '30', label: '30 dias' },
            { value: '90', label: '90 dias' },
            { value: '180', label: '180 dias' },
          ]}
        />
      </div>
      {isLoading && <Skeleton className="h-96" />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.total === 0 && <EmptyState icon={<Star className="h-8 w-8" />} title="Nenhuma avaliação no período" />}
      {data && data.total > 0 && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Avaliações" value={data.total.toLocaleString('pt-BR')} hint={data.pending ? `${data.pending} aguardando análise` : undefined} />
            <StatCard label="Positivas" value={share(data.positive)} hint={`${data.positive} avaliação(ões)`} tone="success" />
            <StatCard label="Neutras" value={share(data.neutral)} hint={`${data.neutral} avaliação(ões)`} />
            <StatCard label="Negativas" value={share(data.negative)} hint={`${data.negative} avaliação(ões)`} tone={data.negative ? 'danger' : 'neutral'} />
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card
              title="Temas mais citados nas negativas"
              actions={
                <Link href="/avaliacoes?sentiment=NEGATIVE" className="text-sm text-brand-600 hover:underline">
                  Ver avaliações negativas
                </Link>
              }
            >
              {data.themes.filter((theme) => theme.negative > 0).length === 0 ? (
                <p className="text-sm text-muted">Nenhum tema recorrente nas avaliações negativas.</p>
              ) : (
                <BarList
                  title="Temas citados em avaliações negativas"
                  format={(value) => value.toLocaleString('pt-BR')}
                  rows={data.themes
                    .filter((theme) => theme.negative > 0)
                    .sort((a, b) => b.negative - a.negative)
                    .map((theme) => ({ label: REVIEW_THEME_LABELS[theme.theme] ?? theme.theme, value: theme.negative, hint: `${theme.total} menção(ões) no total` }))}
                />
              )}
            </Card>
            <Card title="Avaliações negativas por semana">
              <ColumnChart
                title="Quantidade de avaliações negativas por semana"
                labels={data.weekly.map((row) => row.week.split('-').reverse().slice(0, 2).join('/'))}
                values={data.weekly.map((row) => row.negative)}
                tooltipLabel={(index) => `Semana de ${data.weekly[index].week.split('-').reverse().join('/')} · ${data.weekly[index].total} avaliações · nota média ${data.weekly[index].rating.toLocaleString('pt-BR')}`}
                format={(value) => value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
              />
            </Card>
          </div>
        </>
      )}
    </>
  );
}

export default function ReviewInsightsPage() {
  return (
    <Suspense>
      <ReviewInsights />
    </Suspense>
  );
}
