'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useApi } from '@levoja/web-kit/client';
import { Card, ColumnChart, ErrorState, HeatLegend, PageHeader, Select, Skeleton, StatCard } from '@levoja/web-kit/ui';
import type { HeatCell } from '@levoja/web-kit/map';
import { CityOption, OperationsNav } from '@/components/operations-nav';
import { useUrlFilters } from '@/components/list-filters';

const HeatMap = dynamic(() => import('@levoja/web-kit/map').then((module) => module.HeatMap), { ssr: false, loading: () => <div className="h-[480px] rounded-xl bg-surface-2" /> });

interface Heatmap {
  layer: string;
  unit: string;
  total: number | null;
  max: number;
  cells: (HeatCell & { lat: number; lng: number })[];
  byHour: number[];
}

const LAYERS = [
  { value: 'demand', label: 'Demanda (coletas solicitadas)' },
  { value: 'orders', label: 'Pedidos (endereço do cliente)' },
  { value: 'deliveries', label: 'Entregas concluídas (destino)' },
  { value: 'drivers', label: 'Disponibilidade de entregadores' },
];
const PERIODS = [
  { value: 'today', label: 'Hoje' },
  { value: 'week', label: 'Últimos 7 dias' },
  { value: 'month', label: 'Últimos 30 dias' },
];
const PRECISIONS = [
  { value: 'fine', label: 'Quadras (~275 m)' },
  { value: 'medium', label: 'Bairros (~550 m)' },
  { value: 'coarse', label: 'Regiões (~1,1 km)' },
];
const HOURS = [{ value: '', label: 'Qualquer hora' }, ...Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: `${String(hour).padStart(2, '0')}h` }))];

function HeatmapView() {
  const [filters, setFilters] = useUrlFilters({ layer: 'demand', period: 'week', precision: 'medium', fromHour: '', toHour: '', city: '' });
  const { data: cities } = useApi<CityOption[]>('admin/operations/cities');
  const { data, error, isLoading, isFetching, refetch } = useApi<Heatmap>('admin/operations/heatmap', filters, { placeholderData: (previous) => previous });
  const drivers = filters.layer === 'drivers';
  const format = (value: number) => (drivers ? value.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : Math.round(value).toLocaleString('pt-BR'));
  const peakHour = data ? data.byHour.indexOf(Math.max(...data.byHour)) : -1;

  return (
    <>
      <PageHeader title="Operação" description="Onde e quando a demanda e a oferta de entregadores acontecem." />
      <OperationsNav />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Select aria-label="Camada" className="xl:col-span-2" value={filters.layer} onChange={(event) => setFilters({ layer: event.target.value })} options={LAYERS} />
        <Select aria-label="Período" value={filters.period} onChange={(event) => setFilters({ period: event.target.value })} options={PERIODS} />
        <Select
          aria-label="Cidade"
          value={filters.city}
          onChange={(event) => setFilters({ city: event.target.value })}
          options={[{ value: '', label: 'Todas as cidades' }, ...(cities ?? []).map((item) => ({ value: item.city, label: item.state ? `${item.city}/${item.state}` : item.city }))]}
          disabled={drivers}
        />
        <div className="flex gap-2">
          <Select aria-label="Da hora" value={filters.fromHour} onChange={(event) => setFilters({ fromHour: event.target.value })} options={HOURS} />
          <Select aria-label="Até a hora" value={filters.toHour} onChange={(event) => setFilters({ toHour: event.target.value })} options={HOURS} />
        </div>
        <Select aria-label="Tamanho da célula" value={filters.precision} onChange={(event) => setFilters({ precision: event.target.value })} options={PRECISIONS} />
      </div>
      {drivers && <p className="-mt-3 mb-4 text-xs text-muted">A disponibilidade vem de amostras agregadas a cada 5 minutos (sem identificar entregadores); o recorte é feito pelo mapa, não pela cidade.</p>}

      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {isLoading && <Skeleton className="h-[480px]" />}
      {data && (
        <div className={`space-y-6 transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label={drivers ? 'Pico médio por célula' : 'Total no período'} value={format(drivers ? data.max : (data.total ?? 0))} hint={data.unit} />
            <StatCard label="Células com atividade" value={data.cells.length.toLocaleString('pt-BR')} />
            <StatCard label="Horário de pico" value={peakHour >= 0 && data.byHour[peakHour] > 0 ? `${String(peakHour).padStart(2, '0')}h` : '—'} />
          </div>
          <Card title="Mapa de calor">
            {data.cells.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted">Sem dados para os filtros escolhidos.</p>
            ) : (
              <>
                <HeatMap cells={data.cells} max={data.max} format={(value) => `${format(value)} · ${data.unit}`} fitKey={`${filters.layer}|${filters.city}|${filters.period}`} />
                <div className="mt-3">
                  <HeatLegend max={data.max} format={format} unit={data.unit} />
                </div>
              </>
            )}
          </Card>
          <Card title="Distribuição por hora do dia">
            <ColumnChart
              title={`${data.unit} por hora do dia`}
              labels={data.byHour.map((_, hour) => `${String(hour).padStart(2, '0')}h`)}
              values={data.byHour}
              format={format}
              tooltipLabel={(hour) => `${String(hour).padStart(2, '0')}h–${String(hour).padStart(2, '0')}h59 · ${data.unit}`}
            />
          </Card>
        </div>
      )}
    </>
  );
}

export default function HeatmapPage() {
  return (
    <Suspense>
      <HeatmapView />
    </Suspense>
  );
}
