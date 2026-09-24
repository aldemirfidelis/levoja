'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { formatBRL } from '@levoja/shared';
import { api, buildQuery, useApi } from '@levoja/web-kit/client';
import { Card, ColumnChart, DataTable, ErrorState, Input, PageHeader, Select, Skeleton, StatCard, Tabs } from '@levoja/web-kit/ui';
import { CompanyPicker } from '@/components/company-picker';
import { CityOption } from '@/components/operations-nav';
import { useUrlFilters } from '@/components/list-filters';
import { useSession } from '@/lib/session';

type Kind = 'commercial' | 'operational' | 'financial' | 'drivers' | 'corporate';
type ColumnType = 'text' | 'int' | 'money' | 'percent' | 'minutes' | 'decimal';
type Row = Record<string, string | number | null>;

interface Report {
  title: string;
  range: { from: string; to: string; granularity: 'day' | 'week' | 'month'; timeZone: string };
  summary: { key: string; label: string; type: ColumnType; value: number | null }[];
  series: { buckets: string[]; lines: { key: string; label: string; type: ColumnType; values: number[] }[] };
  tables: Record<string, { title: string; columns: { key: string; label: string; type: ColumnType }[]; rows: Row[] }>;
}

const KINDS: { value: Kind; label: string; permission: string }[] = [
  { value: 'commercial', label: 'Comercial', permission: 'reports.read' },
  { value: 'operational', label: 'Operacional', permission: 'reports.read' },
  { value: 'financial', label: 'Financeiro', permission: 'finance.reports' },
  { value: 'drivers', label: 'Entregadores', permission: 'reports.read' },
  { value: 'corporate', label: 'Corporativo (por empresa)', permission: 'reports.read' },
];

