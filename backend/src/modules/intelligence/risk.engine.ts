import { haversineKm, type LatLng } from '@levoja/shared';

/**
 * Motor de risco (funções puras, sem banco): pontuação com decaimento, nível, detecção de
 * deslocamento impossível e de taxas de cancelamento fora do padrão. As regras e os limites vêm
 * da configuração `fraud`; nenhuma decisão aqui é definitiva — o score só abre casos para revisão
 * humana e aciona restrições leves e reversíveis.
 */

export type Level = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ScoredSignal {
  points: number;
  at: Date;
}

/** Soma dos pontos com meia-vida (um sinal de `halfLifeDays` atrás vale metade), limitada a 0–100. */
export function decayedScore(signals: ScoredSignal[], now: Date, halfLifeDays: number): number {
  const halfLifeMs = Math.max(1, halfLifeDays) * 86_400_000;
  const total = signals.reduce((sum, signal) => {
    const age = Math.max(0, now.getTime() - signal.at.getTime());
    return sum + signal.points * Math.pow(0.5, age / halfLifeMs);
  }, 0);
  return Math.max(0, Math.min(100, Math.round(total)));
}

export function riskLevel(score: number, thresholds: { medium: number; high: number }): Level {
  if (score >= thresholds.high) return 'HIGH';
  if (score >= thresholds.medium) return 'MEDIUM';
  return 'LOW';
}

export const LEVEL_RANK: Record<Level, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export interface TimedPoint extends LatLng {
  at: Date;
  accuracy?: number | null;
}

export interface SpeedViolation {
  from: TimedPoint;
  to: TimedPoint;
  km: number;
  kmh: number;
}

/**
 * Saltos impossíveis entre leituras consecutivas (ex.: 30 km em 1 minuto). Descontamos a
 * imprecisão informada pelo GPS e ignoramos saltos curtos, para não punir oscilações normais.
 */
export function impossibleJumps(points: TimedPoint[], maxKmh: number, minJumpKm = 1): SpeedViolation[] {
  const sorted = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  const violations: SpeedViolation[] = [];
  for (let index = 1; index < sorted.length; index++) {
    const from = sorted[index - 1];
    const to = sorted[index];
    const slackKm = ((from.accuracy ?? 0) + (to.accuracy ?? 0)) / 1000;
    const km = Math.max(0, haversineKm(from, to) - slackKm);
    if (km < minJumpKm) continue;
    const hours = Math.max((to.at.getTime() - from.at.getTime()) / 3_600_000, 1 / 3600);
    const kmh = km / hours;
    if (kmh > maxKmh) violations.push({ from, to, km: Math.round(km * 100) / 100, kmh: Math.round(kmh) });
  }
  return violations;
}

export interface RateSubject {
  id: string;
  total: number;
  events: number;
}

export interface RateOutlier extends RateSubject {
  rate: number;
  baseline: number;
  z: number;
}

/**
 * Taxas (ex.: cancelamentos ÷ pedidos) muito acima da média do grupo. Usa o desvio binomial em
 * relação à taxa agregada, então quem tem poucos pedidos precisa de uma diferença maior.
 */
export function rateOutliers(subjects: RateSubject[], options: { minTotal: number; minEvents: number; zThreshold: number; minRate?: number }): RateOutlier[] {
  const totals = subjects.reduce((acc, subject) => ({ total: acc.total + subject.total, events: acc.events + subject.events }), { total: 0, events: 0 });
  if (totals.total === 0) return [];
  const baseline = Math.min(0.99, Math.max(0.001, totals.events / totals.total));
  return subjects
    .filter((subject) => subject.total >= options.minTotal && subject.events >= options.minEvents)
    .map((subject) => {
      const rate = subject.events / subject.total;
      const z = (rate - baseline) / Math.sqrt((baseline * (1 - baseline)) / subject.total);
      return { ...subject, rate, baseline, z: Math.round(z * 100) / 100 };
    })
    .filter((subject) => subject.z >= options.zThreshold && subject.rate >= (options.minRate ?? 0))
    .sort((a, b) => b.z - a.z);
}

/** Chave de endereço para comparar contas (rua + número + CEP, sem acentos/pontuação). */
export function addressKey(address: { street?: string | null; number?: string | null; zipCode?: string | null } | null | undefined): string | null {
  if (!address?.street || !address.zipCode) return null;
  const clean = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\b(rua|r|avenida|av|travessa|tv|alameda|al|estrada|est|rodovia|rod)\b\.?/g, '')
      .replace(/[^a-z0-9]/g, '');
  return `${clean(address.zipCode)}:${clean(address.street)}:${clean(address.number ?? 's/n')}`;
}
