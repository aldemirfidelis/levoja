/**
 * Previsão de demanda e estatísticas de anomalia (funções puras).
 *
 * Modelo sazonal simples e explicável: para uma hora futura, média ponderada da mesma hora do
 * mesmo dia da semana nas últimas N semanas (semanas recentes pesam mais), corrigida pela
 * tendência (últimos 7 dias ÷ 7 dias anteriores). O intervalo usa o maior entre a variação
 * histórica e o ruído de Poisson — volumes pequenos têm incerteza grande.
 */

export interface Forecast {
  predicted: number;
  low: number;
  high: number;
}

export interface ForecastOptions {
  /** Peso de cada semana em relação à seguinte (0,7 = a semana anterior vale 70%). */
  decay?: number;
  /** Multiplicador do intervalo (1,28 ≈ 80% de confiança). */
  intervalZ?: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** `samples[0]` é a semana mais recente. Semanas sem operação devem vir como 0 (não omitidas). */
export function seasonalForecast(samples: number[], trend = 1, options: ForecastOptions = {}): Forecast {
  if (!samples.length) return { predicted: 0, low: 0, high: 0 };
  const decay = options.decay ?? 0.7;
  const z = options.intervalZ ?? 1.28;
  const weights = samples.map((_, index) => Math.pow(decay, index));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const mean = samples.reduce((sum, value, index) => sum + value * weights[index], 0) / weightSum;
  const variance = samples.reduce((sum, value, index) => sum + weights[index] * (value - mean) ** 2, 0) / weightSum;
  const predicted = Math.max(0, mean * trend);
  const margin = z * Math.max(Math.sqrt(variance) * trend, Math.sqrt(Math.max(predicted, 1)));
  return { predicted: round1(predicted), low: round1(Math.max(0, predicted - margin)), high: round1(predicted + margin) };
}

/** Tendência recente limitada (evita que uma semana atípica distorça a previsão). */
export function trendFactor(lastWeek: number, previousWeek: number, clamp: [number, number] = [0.7, 1.4], minVolume = 20): number {
  if (previousWeek < minVolume || lastWeek <= 0) return 1;
  return Math.min(clamp[1], Math.max(clamp[0], lastWeek / previousWeek));
}

/** Entregadores necessários para atender a previsão na hora. */
export function driversNeeded(predicted: number, deliveriesPerDriverHour: number): number {
  if (predicted <= 0.25) return 0;
  return Math.ceil(predicted / Math.max(0.1, deliveriesPerDriverHour));
}

export interface AccuracyRow {
  predicted: number;
  actual: number;
}

/**
 * Precisão do histórico de previsões. WAPE (erro absoluto ÷ volume real) é robusto a horas de
 * volume zero; viés positivo = previu mais do que aconteceu.
 */
export function forecastAccuracy(rows: AccuracyRow[]): { hours: number; actual: number; wape: number | null; bias: number | null; withinInterval?: number } {
  const actual = rows.reduce((sum, row) => sum + row.actual, 0);
  if (!rows.length || actual === 0) return { hours: rows.length, actual, wape: null, bias: null };
  const absError = rows.reduce((sum, row) => sum + Math.abs(row.predicted - row.actual), 0);
  const error = rows.reduce((sum, row) => sum + (row.predicted - row.actual), 0);
  return { hours: rows.length, actual, wape: Math.round((absError / actual) * 1000) / 1000, bias: Math.round((error / actual) * 1000) / 1000 };
}

/** Desvio de uma proporção observada em relação à taxa de referência (aproximação normal da binomial). */
export function binomialZ(events: number, total: number, baselineRate: number): number {
  if (total <= 0) return 0;
  const p0 = Math.min(0.99, Math.max(0.005, baselineRate));
  return Math.round((((events / total) - p0) / Math.sqrt((p0 * (1 - p0)) / total)) * 100) / 100;
}

export type DemandDeviation = { kind: 'SPIKE' | 'DROP'; z: number } | null;

/**
 * Volume real fora do intervalo previsto e com diferença relevante (ruído de Poisson).
 * Quedas só contam quando a previsão tem volume suficiente — uma hora vazia pode ser normal.
 */
export function demandDeviation(actual: number, forecast: Forecast, options: { minVolume: number; zThreshold: number }): DemandDeviation {
  const z = Math.round(((actual - forecast.predicted) / Math.sqrt(Math.max(forecast.predicted, 1))) * 100) / 100;
  if (actual > forecast.high && actual >= options.minVolume && z >= options.zThreshold) return { kind: 'SPIKE', z };
  if (actual < forecast.low && forecast.predicted >= options.minVolume * 2 && -z >= options.zThreshold) return { kind: 'DROP', z };
  return null;
}

/** Mediana (null para lista vazia). */
export function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
