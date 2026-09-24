'use client';

import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { formatBRL } from '@levoja/shared';
import { ColumnChart } from './charts';
import { Card, Select } from './primitives';
import { DataTable, StatCard } from './data';

export type ReportColumnType = 'text' | 'int' | 'money' | 'percent' | 'minutes' | 'decimal';
type Row = Record<string, string | number | null>;

export interface ReportData {
  title: string;
  range: { from: string; to: string; granularity: 'day' | 'week' | 'month'; timeZone: string };
  summary: { key: string; label: string; type: ReportColumnType; value: number | null }[];
  series: { buckets: string[]; lines: { key: string; label: string; type: ReportColumnType; values: number[] }[] };
  tables: Record<string, { title: string; columns: { key: string; label: string; type: ReportColumnType }[]; rows: Row[] }>;
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Valor formatado pelo tipo da métrica (relatórios). */
export function formatReportValue(value: number | string | null | undefined, type: ReportColumnType): string {
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

function axisFormat(type: ReportColumnType) {
  return (value: number) => {
    if (type === 'money') {
      const reais = value / 100;
      return Math.abs(reais) >= 1000 ? `R$ ${(reais / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : `R$ ${reais.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
    }
    if (type === 'percent') return `${value}%`;
    return Math.abs(value) >= 1000 ? `${(value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : value.toLocaleString('pt-BR');
  };
}

export function reportBucketLabel(bucket: string, granularity: ReportData['range']['granularity'], long = false) {
  const [year, month, day] = bucket.split('-');
  if (granularity === 'month') return long ? `${MONTHS[Number(month) - 1]} de ${year}` : `${MONTHS[Number(month) - 1]}/${year.slice(2)}`;
  if (granularity === 'week') return long ? `Semana de ${day}/${month}/${year}` : `${day}/${month}`;
  return long ? `${day}/${month}/${year}` : `${day}/${month}`;
}

/** Relatório (indicadores, gráfico de um indicador por vez e tabelas com exportação CSV). */
export function ReportView({ report, csvUrl, faded }: { report: ReportData; csvUrl: (table: string) => string; faded?: boolean }) {
  const [metric, setMetric] = useState('');
  const line = useMemo(() => report.series.lines.find((item) => item.key === metric) ?? report.series.lines[0], [report, metric]);
  const granularity = report.range.granularity;
  return (
    <div className={`space-y-6 transition-opacity ${faded ? 'opacity-60' : ''}`}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {report.summary.map((item) => (
          <StatCard key={item.key} label={item.label} value={formatReportValue(item.value, item.type)} />
        ))}
      </div>
      {line && (
        <Card
          title="Evolução"
          actions={<Select aria-label="Indicador do gráfico" className="w-56" value={line.key} onChange={(event) => setMetric(event.target.value)} options={report.series.lines.map((item) => ({ value: item.key, label: item.label }))} />}
        >
          <ColumnChart
            title={`${line.label} por ${granularity === 'day' ? 'dia' : granularity === 'week' ? 'semana' : 'mês'}`}
            labels={report.series.buckets.map((bucket) => reportBucketLabel(bucket, granularity))}
            tooltipLabel={(index) => `${line.label} · ${reportBucketLabel(report.series.buckets[index], granularity, true)}`}
            values={line.values}
            format={axisFormat(line.type)}
            height={240}
          />
        </Card>
      )}
      {Object.entries(report.tables).map(([key, table]) => (
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
            <div className="max-h-[420px] overflow-y-auto">
              <DataTable<Row>
                rows={table.rows}
                rowKey={(row) => String(row.id ?? row[table.columns[0].key] ?? JSON.stringify(row))}
                columns={table.columns.map((column, index) => ({
                  key: column.key,
                  header: column.label,
                  className: column.type === 'text' ? undefined : 'text-right tabular-nums',
                  hideOnMobile: index > 3,
                  cell: (row) => (key === 'series' && column.key === 'bucket' ? reportBucketLabel(String(row.bucket), granularity, true) : formatReportValue(row[column.key], column.type)),
                }))}
              />
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
