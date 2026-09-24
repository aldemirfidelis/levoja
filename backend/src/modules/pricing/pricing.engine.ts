import { applyBps } from '@levoja/shared';

/** Regra de preço (espelha o modelo PricingRule, sem dependência do ORM — facilita testes). */
export interface PriceRule {
  id: string;
  name: string;
  priority: number;
  vehicleType: string | null;
  city: string | null;
  state: string | null;
  baseCents: number;
  perKmCents: number;
  includedKm: number;
  perMinuteCents: number;
  perKgCents: number;
  includedKg: number;
  minimumCents: number;
  maximumCents: number | null;
  nightSurchargeBps: number;
  rainSurchargeBps: number;
  demandSurchargeMaxBps: number;
  timeWindows: TimeWindow[] | null;
}

export interface TimeWindow {
  weekdays: number[];
  from: string;
  to: string;
  surchargeBps: number;
}

export interface PriceContext {
  distanceKm: number;
  durationMin: number;
  weightKg?: number;
  vehicleType?: string;
  city?: string;
  state?: string;
  /** Dia da semana (0-6) e minuto do dia no fuso local da operação. */
  weekday: number;
  minuteOfDay: number;
  raining?: boolean;
  /** Pressão de demanda de 0 (oferta sobrando) a 1 (sem entregadores disponíveis). */
  demandPressure?: number;
  /** Adicional programado pela operação para a data/hora (ex.: pico previsto), em pontos-base. */
  scheduledSurchargeBps?: number;
}

export interface PriceBreakdownLine {
  label: string;
  cents: number;
}

export interface PriceQuote {
  totalCents: number;
  ruleId: string;
  ruleName: string;
  lines: PriceBreakdownLine[];
}

const normalize = (value?: string | null) =>
  (value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Escolhe a regra mais específica que casa com o contexto (filtros nulos = qualquer). */
export function selectRule<T extends PriceRule>(rules: T[], context: PriceContext): T | null {
  const matches = rules.filter(
    (rule) =>
      (!rule.vehicleType || rule.vehicleType === context.vehicleType) &&
      (!rule.city || normalize(rule.city) === normalize(context.city)) &&
      (!rule.state || normalize(rule.state) === normalize(context.state)),
  );
  const specificity = (rule: PriceRule) => (rule.vehicleType ? 1 : 0) + (rule.city ? 2 : 0) + (rule.state ? 1 : 0);
  matches.sort((a, b) => b.priority - a.priority || specificity(b) - specificity(a));
  return matches[0] ?? null;
}

/**
 * Motor de cálculo configurável:
 *   VALOR BASE + KM excedente + MINUTOS + PESO excedente
 *   + adicionais (noturno, janelas de horário, chuva, demanda) sobre o subtotal
 *   limitado por mínimo e máximo. Todos os valores em centavos.
 */
export function computePrice(rule: PriceRule, context: PriceContext): PriceQuote {
  const lines: PriceBreakdownLine[] = [{ label: 'Valor base', cents: rule.baseCents }];
  const extraKm = Math.max(0, context.distanceKm - rule.includedKm);
  if (rule.perKmCents && extraKm > 0) lines.push({ label: `Distância (${extraKm.toFixed(1)} km)`, cents: Math.round(extraKm * rule.perKmCents) });
  if (rule.perMinuteCents && context.durationMin > 0) {
    lines.push({ label: `Tempo (${Math.round(context.durationMin)} min)`, cents: Math.round(context.durationMin * rule.perMinuteCents) });
  }
  const extraKg = Math.max(0, (context.weightKg ?? 0) - rule.includedKg);
  if (rule.perKgCents && extraKg > 0) lines.push({ label: `Peso (${extraKg.toFixed(1)} kg)`, cents: Math.round(extraKg * rule.perKgCents) });

  const subtotal = lines.reduce((sum, line) => sum + line.cents, 0);
  const surcharges: PriceBreakdownLine[] = [];

  const isNight = context.minuteOfDay >= 22 * 60 || context.minuteOfDay < 6 * 60;
  if (isNight && rule.nightSurchargeBps) surcharges.push({ label: 'Adicional noturno', cents: applyBps(subtotal, rule.nightSurchargeBps) });

  for (const window of rule.timeWindows ?? []) {
    const from = toMinutes(window.from);
    const to = toMinutes(window.to);
    const inWindow = from <= to ? context.minuteOfDay >= from && context.minuteOfDay < to : context.minuteOfDay >= from || context.minuteOfDay < to;
    if (window.weekdays.includes(context.weekday) && inWindow && window.surchargeBps) {
      surcharges.push({ label: 'Adicional de horário', cents: applyBps(subtotal, window.surchargeBps) });
    }
  }
  if (context.raining && rule.rainSurchargeBps) surcharges.push({ label: 'Adicional de chuva', cents: applyBps(subtotal, rule.rainSurchargeBps) });

  const pressure = Math.min(1, Math.max(0, context.demandPressure ?? 0));
  // O adicional de demanda só começa acima de 50% de pressão e cresce linearmente até o teto.
  if (rule.demandSurchargeMaxBps && pressure > 0.5) {
    const bps = Math.round(rule.demandSurchargeMaxBps * ((pressure - 0.5) / 0.5));
    if (bps > 0) surcharges.push({ label: 'Adicional de demanda', cents: applyBps(subtotal, bps) });
  }

  if (context.scheduledSurchargeBps && context.scheduledSurchargeBps > 0) {
    surcharges.push({ label: 'Adicional de alta demanda', cents: applyBps(subtotal, context.scheduledSurchargeBps) });
  }

  const all = [...lines, ...surcharges];
  let total = all.reduce((sum, line) => sum + line.cents, 0);
  if (total < rule.minimumCents) {
    all.push({ label: 'Ajuste para o valor mínimo', cents: rule.minimumCents - total });
    total = rule.minimumCents;
  }
  if (rule.maximumCents != null && total > rule.maximumCents) {
    all.push({ label: 'Limite máximo', cents: rule.maximumCents - total });
    total = rule.maximumCents;
  }
  return { totalCents: total, ruleId: rule.id, ruleName: rule.name, lines: all };
}