const PRESETS = [
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
  { value: 'mtd', label: 'Este mês' },
  { value: 'custom', label: 'Personalizado' },
];

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Valor formatado pelo tipo da métrica. */
function formatValue(value: number | string | null | undefined, type: ColumnType): string {
  if (value == null || value === '') return '—';
  if (type === 'text') return String(value);
  const number = Number(value);
  switch (type) {
    case 'money':
      return formatBRL(number);
    case 'percent':
      return `${number.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
    case 'minutes':
      return `${number.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min`;
    case 'decimal':
      return number.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    default:
      return Math.round(number).toLocaleString('pt-BR');
  }
}

/** Formato compacto para o eixo (R$ 12,5 mil). */
function axisFormat(type: ColumnType) {
  return (value: number) => {
    if (type === 'money') {
      const reais = value / 100;
      return Math.abs(reais) >= 1000 ? `R$ ${(reais / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : `R$ ${reais.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
    }
    if (type === 'percent') return `${value}%`;
    return Math.abs(value) >= 1000 ? `${(value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : value.toLocaleString('pt-BR');
  };
}

function bucketLabel(bucket: string, granularity: Report['range']['granularity'], long = false) {
  const [year, month, day] = bucket.split('-');
  if (granularity === 'month') return long ? `${MONTHS[Number(month) - 1]} de ${year}` : `${MONTHS[Number(month) - 1]}/${year.slice(2)}`;
  if (granularity === 'week') return long ? `Semana de ${day}/${month}/${year}` : `${day}/${month}`;
  return long ? `${day}/${month}/${year}` : `${day}/${month}`;
}

const localDate = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date);

function rangeOf(preset: string, from: string, to: string): { from?: string; to?: string } {
  const today = new Date();
  if (preset === 'custom') return { from: from || undefined, to: to || undefined };
  if (preset === 'mtd') return { from: `${localDate(today).slice(0, 8)}01`, to: localDate(today) };
  const days = Number(preset) || 30;
  return { from: localDate(new Date(today.getTime() - (days - 1) * 86_400_000)), to: localDate(today) };
}

function ReportsView() {
  const { can } = useSession();
  const kinds = KINDS.filter((kind) => can(kind.permission));
  const [filters, setFilters] = useUrlFilters({
    kind: kinds[0]?.value ?? 'commercial',
    preset: '30',
    from: '',
    to: '',
    granularity: '',
    city: '',
    segmentId: '',
    companyId: '',
    companyName: '',
  });
  const kind = (kinds.some((item) => item.value === filters.kind) ? filters.kind : kinds[0]?.value) as Kind;
  const range = rangeOf(filters.preset, filters.from, filters.to);
  const usesCompany = kind !== 'drivers';
  const query = {
    ...range,
    granularity: filters.granularity || undefined,
    city: filters.city || undefined,
    segmentId: kind === 'commercial' || kind === 'operational' ? filters.segmentId || undefined : undefined,
    companyId: usesCompany ? filters.companyId || undefined : undefined,
  };
  const { data: cities } = useApi<CityOption[]>(can('operations.view') ? 'admin/operations/cities' : null);
  const { data: segments } = useApi<{ id: string; name: string }[]>('segments');
  const needsCompany = kind === 'corporate' && !filters.companyId;
  const { data, error, isLoading, isFetching, refetch } = useApi<Report>(kind && !needsCompany ? `admin/reports/${kind}` : null, query, { placeholderData: (previous) => previous });

  const [metric, setMetric] = useState('');
  useEffect(() => setMetric(''), [kind]);
  const line = useMemo(() => data?.series.lines.find((item) => item.key === metric) ?? data?.series.lines[0], [data, metric]);

  if (!kinds.length) return <ErrorState error={new Error('Sem permissão para relatórios.')} />;
  const csvUrl = (table: string) => api.fileUrl(`admin/reports/${kind}${buildQuery({ ...query, format: 'csv', table })}`);

  return (
    <>
      <PageHeader title="Relatórios" description={data ? `${data.title} · ${bucketLabel(data.range.from, 'day', true)} a ${bucketLabel(data.range.to, 'day', true)} (horário de Brasília)` : 'Indicadores comerciais, operacionais, financeiros e de entregadores.'} />
      <Tabs value={kind} onChange={(value) => setFilters({ kind: value })} items={kinds.map((item) => ({ value: item.value, label: item.label }))} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Select label="Período" value={filters.preset} onChange={(event) => setFilters({ preset: event.target.value })} options={PRESETS} />
        {filters.preset === 'custom' && (
          <div className="flex gap-2">
            <Input label="De" type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => setFilters({ from: event.target.value })} />
            <Input label="Até" type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => setFilters({ to: event.target.value })} />
          </div>
        )}
        <Select
          label="Agrupar por"
          value={filters.granularity}
          onChange={(event) => setFilters({ granularity: event.target.value })}
          options={[
            { value: '', label: 'Automático' },
            { value: 'day', label: 'Dia' },
            { value: 'week', label: 'Semana' },
            { value: 'month', label: 'Mês' },
          ]}
        />
        {kind !== 'financial' && kind !== 'corporate' && (
          <Select
            label="Cidade"
            value={filters.city}
            onChange={(event) => setFilters({ city: event.target.value })}
            options={[{ value: '', label: 'Todas' }, ...(cities ?? []).map((item) => ({ value: item.city, label: item.state ? `${item.city}/${item.state}` : item.city }))]}
          />
        )}
        {(kind === 'commercial' || kind === 'operational') && (
          <Select label="Segmento" value={filters.segmentId} onChange={(event) => setFilters({ segmentId: event.target.value })} options={[{ value: '', label: 'Todos' }, ...(segments ?? []).map((item) => ({ value: item.id, label: item.name }))]} />
        )}
        {usesCompany && (
          <CompanyPicker
            label="Empresa"
            value={filters.companyId ? { id: filters.companyId, name: filters.companyName || 'Empresa selecionada' } : null}
            onChange={(company) => setFilters({ companyId: company?.id ?? '', companyName: company?.name ?? '' })}
          />
        )}
      </div>

      {needsCompany && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">Escolha a empresa para ver o relatório corporativo (entregas, gasto, prazo e centros de custo).</p>}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {isLoading && !needsCompany && <Skeleton className="h-96" />}
      {data && !needsCompany && (
        <div className={`space-y-6 transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {data.summary.map((item) => (
              <StatCard key={item.key} label={item.label} value={formatValue(item.value, item.type)} />
            ))}
          </div>

          {line && (
            <Card
              title="Evolução"
              actions={
                <Select
                  aria-label="Indicador do gráfico"
                  className="w-56"
                  value={line.key}
                  onChange={(event) => setMetric(event.target.value)}
                  options={data.series.lines.map((item) => ({ value: item.key, label: item.label }))}
                />
              }
            >
              <ColumnChart
                title={`${line.label} por ${data.range.granularity === 'day' ? 'dia' : data.range.granularity === 'week' ? 'semana' : 'mês'}`}
                labels={data.series.buckets.map((bucket) => bucketLabel(bucket, data.range.granularity))}
                tooltipLabel={(index) => `${line.label} · ${bucketLabel(data.series.buckets[index], data.range.granularity, true)}`}
                values={line.values}
                format={axisFormat(line.type)}
                height={260}
              />
            </Card>
          )}

          {Object.entries(data.tables).map(([key, table]) => (
            <Card
              key={key}
              title={table.title}
              actions={
                <a href={csvUrl(key)} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline" download>
                  <Download className="h-4 w-4" aria-hidden /> CSV
                </a>
              }
            >
              {table.rows.length === 0 ? (
                <p className="text-sm text-muted">Sem dados no período.</p>
              ) : (
                <div className="max-h-[480px] overflow-y-auto">
                  <DataTable<Row>
                    rows={table.rows}
                    rowKey={(row) => String(row.id ?? row[table.columns[0].key] ?? JSON.stringify(row))}
                    columns={table.columns.map((column, index) => ({
                      key: column.key,
                      header: column.label,
                      className: column.type === 'text' ? undefined : 'text-right tabular-nums',
                      hideOnMobile: index > 3,
                      cell: (row) => (key === 'series' && column.key === 'bucket' ? bucketLabel(String(row.bucket), data.range.granularity, true) : formatValue(row[column.key], column.type)),
                    }))}
                  />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export default function ReportsPage() {
  return (
    <Suspense>
      <ReportsView />
    </Suspense>
  );
}
