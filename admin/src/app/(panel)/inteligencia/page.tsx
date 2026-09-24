'use client';

import { Suspense, useState } from 'react';
import { RefreshCw, TrendingUp } from 'lucide-react';
import { api, useApi } from '@levoja/web-kit/client';
import { Button, Card, ComparisonChart, EmptyState, ErrorState, formatDateTime, PageHeader, Select, Skeleton, StatCard, useToast } from '@levoja/web-kit/ui';
import { IntelligenceNav, percent } from '@/components/intelligence-nav';
import { useUrlFilters } from '@/components/list-filters';

interface ForecastPoint {
  hourStart: string;
  predicted: number;
  low: number;
  high: number;
  driversNeeded: number;
  driversExpected: number | null;
  actual: number | null;
  driversOnline: number | null;
}

interface ForecastView {
  cities: { key: string; label: string; deliveries: number }[];
  city: string | null;
  generatedAt: string | null;
  series: ForecastPoint[];
  accuracy: { hours: number; actual: number; wape: number | null; bias: number | null; withinInterval: number | null } | null;
  next24h: { deliveries: number; peakHour: string | null; peakDrivers: number; shortHours: number } | null;
}

const hourLabel = (value: string) => `${new Date(value).getHours()}h`;
const hourTooltip = (value: string) => new Date(value).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const count = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

function ForecastPage() {
  const toast = useToast();
  const [filters, setFilters] = useUrlFilters({ city: '' });
  const { data, error, isLoading, refetch } = useApi<ForecastView>('admin/intelligence/forecast', { city: filters.city });
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ cities: number; forecasts: number }>('admin/intelligence/forecast/run');
      toast.success(`Previsão recalculada: ${result.forecasts} hora(s) em ${result.cities} cidade(s).`);
      await refetch();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const now = Date.now();
  const series = data?.series ?? [];
  const firstFuture = series.findIndex((point) => new Date(point.hourStart).getTime() + 3_600_000 > now);
  const short = series.filter((point) => new Date(point.hourStart).getTime() >= now - 3_600_000 && point.driversExpected != null && point.driversNeeded > point.driversExpected);

  return (
    <>
      <PageHeader
        title="Inteligência"
        description="Previsão de entregas por hora e da necessidade de entregadores, a partir do histórico das últimas semanas (mesma hora e dia da semana, com tendência)."
        actions={
          <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={busy} onClick={() => void run()}>
            Recalcular agora
          </Button>
        }
      />
      <IntelligenceNav />
      {isLoading && <Skeleton className="h-96" />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && !data.city && (
        <EmptyState icon={<TrendingUp className="h-8 w-8" />} title="Sem histórico ainda" description="A previsão começa depois das primeiras semanas de entregas. Ela é recalculada a cada hora." />
      )}
      {data?.city && (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <Select
              label="Cidade"
              className="w-64"
              value={data.city}
              onChange={(event) => setFilters({ city: event.target.value })}
              options={data.cities.map((city) => ({ value: city.key, label: `${city.label} (${city.deliveries.toLocaleString('pt-BR')})` }))}
            />
            <p className="pb-2 text-xs text-muted">Atualizada em {formatDateTime(data.generatedAt)} · recalculada a cada hora.</p>
          </div>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Entregas previstas (24 h)" value={count(data.next24h?.deliveries ?? 0)} />
            <StatCard
              label="Pico previsto"
              value={data.next24h?.peakHour ? hourLabel(data.next24h.peakHour) : '—'}
              hint={data.next24h?.peakHour ? `${data.next24h.peakDrivers} entregador(es) necessários` : undefined}
            />
            <StatCard label="Horas com falta prevista" value={data.next24h?.shortHours ?? 0} tone={data.next24h?.shortHours ? 'warning' : 'neutral'} hint="Necessários acima do habitual online" />
            <StatCard
              label="Erro da previsão (7 dias)"
              value={percent(data.accuracy?.wape)}
              hint={data.accuracy?.withinInterval != null ? `${percent(data.accuracy.withinInterval)} das horas dentro do intervalo` : 'Ainda sem horas encerradas'}
            />
          </div>
          <div className="grid gap-6">
            <Card title="Entregas por hora">
              <ComparisonChart
                title="Entregas previstas por hora, com intervalo de 80% e o realizado nas horas encerradas"
                points={series.map((point) => ({
                  label: hourLabel(point.hourStart),
                  tooltip: hourTooltip(point.hourStart),
                  value: point.predicted,
                  low: point.low,
                  high: point.high,
                  marker: point.actual,
                }))}
                format={count}
                valueLabel="Previsto"
                intervalLabel="Intervalo (80%)"
                markerLabel="Realizado"
                dividerIndex={firstFuture > 0 ? firstFuture : undefined}
              />
            </Card>
            <Card title="Entregadores por hora">
              <ComparisonChart
                title="Entregadores necessários por hora comparados aos online (real no passado, habitual no futuro)"
                points={series.map((point) => {
                  const past = new Date(point.hourStart).getTime() + 3_600_000 <= now;
                  return {
                    label: hourLabel(point.hourStart),
                    tooltip: hourTooltip(point.hourStart),
                    value: point.driversNeeded,
                    marker: past ? (point.driversOnline ?? point.driversExpected) : point.driversExpected,
                  };
                })}
                format={count}
                valueLabel="Necessários"
                markerLabel="Online (real / habitual)"
                dividerIndex={firstFuture > 0 ? firstFuture : undefined}
              />
            </Card>
            {short.length > 0 && (
              <Card title="Horas com falta prevista de entregadores">
                <ul className="divide-y divide-border text-sm">
                  {short.map((point) => (
                    <li key={point.hourStart} className="flex flex-wrap justify-between gap-2 py-2">
                      <span className="text-fg">{hourTooltip(point.hourStart)}</span>
                      <span className="tabular-nums text-muted">
                        {point.driversNeeded} necessários · {count(point.driversExpected ?? 0)} habituais · {count(point.predicted)} entregas
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted">Quando a falta passa do limite configurado, uma sugestão de adicional aparece em Preço dinâmico para aprovação.</p>
              </Card>
            )}
          </div>
        </>
      )}
    </>
  );
}

export default function IntelligencePage() {
  return (
    <Suspense>
      <ForecastPage />
    </Suspense>
  );
}
