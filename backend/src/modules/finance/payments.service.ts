import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { JobsService } from '../../infra/jobs/jobs.service';
import { AppConfig } from '../../config/config.module';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { OrdersService, ORDER_STATUS_CHANGED, OrderStatusChangedEvent } from '../orders/orders.service';
import { CouponsService } from '../coupons/coupons.service';
import { paginated, PaginationQueryDto, skipOf } from '../../common/pagination';
import type { AuthUser } from '../../common/auth/auth-user';
import { GatewayStatus, MercadoPagoGateway, PaymentGateway, SandboxGateway } from './gateways';
import { LedgerService, WalletOwner } from './ledger.service';
import { Prisma } from '../../generated/prisma/client';
import type { PaymentMethod, PaymentPurpose, PaymentStatus } from '../../generated/prisma/enums';

const ONLINE: PaymentMethod[] = ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'WALLET'];

export interface PaymentsQuery extends PaginationQueryDto {
  status?: PaymentStatus;
  method?: PaymentMethod;
  purpose?: PaymentPurpose;
  from?: string;
  to?: string;
}

/**
 * Pagamentos: PIX, cartão (token do SDK do provedor), carteira e dinheiro (registrado na liquidação).
 * - Pedido online nasce em PENDING_PAYMENT e só vai para a loja (NEW) após a confirmação.
 * - Confirmação por webhook assinado ou consulta ao provedor; nunca pelo cliente.
 * - Cancelamento do pedido estorna automaticamente e devolve o cupom.
 */
