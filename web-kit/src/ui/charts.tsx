'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../utils';

/** Largura do contêiner (gráficos responsivos sem distorcer textos). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Escala "redonda" (0, 500, 1.000...) com 3 a 5 marcas. */
export function niceTicks(min: number, max: number): number[] {
  const span = Math.max(max - min, 1e-9);
  const raw = span / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => span / candidate <= 5) ?? 10 * power;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 2; value += step) ticks.push(Math.round(value * 1e6) / 1e6);
  return ticks;
}

/** Coluna com ponta de dados arredondada (4 px) e base reta. */
function columnPath(x: number, zeroY: number, valueY: number, width: number): string {
  const up = valueY <= zeroY;
  const height = Math.abs(zeroY - valueY);
  if (height < 0.5) return '';
  const r = Math.min(4, height, width / 2);
  if (up) {
    return `M${x},${zeroY} V${valueY + r} Q${x},${valueY} ${x + r},${valueY} H${x + width - r} Q${x + width},${valueY} ${x + width},${valueY + r} V${zeroY} Z`;
  }
  return `M${x},${zeroY} V${valueY - r} Q${x},${valueY} ${x + r},${valueY} H${x + width - r} Q${x + width},${valueY} ${x + width},${valueY - r} V${zeroY} Z`;
}

export interface ColumnChartProps {
  /** Rótulos do eixo X (um por coluna). */
  labels: string[];
  values: number[];
  /** Formata valores (eixo, rótulo e dica). */
  format: (value: number) => string;
  /** Rótulo completo na dica (padrão: o próprio rótulo). */
  tooltipLabel?: (index: number) => string;
  height?: number;
  /** Descrição acessível do gráfico. */
  title: string;
  className?: string;
}

/**
 * Gráfico de colunas de série única (SVG): colunas finas com ponta arredondada, grade discreta,
 * rótulo apenas no maior valor e dica ao passar o mouse ou focar pelo teclado.
 */
