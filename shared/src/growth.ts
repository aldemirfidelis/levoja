/** Crescimento e relacionamento (Fase 10): fidelidade, indicação, frota própria e cupons. */

export const LOYALTY_TRANSACTION_LABELS = { EARN: 'Pontos ganhos', REDEEM: 'Resgate', EXPIRE: 'Expiração', ADJUST: 'Ajuste' } as const;
export type LoyaltyTransactionType = keyof typeof LOYALTY_TRANSACTION_LABELS;

export interface LoyaltyTier {
  key: string;
  name: string;
  /** Pontos ganhos nos últimos 12 meses para alcançar o nível. */
  minPoints: number;
  /** Multiplicador de pontos em pontos-base (10000 = 1x). */
  multiplierBps: number;
  /** Cashback sobre o valor dos produtos, creditado na carteira (pontos-base). */
  cashbackBps: number;
}

export const DEFAULT_LOYALTY_TIERS: LoyaltyTier[] = [
  { key: 'bronze', name: 'Bronze', minPoints: 0, multiplierBps: 10_000, cashbackBps: 0 },
  { key: 'prata', name: 'Prata', minPoints: 2_000, multiplierBps: 12_500, cashbackBps: 100 },
  { key: 'ouro', name: 'Ouro', minPoints: 6_000, multiplierBps: 15_000, cashbackBps: 200 },
];

/** Nível para os pontos dos últimos 12 meses (o maior cujo mínimo foi alcançado). */
export function tierFor(points: number, tiers: LoyaltyTier[]): LoyaltyTier {
  const sorted = [...tiers].sort((a, b) => a.minPoints - b.minPoints);
  return sorted.reduce((current, tier) => (points >= tier.minPoints ? tier : current), sorted[0]);
}

/** Próximo nível e quanto falta (null no nível máximo). */
export function nextTier(points: number, tiers: LoyaltyTier[]): { tier: LoyaltyTier; missing: number } | null {
  const next = [...tiers].sort((a, b) => a.minPoints - b.minPoints).find((tier) => tier.minPoints > points);
  return next ? { tier: next, missing: next.minPoints - points } : null;
}

/** Pontos de um pedido: valor dos produtos em reais × pontos por real × multiplicador do nível (arredondado para baixo). */
export function earnedPoints(subtotalCents: number, pointsPerReal: number, multiplierBps: number): number {
  if (subtotalCents <= 0 || pointsPerReal <= 0) return 0;
  return Math.floor(((subtotalCents / 100) * pointsPerReal * multiplierBps) / 10_000);
}

/** Posição do nível (para cupons exclusivos: nível do cliente ≥ nível mínimo do cupom). */
export function tierRank(key: string | null | undefined, tiers: LoyaltyTier[]): number {
  const sorted = [...tiers].sort((a, b) => a.minPoints - b.minPoints);
  return sorted.findIndex((tier) => tier.key === key);
}

export const REFERRAL_PROGRAM_LABELS = { CUSTOMER: 'Clientes', DRIVER: 'Entregadores', COMPANY: 'Empresas' } as const;
export type ReferralProgram = keyof typeof REFERRAL_PROGRAM_LABELS;

export const REFERRAL_STATUS_LABELS = { PENDING: 'Aguardando a meta', REWARDED: 'Recompensa paga', REJECTED: 'Não aprovada', EXPIRED: 'Prazo encerrado' } as const;
export type ReferralStatus = keyof typeof REFERRAL_STATUS_LABELS;

/** Código de indicação: letras e números, sem ambiguidades (sem 0/O, 1/I). */
export function normalizeReferralCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export const FLEET_INVITATION_STATUS_LABELS = { PENDING: 'Aguardando resposta', ACCEPTED: 'Aceito', DECLINED: 'Recusado', CANCELED: 'Cancelado', EXPIRED: 'Expirado' } as const;
export type FleetInvitationStatus = keyof typeof FLEET_INVITATION_STATUS_LABELS;

export const COUPON_VISIBILITY_LABELS = { CODE: 'Somente com o código', PUBLIC: 'Listado no app para todos', TIER: 'Exclusivo de um nível de fidelidade' } as const;
export type CouponVisibility = keyof typeof COUPON_VISIBILITY_LABELS;
