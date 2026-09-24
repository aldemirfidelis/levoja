import { createHmac, randomUUID } from 'node:crypto';

export type GatewayStatus = 'PENDING' | 'AUTHORIZED' | 'PAID' | 'FAILED' | 'CANCELED' | 'REFUNDED';

export interface PixCharge {
  providerPaymentId: string;
  copyPaste: string;
  expiresAt: Date;
}

export interface CardCharge {
  providerPaymentId: string;
  status: GatewayStatus;
  cardBrand?: string;
  cardLast4?: string;
  failureReason?: string;
}

export interface CardChargeInput {
  amountCents: number;
  description: string;
  payerEmail: string;
  cardToken: string;
  installments: number;
  idempotencyKey: string;
  /** Bandeira e emissor retornados pela tokenização no cliente. */
  paymentMethodId?: string;
  issuerId?: string;
}

export interface WebhookEvent {
  eventId: string;
  providerPaymentId: string;
  /** Status já consultado no provedor (nunca confiar só no corpo do webhook). */
  status: GatewayStatus;
  type: string;
}

/**
 * Contrato do gateway de pagamentos. Dados de cartão NUNCA passam pela API:
 * o app/portal tokeniza no SDK do provedor (PCI DSS) e envia apenas o token.
 */
export interface PaymentGateway {
  readonly name: string;
  createPix(input: { amountCents: number; description: string; payerEmail: string; expiresInMinutes: number; idempotencyKey: string }): Promise<PixCharge>;
  chargeCard(input: CardChargeInput): Promise<CardCharge>;
  refund(input: { providerPaymentId: string; amountCents: number; idempotencyKey: string }): Promise<{ providerRefundId: string; status: 'SUCCEEDED' | 'PENDING' | 'FAILED' }>;
  getStatus(providerPaymentId: string): Promise<GatewayStatus>;
  parseWebhook(headers: Record<string, string | string[] | undefined>, body: unknown): Promise<WebhookEvent | null>;
}

// -----------------------------------------------------------------------------
// PIX "copia e cola" (BR Code / EMV-MPM) com CRC16-CCITT
// -----------------------------------------------------------------------------

const field = (id: string, value: string) => `${id}${value.length.toString().padStart(2, '0')}${value}`;