@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsService.name);
  /** null = pagamentos online desativados (PAYMENT_GATEWAY=none). */
  readonly gateway: PaymentGateway | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly orders: OrdersService,
    private readonly coupons: CouponsService,
    private readonly ledger: LedgerService,
  ) {
    const env = config.env;
    this.gateway =
      env.PAYMENT_GATEWAY === 'mercadopago'
        ? new MercadoPagoGateway(env.MERCADOPAGO_ACCESS_TOKEN!, env.MERCADOPAGO_WEBHOOK_SECRET, `${env.API_PUBLIC_URL}/v1/payments/webhooks/mercadopago`)
        : env.PAYMENT_GATEWAY === 'sandbox'
          ? new SandboxGateway({ name: env.APP_NAME, city: env.MERCHANT_CITY })
          : null;
  }

  onModuleInit(): void {
    this.orders.registerPaymentPolicy(
      async (_tenantId, method, context) => {
        if (method === 'CASH') return { allowed: true, initialStatus: 'NEW' };
        if (method === 'INVOICE') return { allowed: false, reason: 'Pagamento faturado é exclusivo para entregas de empresas.', initialStatus: 'NEW' };
        if (method !== 'WALLET' && !this.gateway) {
          return { allowed: false, reason: 'Pagamento online indisponível no momento. Escolha dinheiro na entrega.', initialStatus: 'NEW' };
        }
        if ((method === 'CREDIT_CARD' || method === 'DEBIT_CARD') && !context.cardToken) {
          return { allowed: false, reason: 'Informe o cartão.', initialStatus: 'PENDING_PAYMENT' };
        }
        return { allowed: true, initialStatus: 'PENDING_PAYMENT' };
      },
      (user, order, dto) => this.startForOrder(user, order, { token: dto.cardToken, installments: dto.installments ?? 1, paymentMethodId: dto.cardPaymentMethodId, issuerId: dto.cardIssuerId }),
    );
    this.jobs.register<{ paymentId: string }>('payments.expire', ({ paymentId }) => this.expire(paymentId));
  }

  /** Tokenização do cartão no cliente: sandbox (tokens de teste) ou SDK do provedor com a chave pública. */
  get cardTokenization(): { provider: 'sandbox' } | { provider: 'mercadopago'; publicKey: string } | null {
    if (this.gateway instanceof SandboxGateway) return { provider: 'sandbox' };
    const publicKey = this.config.env.MERCADOPAGO_PUBLIC_KEY;
    if (this.gateway instanceof MercadoPagoGateway && publicKey) return { provider: 'mercadopago', publicKey };
    return null;
  }

  get onlineMethods(): PaymentMethod[] {
    if (!this.gateway) return ['WALLET'];
    return this.cardTokenization ? ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'WALLET'] : ['PIX', 'WALLET'];
  }

  get isSandbox(): boolean {
    return this.gateway instanceof SandboxGateway;
  }

  private requireGateway(): PaymentGateway {
    if (!this.gateway) throw new UnprocessableEntityException('Pagamento online indisponível no momento.');
    return this.gateway;
  }

  // ---------------------------------------------------------------------------
  // Cobrança de pedidos
  // ---------------------------------------------------------------------------

  private async startForOrder(
    user: AuthUser,
    order: { id: string; tenantId: string; number: number; totalCents: number; paymentMethod: PaymentMethod },
    card: { token?: string; installments: number; paymentMethodId?: string; issuerId?: string } = { installments: 1 },
  ) {
    const payer = await this.prisma.user.findUniqueOrThrow({ where: { id: user.userId }, select: { email: true } });
    const payment = await this.prisma.payment.create({
      data: {
        tenantId: order.tenantId,
        purpose: 'ORDER',
        orderId: order.id,
        payerUserId: user.userId,
        method: order.paymentMethod,
        amountCents: order.totalCents,
        provider: order.paymentMethod === 'WALLET' ? 'wallet' : this.requireGateway().name,
      },
    });
    const description = `Pedido #${order.number}`;

    try {
      if (order.paymentMethod === 'PIX') {
        await this.createPixCharge(payment.id, order.tenantId, order.totalCents, description, payer.email);
        return;
      }
      if (order.paymentMethod === 'CREDIT_CARD' || order.paymentMethod === 'DEBIT_CARD') {
        const charge = await this.requireGateway().chargeCard({
          amountCents: order.totalCents,
          description,
          payerEmail: payer.email,
          cardToken: card.token!,
          installments: card.installments,
          paymentMethodId: card.paymentMethodId,
          issuerId: card.issuerId,
          idempotencyKey: payment.id,
        });
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { providerPaymentId: charge.providerPaymentId, cardBrand: charge.cardBrand, cardLast4: charge.cardLast4, authorizedAt: new Date() },
        });
        if (charge.status === 'PAID' || charge.status === 'AUTHORIZED') await this.markPaid(payment.id);
        else if (charge.status === 'PENDING') return; // análise antifraude do provedor: confirmação chega por webhook
        else await this.markFailed(payment.id, charge.failureReason ?? 'Pagamento recusado.');
        return;
      }
      if (order.paymentMethod === 'WALLET') {
        await this.payOrderWithWallet(payment.id, user, order);
      }
    } catch (error) {
      this.logger.error(`Falha ao iniciar pagamento ${payment.id}: ${(error as Error).message}`);
      await this.markFailed(payment.id, 'Não foi possível processar o pagamento. Tente outra forma de pagamento.');
    }
  }

  private async createPixCharge(paymentId: string, tenantId: string, amountCents: number, description: string, payerEmail: string) {
    const { pixExpirationMinutes } = await this.settings.get(tenantId, 'finance');
    const pix = await this.requireGateway().createPix({ amountCents, description, payerEmail, expiresInMinutes: pixExpirationMinutes, idempotencyKey: paymentId });
    await this.prisma.payment.update({ where: { id: paymentId }, data: { providerPaymentId: pix.providerPaymentId, pixCopyPaste: pix.copyPaste, pixExpiresAt: pix.expiresAt } });
    await this.jobs.enqueue('payments.expire', { paymentId }, { delayMs: Math.max(0, pix.expiresAt.getTime() - Date.now()) + 1000, jobId: `pix-expire:${paymentId}` });
  }

  /** Créditos da carteira do cliente (estornos em crédito). */
  private async payOrderWithWallet(paymentId: string, user: AuthUser, order: { id: string; tenantId: string; number: number; totalCents: number }) {
    if (!user.customerId) throw new ForbiddenException('Perfil de cliente não encontrado.');
    const paid = await this.prisma.$transaction(async (tx) => {
      const wallet = await this.ledger.wallet(order.tenantId, { type: 'CUSTOMER', customerId: user.customerId! }, tx);
      return this.ledger.debitAvailable(tx, wallet.id, [
        { type: 'PAYMENT', amountCents: order.totalCents, description: `Pagamento do pedido #${order.number}`, orderId: order.id, paymentId, referenceKey: `payment:${paymentId}:wallet` },
      ]);
    });
    if (paid) await this.markPaid(paymentId);
    else await this.markFailed(paymentId, 'Saldo insuficiente na carteira.');
  }

  /**
   * Entrega avulsa paga com saldo da carteira (cliente: créditos; empresa: saldo de vendas).
   * Executa dentro da transação de criação da entrega: saldo insuficiente desfaz tudo.
   */
  async chargeDeliveryFromWallet(tx: Tx, input: { tenantId: string; owner: WalletOwner; payerUserId: string; deliveryId: string; code: string; amountCents: number }) {
    const wallet = await this.ledger.wallet(input.tenantId, input.owner, tx);
    const payment = await tx.payment.create({
      data: {
        tenantId: input.tenantId,
        purpose: 'DELIVERY',
        deliveryId: input.deliveryId,
        payerUserId: input.payerUserId,
        method: 'WALLET',
        amountCents: input.amountCents,
        provider: 'wallet',
        status: 'PAID',
        paidAt: new Date(),
      },
    });
    const ok = await this.ledger.debitAvailable(tx, wallet.id, [
      { type: 'PAYMENT', amountCents: input.amountCents, description: `Entrega ${input.code}`, deliveryId: input.deliveryId, paymentId: payment.id, referenceKey: `payment:${payment.id}:wallet` },
    ]);
    if (!ok) throw new UnprocessableEntityException('Saldo insuficiente na carteira.');
    return payment;
  }

  async markPaid(paymentId: string) {
    const updated = await this.prisma.payment.updateMany({
      where: { id: paymentId, status: { in: ['PENDING', 'AUTHORIZED'] } },
      data: { status: 'PAID', paidAt: new Date() },
    });
    if (updated.count === 0) return;
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    await this.jobs.cancel(`pix-expire:${paymentId}`);
    await this.audit.log({ action: 'payment.paid', entityType: 'Payment', entityId: paymentId, actorId: null, tenantId: payment.tenantId, after: { amountCents: payment.amountCents, method: payment.method, purpose: payment.purpose } });

    if (payment.purpose === 'DEBT_SETTLEMENT' && payment.walletId) {
      const wallet = await this.prisma.wallet.findUniqueOrThrow({ where: { id: payment.walletId } });
      await this.prisma.$transaction((tx) =>
        this.ledger.post(tx, payment.tenantId, [
          { owner: this.ledger.ownerOf(wallet), type: 'PAYMENT', amountCents: payment.amountCents, description: 'Quitação de saldo devedor (PIX)', paymentId, referenceKey: `payment:${paymentId}:settlement` },
        ]),
      );
      return;
    }
    if (!payment.orderId) return;
    const order = await this.prisma.order.update({ where: { id: payment.orderId }, data: { paymentStatus: 'PAID' } });
    if (order.status === 'PENDING_PAYMENT') {
      await this.orders.transition(order.id, 'NEW', { type: 'SYSTEM' }, { expectedFrom: ['PENDING_PAYMENT'] }).catch(async (error) => {
        // Corrida com a expiração/cancelamento: o pedido já foi cancelado → devolve o valor.
        this.logger.warn(`Pedido ${order.id} não avançou após pagamento: ${(error as Error).message}`);
        await this.refundIfCanceled(order.id, paymentId);
      });
    } else if (order.status === 'CANCELED') {
      await this.refundIfCanceled(order.id, paymentId);
    }
  }

  private async refundIfCanceled(orderId: string, paymentId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (order?.status !== 'CANCELED' || !payment || payment.status !== 'PAID') return;
    await this.refund(null, paymentId, payment.amountCents - payment.refundedCents, 'Pagamento recebido após o cancelamento do pedido.', payment.method === 'WALLET');
  }

  private async markFailed(paymentId: string, reason: string) {
    const updated = await this.prisma.payment.updateMany({ where: { id: paymentId, status: { in: ['PENDING', 'AUTHORIZED'] } }, data: { status: 'FAILED', failureReason: reason } });
    if (updated.count === 0) return;
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    await this.jobs.cancel(`pix-expire:${paymentId}`);
    if (payment.orderId) {
      await this.prisma.order.update({ where: { id: payment.orderId }, data: { paymentStatus: 'FAILED' } });
      await this.orders
        .transition(payment.orderId, 'CANCELED', { type: 'SYSTEM' }, { reason: `Pagamento não aprovado: ${reason}`, expectedFrom: ['PENDING_PAYMENT'] })
        .catch(() => undefined);
    }
  }

  /** PIX não pago no prazo: cancela o pagamento e o pedido. */
  async expire(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.status !== 'PENDING') return;
    // Confirma com o provedor antes de cancelar (o webhook pode ter se perdido).
    if (payment.providerPaymentId && this.gateway && (await this.gateway.getStatus(payment.providerPaymentId).catch(() => 'PENDING')) === 'PAID') {
      await this.markPaid(paymentId);
      return;
    }
    const updated = await this.prisma.payment.updateMany({ where: { id: paymentId, status: 'PENDING' }, data: { status: 'CANCELED', canceledAt: new Date(), failureReason: 'PIX expirado' } });
    if (updated.count === 0) return;
    if (payment.orderId) {
      await this.prisma.order.update({ where: { id: payment.orderId }, data: { paymentStatus: 'CANCELED' } });
      await this.orders
        .transition(payment.orderId, 'CANCELED', { type: 'SYSTEM' }, { reason: 'Pagamento PIX não confirmado no prazo.', expectedFrom: ['PENDING_PAYMENT'] })
        .catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------------------
  // Quitação de saldo devedor (entregador com dinheiro em mãos, empresa com entregas faturadas)
  // ---------------------------------------------------------------------------

  async createDebtSettlement(user: AuthUser, owner: WalletOwner) {
    const gateway = this.requireGateway();
    const wallet = await this.ledger.wallet(user.tenantId, owner);
    const due = -(wallet.availableCents + Math.min(0, wallet.pendingCents));
    if (due <= 0) throw new ConflictException('Não há saldo devedor para quitar.');
    const open = await this.prisma.payment.findFirst({ where: { walletId: wallet.id, purpose: 'DEBT_SETTLEMENT', status: 'PENDING', pixExpiresAt: { gt: new Date() } } });
    if (open && open.amountCents === due) return this.debtView(open);
    if (open) {
      await this.prisma.payment.update({ where: { id: open.id }, data: { status: 'CANCELED', canceledAt: new Date() } });
      await this.jobs.cancel(`pix-expire:${open.id}`);
    }

    const payer = await this.prisma.user.findUniqueOrThrow({ where: { id: user.userId }, select: { email: true } });
    const payment = await this.prisma.payment.create({
      data: { tenantId: user.tenantId, purpose: 'DEBT_SETTLEMENT', walletId: wallet.id, payerUserId: user.userId, method: 'PIX', amountCents: due, provider: gateway.name },
    });
    await this.createPixCharge(payment.id, user.tenantId, due, 'Quitação de saldo devedor', payer.email);
    return this.debtView(await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }));
  }

  private debtView(payment: { id: string; amountCents: number; status: PaymentStatus; pixCopyPaste: string | null; pixExpiresAt: Date | null }) {
    return { id: payment.id, amountCents: payment.amountCents, status: payment.status, pixCopyPaste: payment.pixCopyPaste, pixExpiresAt: payment.pixExpiresAt };
  }

  // ---------------------------------------------------------------------------
  // Webhooks e sandbox
  // ---------------------------------------------------------------------------

  async handleWebhook(provider: string, headers: Record<string, string | string[] | undefined>, body: unknown) {
    if (!this.gateway || provider !== this.gateway.name) throw new NotFoundException('Provedor não configurado.');
    let event;
    try {
      event = await this.gateway.parseWebhook(headers, body);
    } catch (error) {
      this.logger.warn(`Webhook rejeitado: ${(error as Error).message}`);
      throw new ForbiddenException('Assinatura inválida.');
    }
    if (!event) return { ignored: true };
    const payment = await this.prisma.payment.findUnique({ where: { provider_providerPaymentId: { provider, providerPaymentId: event.providerPaymentId } } });
    // Idempotência: o mesmo evento pode ser reenviado pelo provedor.
    const stored = await this.prisma.paymentEvent.upsert({
      where: { provider_providerEventId: { provider, providerEventId: event.eventId } },
      create: { provider, providerEventId: event.eventId, type: event.type, payload: (body ?? {}) as Prisma.InputJsonValue, paymentId: payment?.id },
      update: {},
    });
    if (stored.processedAt || !payment) return { received: true };
    await this.applyGatewayStatus(payment.id, event.status);
    await this.prisma.paymentEvent.update({ where: { id: stored.id }, data: { processedAt: new Date() } });
    return { received: true };
  }

  private async applyGatewayStatus(paymentId: string, status: GatewayStatus) {
    if (status === 'PAID' || status === 'AUTHORIZED') await this.markPaid(paymentId);
    if (status === 'FAILED' || status === 'CANCELED') await this.markFailed(paymentId, 'Pagamento não aprovado pelo provedor.');
  }

  /** Simula a confirmação do PIX (equivalente ao webhook). Apenas com o gateway sandbox, que é proibido em produção. */
  async sandboxApprove(user: AuthUser, paymentId: string) {
    if (!(this.gateway instanceof SandboxGateway) || this.config.isProduction) throw new ForbiddenException('Disponível apenas no ambiente de testes (sandbox).');
    const payment = await this.prisma.payment.findFirst({ where: { id: paymentId, tenantId: user.tenantId } });
    if (!payment || (payment.payerUserId !== user.userId && !user.can('payments.manage'))) throw new NotFoundException('Pagamento não encontrado.');
    if (payment.status !== 'PENDING') throw new ConflictException('Pagamento não está pendente.');
    if (payment.providerPaymentId) this.gateway.simulatePaid(payment.providerPaymentId);
    await this.markPaid(paymentId);
    return this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { id: true, status: true, paidAt: true } });
  }

  /** Consulta o provedor e aplica o status (botão "já paguei" e conciliação). */
  async sync(user: AuthUser, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({ where: { id: paymentId, tenantId: user.tenantId } });
    if (!payment || (payment.payerUserId !== user.userId && !user.can('payments.manage'))) throw new NotFoundException('Pagamento não encontrado.');
    if (payment.status === 'PENDING' && payment.providerPaymentId && this.gateway) {
      await this.applyGatewayStatus(paymentId, await this.gateway.getStatus(payment.providerPaymentId));
    }
    return this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { id: true, status: true, paidAt: true, failureReason: true } });
  }

  // ---------------------------------------------------------------------------
  // Cancelamentos e estornos
  // ---------------------------------------------------------------------------

  @OnEvent(ORDER_STATUS_CHANGED, { async: true, promisify: true })
  async onOrderStatus(event: OrderStatusChangedEvent) {
    if (event.to !== 'CANCELED') return;
    try {
      await this.coupons.release(event.orderId);
      const payment = await this.prisma.payment.findFirst({ where: { orderId: event.orderId, method: { in: ONLINE } }, orderBy: { createdAt: 'desc' } });
      if (!payment) return;
      if (payment.status === 'PENDING' || payment.status === 'AUTHORIZED') {
        await this.prisma.payment.updateMany({ where: { id: payment.id, status: payment.status }, data: { status: 'CANCELED', canceledAt: new Date() } });
        await this.prisma.order.update({ where: { id: event.orderId }, data: { paymentStatus: 'CANCELED' } });
        await this.jobs.cancel(`pix-expire:${payment.id}`);
      } else if (payment.status === 'PAID' && payment.refundedCents < payment.amountCents) {
        await this.refund(null, payment.id, payment.amountCents - payment.refundedCents, `Pedido cancelado: ${event.reason ?? 'sem motivo informado'}`, payment.method === 'WALLET');
      }
    } catch (error) {
      this.logger.error(`Falha no estorno do pedido ${event.orderId}: ${(error as Error).message}`);
    }
  }

  /**
   * Estorno total ou parcial. `toWallet` credita a carteira de quem pagou em vez do meio original
   * (instantâneo; obrigatório para pagamentos com carteira, dinheiro ou faturados).
   */
  async refund(actor: AuthUser | null, paymentId: string, amountCents: number, reason: string, toWallet = false) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || (actor && payment.tenantId !== actor.tenantId)) throw new NotFoundException('Pagamento não encontrado.');
    if (!['PAID', 'PARTIALLY_REFUNDED'].includes(payment.status)) throw new ConflictException('Somente pagamentos aprovados podem ser estornados.');
    if (payment.purpose === 'DEBT_SETTLEMENT') throw new ConflictException('Quitações de saldo não podem ser estornadas por aqui. Use um ajuste manual.');
    const refundable = payment.amountCents - payment.refundedCents;
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > refundable) {
      throw new BadRequestException(`Valor máximo para estorno: R$ ${(refundable / 100).toFixed(2).replace('.', ',')}.`);
    }
    const creditWallet = toWallet || payment.method === 'WALLET' || payment.method === 'CASH' || payment.method === 'INVOICE';

    // Reserva o valor antes de chamar o provedor: estornos simultâneos não ultrapassam o pago.
    const reserved = await this.prisma.payment.updateMany({
      where: { id: paymentId, refundedCents: payment.refundedCents },
      data: { refundedCents: { increment: amountCents } },
    });
    if (reserved.count === 0) throw new ConflictException('Outro estorno está em andamento. Atualize e tente novamente.');

    const refund = await this.prisma.refund.create({ data: { paymentId, amountCents, reason, toWallet: creditWallet, createdById: actor?.userId ?? null } });
    let status: 'SUCCEEDED' | 'PENDING' | 'FAILED' = 'SUCCEEDED';
    let providerRefundId: string | undefined;
    if (creditWallet) {
      const owner = await this.refundOwner(payment);
      await this.prisma.$transaction((tx) =>
        this.ledger.post(tx, payment.tenantId, [
          { owner, type: 'REFUND', amountCents, description: `Estorno: ${reason}`, orderId: payment.orderId ?? undefined, deliveryId: payment.deliveryId ?? undefined, paymentId, referenceKey: `refund:${refund.id}:payer` },
        ]),
      );
    } else {
      try {
        const result = await this.requireGateway().refund({ providerPaymentId: payment.providerPaymentId!, amountCents, idempotencyKey: refund.id });
        status = result.status;
        providerRefundId = result.providerRefundId;
      } catch (error) {
        status = 'FAILED';
        this.logger.error(`Estorno ${refund.id} falhou no provedor: ${(error as Error).message}`);
      }
    }
    await this.prisma.refund.update({ where: { id: refund.id }, data: { status, providerRefundId } });
    if (status === 'FAILED') {
      await this.prisma.payment.update({ where: { id: paymentId }, data: { refundedCents: { decrement: amountCents } } });
      throw new ConflictException('O provedor recusou o estorno. Tente novamente ou estorne em crédito na carteira.');
    }

    const current = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const nextStatus: PaymentStatus = current.refundedCents >= current.amountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    await this.prisma.payment.update({ where: { id: paymentId }, data: { status: nextStatus } });
    if (payment.orderId) await this.prisma.order.update({ where: { id: payment.orderId }, data: { paymentStatus: nextStatus } });
    if (payment.deliveryId) await this.prisma.delivery.update({ where: { id: payment.deliveryId }, data: { paymentStatus: nextStatus } });
    // Estornos após a liquidação são custo da plataforma; ajustes com a empresa são feitos manualmente.
    if (await this.isSettled(payment)) {
      await this.prisma.$transaction((tx) =>
        this.ledger.post(tx, payment.tenantId, [
          { owner: { type: 'PLATFORM' }, type: 'REFUND', amountCents: -amountCents, description: `Estorno: ${reason}`, orderId: payment.orderId ?? undefined, deliveryId: payment.deliveryId ?? undefined, paymentId, referenceKey: `refund:${refund.id}:platform` },
        ]),
      );
    }
    await this.audit.log({
      action: 'payment.refund',
      entityType: 'Payment',
      entityId: paymentId,
      actorId: actor?.userId ?? null,
      tenantId: payment.tenantId,
      after: { amountCents, reason, toWallet: creditWallet, status: nextStatus },
    });
    return this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { refunds: { orderBy: { createdAt: 'asc' } } } });
  }

  private async isSettled(payment: { orderId: string | null; deliveryId: string | null }): Promise<boolean> {
    if (payment.orderId) {
      const order = await this.prisma.order.findUnique({ where: { id: payment.orderId }, select: { settledAt: true } });
      return !!order?.settledAt;
    }
    if (payment.deliveryId) {
      const entry = await this.prisma.walletTransaction.findUnique({ where: { referenceKey: `delivery:${payment.deliveryId}:platform-fee` }, select: { id: true } });
      return !!entry;
    }
    return false;
  }

  /** Quem recebe o crédito do estorno: a carteira que pagou (empresa, em entregas da empresa) ou o cliente. */
  private async refundOwner(payment: { payerUserId: string; deliveryId: string | null }): Promise<WalletOwner> {
    if (payment.deliveryId) {
      const delivery = await this.prisma.delivery.findUnique({ where: { id: payment.deliveryId }, select: { companyId: true, kind: true } });
      if (delivery?.kind === 'ON_DEMAND' && delivery.companyId) return { type: 'COMPANY', companyId: delivery.companyId };
    }
    const customer = await this.prisma.customer.findUnique({ where: { userId: payment.payerUserId }, select: { id: true } });
    if (!customer) throw new BadRequestException('O pagador não possui carteira de cliente.');
    return { type: 'CUSTOMER', customerId: customer.id };
  }

  // ---------------------------------------------------------------------------
  // Consultas (painel)
  // ---------------------------------------------------------------------------

  async list(tenantId: string, query: PaymentsQuery) {
    const where: Prisma.PaymentWhereInput = {
      tenantId,
      status: query.status,
      method: query.method,
      purpose: query.purpose,
      createdAt: query.from || query.to ? { gte: query.from ? new Date(query.from) : undefined, lt: query.to ? new Date(query.to) : undefined } : undefined,
      ...(query.search ? { providerPaymentId: { contains: query.search } } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: skipOf(query), take: query.pageSize, include: { refunds: { orderBy: { createdAt: 'asc' } } } }),
    ]);
    const orderIds = rows.map((row) => row.orderId).filter((id): id is string => !!id);
    const orders = await this.prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, number: true, company: { select: { tradeName: true } } } });
    const byId = new Map(orders.map((order) => [order.id, order]));
    return paginated(
      rows.map(({ pixCopyPaste: _pix, ...row }) => ({ ...row, order: row.orderId ? (byId.get(row.orderId) ?? null) : null })),
      total,
      query,
    );
  }

  async get(tenantId: string, id: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, tenantId },
      include: {
        refunds: { orderBy: { createdAt: 'asc' } },
        events: { orderBy: { createdAt: 'asc' }, select: { id: true, type: true, providerEventId: true, processedAt: true, createdAt: true } },
      },
    });
    if (!payment) throw new NotFoundException('Pagamento não encontrado.');
    const { pixCopyPaste: _pix, ...rest } = payment;
    return rest;
  }
}
