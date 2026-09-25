/** Vocabulário financeiro compartilhado entre API, portais e apps. */

export const LEDGER_ENTRY_TYPES = [
  'SALE',
  'COMMISSION',
  'EARNING',
  'TIP',
  'FEE',
  'CASH_COLLECTED',
  'REFUND',
  'CREDIT',
  'ADJUSTMENT',
  'DISCOUNT',
  'WITHDRAWAL',
  'WITHDRAWAL_REVERSAL',
  'PAYMENT',
  'SUBSCRIPTION',
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const LEDGER_ENTRY_LABELS: Record<LedgerEntryType, string> = {
  SALE: 'Venda',
  COMMISSION: 'Comissão',
  EARNING: 'Ganho',
  TIP: 'Gorjeta',
  FEE: 'Taxa',
  CASH_COLLECTED: 'Dinheiro recebido',
  REFUND: 'Estorno',
  CREDIT: 'Crédito',
  ADJUSTMENT: 'Ajuste',
  DISCOUNT: 'Desconto de cupom',
  WITHDRAWAL: 'Saque',
  WITHDRAWAL_REVERSAL: 'Saque devolvido',
  PAYMENT: 'Pagamento',
  SUBSCRIPTION: 'Mensalidade do plano',
};

export const LEDGER_ENTRY_STATUS_LABELS = { PENDING: 'A liberar', AVAILABLE: 'Disponível', CANCELED: 'Cancelado' } as const;

export const WITHDRAWAL_STATUSES = ['REQUESTED', 'PROCESSING', 'PAID', 'REJECTED', 'FAILED', 'CANCELED'] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export const WITHDRAWAL_STATUS_LABELS: Record<WithdrawalStatus, string> = {
  REQUESTED: 'Solicitado',
  PROCESSING: 'Em processamento',
  PAID: 'Pago',
  REJECTED: 'Recusado',
  FAILED: 'Falhou',
  CANCELED: 'Cancelado',
};

export const WALLET_OWNER_TYPES = ['DRIVER', 'COMPANY', 'CUSTOMER', 'PLATFORM'] as const;
export type WalletOwnerType = (typeof WALLET_OWNER_TYPES)[number];

export const WALLET_OWNER_LABELS: Record<WalletOwnerType, string> = {
  DRIVER: 'Entregador',
  COMPANY: 'Empresa',
  CUSTOMER: 'Cliente',
  PLATFORM: 'Plataforma',
};

export const COUPON_TYPES = ['PERCENT', 'FIXED', 'FREE_DELIVERY'] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

export const COUPON_TYPE_LABELS: Record<CouponType, string> = {
  PERCENT: 'Percentual',
  FIXED: 'Valor fixo',
  FREE_DELIVERY: 'Entrega grátis',
};

export const PAYMENT_PURPOSE_LABELS = {
  ORDER: 'Pedido',
  DELIVERY: 'Entrega avulsa',
  DEBT_SETTLEMENT: 'Quitação de saldo',
} as const;
export type PaymentPurpose = keyof typeof PAYMENT_PURPOSE_LABELS;

export const WEEKDAY_SHORT_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

/** Descrição curta da regra de um cupom, ex.: "10% (até R$ 15,00)". */
export function describeCoupon(coupon: { type: CouponType; percentBps?: number | null; amountCents?: number | null; maxDiscountCents?: number | null }, format: (cents: number) => string): string {
  if (coupon.type === 'FREE_DELIVERY') return 'Entrega grátis';
  if (coupon.type === 'FIXED') return `${format(coupon.amountCents ?? 0)} de desconto`;
  const percent = `${((coupon.percentBps ?? 0) / 100).toLocaleString('pt-BR')}%`;
  return coupon.maxDiscountCents ? `${percent} (até ${format(coupon.maxDiscountCents)})` : percent;
}
