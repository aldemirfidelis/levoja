/**
 * Valores monetários trafegam SEMPRE como inteiros em centavos (BRL).
 * Isso evita erros de ponto flutuante em cálculos financeiros.
 */

export type Cents = number;

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const formatBRL = (cents: Cents): string => brl.format(cents / 100);

export const toCents = (reais: number): Cents => Math.round(reais * 100);

export const fromCents = (cents: Cents): number => cents / 100;

/** Aplica percentual expresso em pontos-base (1% = 100 bps), arredondando para o centavo. */
export const applyBps = (cents: Cents, bps: number): Cents => Math.round((cents * bps) / 10_000);

/**
 * Divide um valor em partes proporcionais sem perder centavos
 * (método do maior resto). Útil para ratear descontos entre itens.
 */
export function allocateCents(total: Cents, weights: number[]): Cents[] {
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  if (weightSum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / weightSum);
  const floors = raw.map(Math.floor);
  let remainder = total - floors.reduce((sum, v) => sum + v, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors;
}