export function crc16(payload: string): string {
  let crc = 0xffff;
  for (const char of payload) {
    crc ^= char.charCodeAt(0) << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const ascii = (value: string, max: number) =>
  value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .toUpperCase()
    .slice(0, max);

export function buildBrCode(input: { pixKey: string; amountCents: number; merchantName: string; merchantCity: string; txid: string }): string {
  const merchantAccount = field('00', 'br.gov.bcb.pix') + field('01', input.pixKey);
  const payload =
    field('00', '01') +
    field('01', '12') +
    field('26', merchantAccount) +
    field('52', '0000') +
    field('53', '986') +
    field('54', (input.amountCents / 100).toFixed(2)) +
    field('58', 'BR') +
    field('59', ascii(input.merchantName, 25)) +
    field('60', ascii(input.merchantCity, 15)) +
    field('62', field('05', input.txid.replace(/[^A-Za-z0-9]/g, '').slice(0, 25))) +
    '6304';
  return payload + crc16(payload);
}

// -----------------------------------------------------------------------------
// Sandbox (desenvolvimento/testes)
// -----------------------------------------------------------------------------

/**
 * Gateway de desenvolvimento: gera PIX com BR Code válido estruturalmente (não pagável)
 * e aprova/recusa cartões pelos tokens de teste:
 *   tok_approved → aprovado · tok_declined → recusado · tok_insufficient → saldo insuficiente.
 * A aprovação do PIX é simulada por POST /v1/payments/sandbox/{id}/approve (fora de produção).
 */
export class SandboxGateway implements PaymentGateway {
  readonly name = 'sandbox';
  private readonly statuses = new Map<string, GatewayStatus>();

  constructor(private readonly merchant: { name: string; city: string }) {}

  async createPix(input: { amountCents: number; expiresInMinutes: number; idempotencyKey: string }): Promise<PixCharge> {
    const providerPaymentId = `sbx_pix_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    this.statuses.set(providerPaymentId, 'PENDING');
    return {
      providerPaymentId,
      copyPaste: buildBrCode({ pixKey: 'sandbox@levoja.dev', amountCents: input.amountCents, merchantName: this.merchant.name, merchantCity: this.merchant.city, txid: providerPaymentId }),
      expiresAt: new Date(Date.now() + input.expiresInMinutes * 60_000),
    };
  }

  async chargeCard(input: { cardToken: string }): Promise<CardCharge> {
    const providerPaymentId = `sbx_card_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const outcomes: Record<string, CardCharge> = {
      tok_approved: { providerPaymentId, status: 'PAID', cardBrand: 'visa', cardLast4: '4242' },
      tok_declined: { providerPaymentId, status: 'FAILED', failureReason: 'Cartão recusado pelo emissor.' },
      tok_insufficient: { providerPaymentId, status: 'FAILED', failureReason: 'Saldo/limite insuficiente.' },
    };
    const result = outcomes[input.cardToken] ?? { providerPaymentId, status: 'FAILED' as const, failureReason: 'Token de cartão inválido.' };
    this.statuses.set(providerPaymentId, result.status);
    return result;
  }

  async refund(input: { providerPaymentId: string }) {
    this.statuses.set(input.providerPaymentId, 'REFUNDED');
    return { providerRefundId: `sbx_ref_${randomUUID().slice(0, 12)}`, status: 'SUCCEEDED' as const };
  }

  async getStatus(providerPaymentId: string): Promise<GatewayStatus> {
    return this.statuses.get(providerPaymentId) ?? 'PENDING';
  }

  /** Aprovação simulada (equivale ao webhook do provedor). */
  simulatePaid(providerPaymentId: string): void {
    this.statuses.set(providerPaymentId, 'PAID');
  }

  async parseWebhook(): Promise<WebhookEvent | null> {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Mercado Pago (API REST v1)
// -----------------------------------------------------------------------------

const MP_STATUS: Record<string, GatewayStatus> = {
  pending: 'PENDING',
  in_process: 'PENDING',
  authorized: 'AUTHORIZED',
  approved: 'PAID',
  rejected: 'FAILED',
  cancelled: 'CANCELED',
  refunded: 'REFUNDED',
  charged_back: 'REFUNDED',
};

/**
 * Adaptador Mercado Pago. Requer MERCADOPAGO_ACCESS_TOKEN e MERCADOPAGO_WEBHOOK_SECRET.
 * Webhook: assinatura `x-signature` (ts + v1 = HMAC-SHA256 de "id:<data.id>;request-id:<x-request-id>;ts:<ts>;").
 * IMPORTANTE: homologar com credenciais de teste antes de ativar em produção.
 */
export class MercadoPagoGateway implements PaymentGateway {
  readonly name = 'mercadopago';
  private readonly baseUrl = 'https://api.mercadopago.com';

  constructor(
    private readonly accessToken: string,
    private readonly webhookSecret: string | undefined,
    private readonly notificationUrl: string,
  ) {}

  private async request<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...(init.idempotencyKey ? { 'X-Idempotency-Key': init.idempotencyKey } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await response.json().catch(() => ({}))) as T & { message?: string };
    if (!response.ok) throw new Error(`Mercado Pago HTTP ${response.status}: ${data.message ?? 'erro'}`);
    return data;
  }

  async createPix(input: { amountCents: number; description: string; payerEmail: string; expiresInMinutes: number; idempotencyKey: string }): Promise<PixCharge> {
    const expiresAt = new Date(Date.now() + input.expiresInMinutes * 60_000);
    const data = await this.request<{ id: number; point_of_interaction: { transaction_data: { qr_code: string } } }>('/v1/payments', {
      method: 'POST',
      idempotencyKey: input.idempotencyKey,
      body: JSON.stringify({
        transaction_amount: input.amountCents / 100,
        description: input.description,
        payment_method_id: 'pix',
        payer: { email: input.payerEmail },
        date_of_expiration: expiresAt.toISOString(),
        notification_url: this.notificationUrl,
      }),
    });
    return { providerPaymentId: String(data.id), copyPaste: data.point_of_interaction.transaction_data.qr_code, expiresAt };
  }

  async chargeCard(input: CardChargeInput): Promise<CardCharge> {
    const data = await this.request<{ id: number; status: string; status_detail: string; payment_method_id?: string; card?: { last_four_digits?: string } }>('/v1/payments', {
      method: 'POST',
      idempotencyKey: input.idempotencyKey,
      body: JSON.stringify({
        transaction_amount: input.amountCents / 100,
        description: input.description,
        token: input.cardToken,
        installments: input.installments,
        ...(input.paymentMethodId ? { payment_method_id: input.paymentMethodId } : {}),
        ...(input.issuerId && /^\d+$/.test(input.issuerId) ? { issuer_id: Number(input.issuerId) } : {}),
        payer: { email: input.payerEmail },
        notification_url: this.notificationUrl,
        capture: true,
      }),
    });
    const status = MP_STATUS[data.status] ?? 'PENDING';
    return {
      providerPaymentId: String(data.id),
      status,
      cardBrand: data.payment_method_id,
      cardLast4: data.card?.last_four_digits,
      failureReason: status === 'FAILED' ? `Pagamento recusado (${data.status_detail}).` : undefined,
    };
  }

  async refund(input: { providerPaymentId: string; amountCents: number; idempotencyKey: string }) {
    const data = await this.request<{ id: number; status: string }>(`/v1/payments/${input.providerPaymentId}/refunds`, {
      method: 'POST',
      idempotencyKey: input.idempotencyKey,
      body: JSON.stringify({ amount: input.amountCents / 100 }),
    });
    return { providerRefundId: String(data.id), status: data.status === 'approved' ? ('SUCCEEDED' as const) : ('PENDING' as const) };
  }

  async getStatus(providerPaymentId: string): Promise<GatewayStatus> {
    const data = await this.request<{ status: string }>(`/v1/payments/${providerPaymentId}`);
    return MP_STATUS[data.status] ?? 'PENDING';
  }

  async parseWebhook(headers: Record<string, string | string[] | undefined>, body: unknown): Promise<WebhookEvent | null> {
    const event = body as { id?: string | number; type?: string; data?: { id?: string | number } };
    const paymentId = event.data?.id != null ? String(event.data.id) : null;
    if (event.type !== 'payment' || !paymentId) return null;
    if (this.webhookSecret) {
      const signature = String(headers['x-signature'] ?? '');
      const requestId = String(headers['x-request-id'] ?? '');
      const parts = Object.fromEntries(signature.split(',').map((part) => part.trim().split('=') as [string, string]));
      const manifest = `id:${paymentId};request-id:${requestId};ts:${parts.ts};`;
      const expected = createHmac('sha256', this.webhookSecret).update(manifest).digest('hex');
      if (!parts.v1 || parts.v1 !== expected) throw new Error('Assinatura do webhook inválida');
    }
    // O status é sempre confirmado consultando a API (não confiamos no corpo do webhook).
    return { eventId: String(event.id ?? `${paymentId}:${Date.now()}`), providerPaymentId: paymentId, status: await this.getStatus(paymentId), type: event.type };
  }
}

// -----------------------------------------------------------------------------
// Repasses (saques) via PIX
// -----------------------------------------------------------------------------

export interface PayoutProvider {
  readonly name: string;
  sendPix(input: { amountCents: number; pixKey: string; description: string; idempotencyKey: string }): Promise<{ transferId: string; status: 'PAID' | 'PROCESSING' | 'FAILED'; failureReason?: string }>;
}

/** Repasse simulado (desenvolvimento). Em produção, implemente com a API do banco/PSP contratado. */
export class SandboxPayoutProvider implements PayoutProvider {
  readonly name = 'sandbox';
  async sendPix() {
    return { transferId: `sbx_trf_${randomUUID().slice(0, 12)}`, status: 'PAID' as const };
  }
}
