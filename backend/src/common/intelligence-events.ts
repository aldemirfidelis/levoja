import type { RiskSignalType } from '@levoja/shared';

/**
 * Eventos de domínio consumidos pela inteligência (antifraude, análise de avaliações).
 * Ficam fora dos módulos para que qualquer módulo possa emiti-los sem dependência circular.
 */

/** Indício de risco observado por outro módulo (o antifraude pontua, agrega e abre casos). */
export const RISK_SIGNAL = 'risk.signal';
export interface RiskSignalEvent {
  tenantId: string;
  userId: string;
  type: RiskSignalType;
  message: string;
  details?: Record<string, unknown>;
  relatedUserIds?: string[];
  orderId?: string;
  deliveryId?: string;
  paymentId?: string;
  /** Mesmo fato não pontua duas vezes. */
  dedupeKey?: string;
}

/** Login ou cadastro concluído (registro do aparelho usado). */
export const AUTH_SESSION_STARTED = 'auth.session.started';
export interface AuthSessionStartedEvent {
  tenantId: string;
  userId: string;
  app: string | null;
  deviceId?: string;
  ip?: string;
  userAgent?: string;
}

/** Pagamento recusado ou não aprovado. */
export const PAYMENT_FAILED = 'payment.failed';
export interface PaymentFailedEvent {
  tenantId: string;
  paymentId: string;
  payerUserId: string;
  method: string;
  amountCents: number;
  orderId: string | null;
}

/** Avaliação registrada (análise de sentimento e temas). */
export const REVIEW_CREATED = 'review.created';
export interface ReviewCreatedEvent {
  tenantId: string;
  reviewId: string;
}
