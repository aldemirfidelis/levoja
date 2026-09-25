'use client';

import { useState } from 'react';
import { formatBRL } from '@levoja/shared';
import { useApi } from '@levoja/web-kit/client';
import { BarList, Card, ColumnChart, Select, Skeleton, StatCard, Tabs } from '@levoja/web-kit/ui';
import { PlanAwareError } from '@/components/plan-gate';

type Period = 'today' | 'week' | 'month';

interface CompanyDashboardData {
  sales: { gmvCents: number; productSalesCents: number; averageTicketCents: number | null };
  orders: { received: number; sold: number; inProgress: number; completed: number; canceled: number };
  finance: { netRevenueCents: number; salesCents: number; feesCents: number; commissionCents: number; discountsCents: number };
  rates: { acceptance: number | null; cancellation: number | null; conversion: number | null; storeVisits: number };
  times: { avgPrepMinutes: number | null; avgDeliveryMinutes: number | null };
  rating: { average: number | null; count: number; periodAverage: number | null; periodCount: number };
  topProducts: { product: string; quantity: number; revenue: number }[];
  series: { unit: 'hour' | 'day'; buckets: string[]; orders: number[]; gmv: number[] };
}

const pct = (value: number | null) => (value == null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const min = (value: number | null) => (value == null ? '—' : `${Math.round(value)} min`);
const compactBRL = (cents: number) => {
  const reais = cents / 100;
  return Math.abs(reais) >= 1000 ? `R$ ${(reais / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : `R$ ${reais.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
};

/** Indicadores da loja: vendas, pedidos, receita, taxas, avaliações, tempos, conversão e mais vendidos. */
export function CompanyDashboard({ companyId }: { companyId: string }) {
  const [period, setPeriod] = useState<Period>('today');
  const [metric, setMetric] = useState<'orders' | 'gmv'>('orders');
  const { data, error, isLoading, isFetching, refetch } = useApi<CompanyDashboardData>(`companies/${companyId}/dashboard`, { period }, { refetchInterval: period === 'today' ? 60_000 : false, placeholderData: (previous) => previous });

  const label = (bucket: string) => (data?.series.unit === 'hour' ? `${bucket}h` : `${bucket.slice(8, 10)}/${bucket.slice(5, 7)}`);
  return (
    <section aria-label="Indicadores da loja">
      <Tabs
        value={period}
        onChange={setPeriod}
        items={[
          { value: 'today', label: 'Hoje' },
          { value: 'week', label: 'Últimos 7 dias' },
          { value: 'month', label: 'Últimos 30 dias' },
        ]}
      />
      {error && <PlanAwareError error={error} onRetry={() => refetch()} />}
      {isLoading && <Skeleton className="h-64" />}
      {data && (
        <div className={`space-y-6 transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Vendas" value={formatBRL(data.sales.gmvCents)} hint={`Ticket médio ${data.sales.averageTicketCents == null ? '—' : formatBRL(data.sales.averageTicketCents)}`} />
            <StatCard label="Pedidos" value={data.orders.sold} hint={`${data.orders.inProgress} em andamento · ${data.orders.completed} concluído(s)`} />
            <StatCard label="Cancelamentos" value={data.orders.canceled} tone={data.orders.canceled ? 'warning' : 'neutral'} hint={`${pct(data.rates.cancellation)} dos pedidos recebidos`} />
            <StatCard label="Receita líquida" value={formatBRL(data.finance.netRevenueCents)} hint={`Taxas e comissão ${formatBRL(data.finance.feesCents)}`} />
            <StatCard
              label="Avaliação"
              value={data.rating.average == null ? '—' : `${data.rating.average.toLocaleString('pt-BR')} ★`}
              hint={data.rating.periodCount ? `${data.rating.periodCount} no período (média ${data.rating.periodAverage?.toLocaleString('pt-BR')})` : `${data.rating.count} avaliação(ões) no total`}
            />
            <StatCard label="Tempo médio de preparo" value={min(data.times.avgPrepMinutes)} hint="Do aceite até pronto" />
            <StatCard label="Tempo médio de entrega" value={min(data.times.avgDeliveryMinutes)} hint="Do pedido até a entrega" />
            <StatCard label="Conversão" value={pct(data.rates.conversion)} hint={`${data.rates.storeVisits.toLocaleString('pt-BR')} visita(s) à loja · aceite ${pct(data.rates.acceptance)}`} />
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <Card
              className="lg:col-span-2"
              title={metric === 'orders' ? 'Pedidos' : 'Vendas'}
              actions={
                <Select
                  aria-label="Indicador do gráfico"
                  value={metric}
                  onChange={(event) => setMetric(event.target.value as 'orders' | 'gmv')}
                  options={[
                    { value: 'orders', label: 'Pedidos' },
                    { value: 'gmv', label: 'Vendas (R$)' },
                  ]}
                />
              }
            >
              <ColumnChart
                title={`${metric === 'orders' ? 'Pedidos' : 'Vendas'} por ${data.series.unit === 'hour' ? 'hora' : 'dia'}`}
                labels={data.series.buckets.map(label)}
                values={metric === 'orders' ? data.series.orders : data.series.gmv}
                format={metric === 'orders' ? (value) => value.toLocaleString('pt-BR') : compactBRL}
                tooltipLabel={(index) => (data.series.unit === 'hour' ? `${data.series.buckets[index]}h–${data.series.buckets[index]}h59` : label(data.series.buckets[index]))}
              />
            </Card>
            <Card title="Mais vendidos">
              {data.topProducts.length === 0 ? (
                <p className="text-sm text-muted">Nenhuma venda no período.</p>
              ) : (
                <BarList title="Produtos mais vendidos por faturamento" rows={data.topProducts.map((item) => ({ label: item.product, value: item.revenue, hint: `${item.quantity} unidade(s)` }))} format={formatBRL} />
              )}
            </Card>
          </div>
        </div>
      )}
    </section>
  );
}