export function ColumnChart({ labels, values, format, tooltipLabel, height = 220, title, className }: ColumnChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const margin = { top: 22, right: 8, bottom: 26, left: 56 };
  const plotWidth = Math.max(0, width - margin.left - margin.right);
  const plotHeight = height - margin.top - margin.bottom;

  const scale = useMemo(() => {
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const ticks = niceTicks(min, max === min ? min + 1 : max);
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    return { ticks, y: (value: number) => margin.top + plotHeight - ((value - lo) / (hi - lo || 1)) * plotHeight };
  }, [values, plotHeight, margin.top]);

  const band = labels.length ? plotWidth / labels.length : 0;
  const barWidth = Math.max(2, Math.min(24, band - 2));
  const zeroY = scale.y(0);
  const maxIndex = values.length ? values.indexOf(Math.max(...values)) : -1;
  const labelEvery = Math.max(1, Math.ceil(labels.length / Math.max(1, Math.floor(plotWidth / 56))));

  return (
    <div ref={ref} className={cn('relative w-full select-none', className)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={title} className="block overflow-visible">
          {scale.ticks.map((tick) => (
            <g key={tick}>
              <line x1={margin.left} x2={margin.left + plotWidth} y1={scale.y(tick)} y2={scale.y(tick)} stroke="var(--lj-border)" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={margin.left - 8} y={scale.y(tick)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                {format(tick)}
              </text>
            </g>
          ))}
          {values.map((value, index) => {
            const x = margin.left + index * band + (band - barWidth) / 2;
            const y = scale.y(value);
            return (
              <g key={index}>
                <path d={columnPath(x, zeroY, y, barWidth)} fill="var(--lj-chart-1)" opacity={active == null || active === index ? 1 : 0.55} />
                {index === maxIndex && value > 0 && active == null && (
                  <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" className="fill-fg text-[11px] font-semibold">
                    {format(value)}
                  </text>
                )}
                {/* Área de toque maior que a coluna: toda a faixa. */}
                <rect
                  x={margin.left + index * band}
                  y={margin.top}
                  width={band}
                  height={plotHeight}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${tooltipLabel?.(index) ?? labels[index]}: ${format(value)}`}
                  onPointerEnter={() => setActive(index)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  className="outline-none"
                />
              </g>
            );
          })}
          <line x1={margin.left} x2={margin.left + plotWidth} y1={zeroY} y2={zeroY} stroke="var(--lj-muted)" strokeOpacity={0.5} strokeWidth={1} shapeRendering="crispEdges" />
          {labels.map((label, index) =>
            index % labelEvery === 0 ? (
              <text key={index} x={margin.left + index * band + band / 2} y={height - 8} textAnchor="middle" className="fill-muted text-[11px]">
                {label}
              </text>
            ) : null,
          )}
        </svg>
      )}
      {active != null && width > 0 && (
        <div
          role="status"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg"
          style={{
            left: Math.min(Math.max(margin.left + active * band + band / 2, 70), width - 70),
            top: Math.min(scale.y(values[active]), zeroY) - 8,
          }}
        >
          <p className="text-sm font-semibold text-fg tabular-nums">{format(values[active])}</p>
          <p className="text-muted">{tooltipLabel?.(active) ?? labels[active]}</p>
        </div>
      )}
    </div>
  );
}

/** Barras horizontais de série única (ranking): rótulo, barra e valor na ponta. */
export function BarList({ rows, format, title }: { rows: { label: string; value: number; hint?: string }[]; format: (value: number) => string; title: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="space-y-3" aria-label={title}>
      {rows.map((row) => (
        <li key={row.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-fg">{row.label}</span>
            <span className="shrink-0 font-semibold tabular-nums text-fg">{format(row.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full" style={{ width: `${(Math.max(0, row.value) / max) * 100}%`, background: 'var(--lj-chart-1)' }} />
          </div>
          {row.hint && <p className="mt-0.5 text-xs text-muted">{row.hint}</p>}
        </li>
      ))}
    </ul>
  );
}

/** Escala sequencial (um tom, claro → escuro) validada para o mapa de calor. */
export const HEAT_RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'] as const;

/** Índice da faixa da escala para um valor (0 = menor). */
export function heatStep(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(HEAT_RAMP.length - 1, Math.floor((value / max) * HEAT_RAMP.length));
}

/** Legenda da escala do mapa de calor (faixas com limites). */
export function HeatLegend({ max, format, unit }: { max: number; format: (value: number) => string; unit: string }) {
  const step = max / HEAT_RAMP.length;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted" aria-label={`Escala: ${unit}`}>
      <span>{unit}</span>
      <div className="flex">
        {HEAT_RAMP.map((color, index) => (
          <div key={color} className="flex flex-col items-start">
            <span className="block h-3 w-12" style={{ background: color, borderRadius: index === 0 ? '4px 0 0 4px' : index === HEAT_RAMP.length - 1 ? '0 4px 4px 0' : 0 }} />
            <span className="mt-0.5 tabular-nums">{format(step * index)}</span>
          </div>
        ))}
        <span className="mt-3.5 pl-1 tabular-nums">{format(max)}</span>
      </div>
    </div>
  );
}

export interface ComparisonPoint {
  /** Rótulo curto do eixo X. */
  label: string;
  /** Rótulo completo na dica. */
  tooltip: string;
  value: number;
  /** Intervalo de confiança da coluna (opcional). */
  low?: number;
  high?: number;
  /** Valor de comparação desenhado como ponto (ex.: realizado, entregadores habituais). */
  marker?: number | null;
}

/**
 * Colunas (série principal, ex.: previsão) com intervalo opcional e um ponto de comparação por
 * coluna (ex.: realizado). Marcas diferentes (coluna × ponto) + legenda: a identidade nunca
 * depende só da cor. `dividerIndex` desenha a linha "agora" entre passado e futuro.
 */
export function ComparisonChart({
  points,
  format,
  title,
  valueLabel,
  markerLabel,
  intervalLabel,
  dividerIndex,
  dividerLabel = 'agora',
  height = 240,
}: {
  points: ComparisonPoint[];
  format: (value: number) => string;
  title: string;
  valueLabel: string;
  markerLabel?: string;
  intervalLabel?: string;
  dividerIndex?: number;
  dividerLabel?: string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const margin = { top: 18, right: 8, bottom: 26, left: 48 };
  const plotWidth = Math.max(0, width - margin.left - margin.right);
  const plotHeight = height - margin.top - margin.bottom;
  const hasInterval = points.some((point) => point.high != null);
  const hasMarker = points.some((point) => point.marker != null);

  const scale = useMemo(() => {
    const max = Math.max(1, ...points.flatMap((point) => [point.value, point.high ?? 0, point.marker ?? 0]));
    const ticks = niceTicks(0, max);
    const hi = ticks[ticks.length - 1];
    return { ticks, y: (value: number) => margin.top + plotHeight - (value / (hi || 1)) * plotHeight };
  }, [points, plotHeight, margin.top]);

  const band = points.length ? plotWidth / points.length : 0;
  const barWidth = Math.max(2, Math.min(18, band - 3));
  const zeroY = scale.y(0);
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotWidth / 48))));
  const center = (index: number) => margin.left + index * band + band / 2;
  const current = active != null ? points[active] : null;

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-2 rounded-sm" style={{ background: 'var(--lj-chart-1)' }} /> {valueLabel}
        </span>
        {hasInterval && intervalLabel && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-0.5 rounded" style={{ background: 'var(--lj-fg)', opacity: 0.45 }} /> {intervalLabel}
          </span>
        )}
        {hasMarker && markerLabel && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: 'var(--lj-fg)' }} /> {markerLabel}
          </span>
        )}
      </div>
      <div ref={ref} className="relative w-full select-none">
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={title} className="block overflow-visible">
            {scale.ticks.map((tick) => (
              <g key={tick}>
                <line x1={margin.left} x2={margin.left + plotWidth} y1={scale.y(tick)} y2={scale.y(tick)} stroke="var(--lj-border)" strokeWidth={1} shapeRendering="crispEdges" />
                <text x={margin.left - 8} y={scale.y(tick)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                  {format(tick)}
                </text>
              </g>
            ))}
            {dividerIndex != null && dividerIndex > 0 && dividerIndex < points.length && (
              <g>
                <line
                  x1={margin.left + dividerIndex * band}
                  x2={margin.left + dividerIndex * band}
                  y1={margin.top - 6}
                  y2={zeroY}
                  stroke="var(--lj-muted)"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
                <text x={margin.left + dividerIndex * band + 4} y={margin.top - 6} className="fill-muted text-[11px]">
                  {dividerLabel}
                </text>
              </g>
            )}
            {points.map((point, index) => {
              const x = center(index) - barWidth / 2;
              const dimmed = active != null && active !== index;
              return (
                <g key={index} opacity={dimmed ? 0.5 : 1}>
                  <path d={columnPath(x, zeroY, scale.y(point.value), barWidth)} fill="var(--lj-chart-1)" />
                  {point.high != null && point.low != null && point.high > point.low && (
                    <line x1={center(index)} x2={center(index)} y1={scale.y(point.low)} y2={scale.y(point.high)} stroke="var(--lj-fg)" strokeOpacity={0.45} strokeWidth={2} strokeLinecap="round" />
                  )}
                  {point.marker != null && <circle cx={center(index)} cy={scale.y(point.marker)} r={4} fill="var(--lj-fg)" stroke="var(--lj-surface)" strokeWidth={2} />}
                  <rect
                    x={margin.left + index * band}
                    y={margin.top}
                    width={band}
                    height={plotHeight}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${point.tooltip}: ${valueLabel} ${format(point.value)}${point.marker != null && markerLabel ? `, ${markerLabel} ${format(point.marker)}` : ''}`}
                    onPointerEnter={() => setActive(index)}
                    onPointerLeave={() => setActive(null)}
                    onFocus={() => setActive(index)}
                    onBlur={() => setActive(null)}
                    className="outline-none"
                  />
                </g>
              );
            })}
            <line x1={margin.left} x2={margin.left + plotWidth} y1={zeroY} y2={zeroY} stroke="var(--lj-muted)" strokeOpacity={0.5} strokeWidth={1} shapeRendering="crispEdges" />
            {points.map((point, index) =>
              index % labelEvery === 0 ? (
                <text key={index} x={center(index)} y={height - 8} textAnchor="middle" className="fill-muted text-[11px]">
                  {point.label}
                </text>
              ) : null,
            )}
          </svg>
        )}
        {current && active != null && width > 0 && (
          <div
            role="status"
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg"
            style={{ left: Math.min(Math.max(center(active), 90), width - 90), top: Math.min(scale.y(Math.max(current.value, current.high ?? 0, current.marker ?? 0)), zeroY) - 8 }}
          >
            <p className="mb-1 font-medium text-fg">{current.tooltip}</p>
            <p className="tabular-nums text-fg">
              {valueLabel}: <strong>{format(current.value)}</strong>
              {current.low != null && current.high != null && (
                <span className="text-muted">
                  {' '}
                  ({format(current.low)}–{format(current.high)})
                </span>
              )}
            </p>
            {current.marker != null && markerLabel && (
              <p className="tabular-nums text-fg">
                {markerLabel}: <strong>{format(current.marker)}</strong>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
