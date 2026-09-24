import { Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { formatBRL } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppConfig } from '../../config/config.module';
import { SettingsService } from '../settings/settings.service';
import { ORDER_STATUS_CHANGED, OrderStatusChangedEvent } from '../orders/orders.service';
import { DeliveriesService, DELIVERY_STATUS_CHANGED, DeliveryStatusChangedEvent } from '../logistics/deliveries.service';
import { DispatchService } from '../logistics/dispatch.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CommissionService } from './commission.service';
import { LedgerEntryInput, LedgerService, WalletOwner } from './ledger.service';
import { PaymentsService } from './payments.service';

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * Liquidação: transforma pedidos e entregas concluídos em lançamentos no razão.
 *
 * Pedido entregue (valores em centavos):
 *   empresa    +subtotal −cupom(loja) −comissão          (liberado após companyReleaseDays)
 *   entregador +repasse +gorjeta                          (frota própria: creditados à empresa)
 *   plataforma +comissão +taxa de serviço +taxa de entrega −repasse −cupom(plataforma)
 *   dinheiro   quem recebeu em mãos (entregador, ou a loja na retirada/frota própria) −total
 * Fechamento: a soma dos lançamentos de um pedido é igual ao valor recebido pelo gateway
 * (pagamento online) ou zero (dinheiro — o valor fica registrado como dívida de quem o recebeu).
 */
@Injectable()
export class SettlementService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
    private readonly commission: CommissionService,
    private readonly payments: PaymentsService,
    private readonly deliveries: DeliveriesService,
    private readonly dispatch: DispatchService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.deliveries.registerOnDemandPayment({
      methods: (isCompany) => (isCompany ? ['CASH', 'INVOICE', 'WALLET'] : ['CASH', 'WALLET']),
      chargeWallet: (tx, input) => this.payments.chargeDeliveryFromWallet(tx, input),
    });
    this.dispatch.registerCandidateFilter((delivery, candidates) => this.filterCashDebt(delivery, candidates));
  }

  /** Reprocessa pendências logo após a inicialização (ex.: queda durante uma liquidação). */
  onApplicationBootstrap(): void {
    if (this.config.isTest) return;
    setTimeout(() => void this.sweepUnsettled().catch((error) => this.logger.error(`Varredura inicial: ${(error as Error).message}`)), 15_000).unref();
  }

  private async releaseDates(tenantId: string) {
    const finance = await this.settings.get(tenantId, 'finance');
    const now = Date.now();
    return {
      company: finance.companyReleaseDays > 0 ? new Date(now + finance.companyReleaseDays * DAY) : undefined,
      driver: finance.driverReleaseHours > 0 ? new Date(now + finance.driverReleaseHours * HOUR) : undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Pedidos do marketplace
  // ---------------------------------------------------------------------------

  @OnEvent(ORDER_STATUS_CHANGED, { async: true, promisify: true })
  async onOrderStatus(event: OrderStatusChangedEvent) {
    if (event.to !== 'DELIVERED') return;
    try {
      if (!(await this.settleOrder(event.orderId))) return;
      const order = await this.prisma.order.findUnique({ where: { id: event.orderId }, select: { paymentMethod: true, delivery: { select: { driverId: true } } } });
      if (order?.paymentMethod === 'CASH' && order.delivery?.driverId) await this.notifyCashLimit(order.delivery.driverId);
    } catch (error) {
      this.logger.error(`Falha na liquidação do pedido ${event.orderId}: ${(error as Error).message}`);
    }
  }

  async settleOrder(orderId: string): Promise<boolean> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        company: { select: { id: true, segmentId: true } },
        delivery: { select: { id: true, code: true, driverId: true, payoutCents: true, driver: { select: { fleetType: true, fleetCompanyId: true } } } },
      },
    });
    if (!order || order.status !== 'DELIVERED' || order.settledAt) return false;
    const coupon = order.couponId ? await this.prisma.coupon.findUnique({ where: { id: order.couponId }, select: { code: true, fundedBy: true, type: true } }) : null;
    const release = await this.releaseDates(order.tenantId);
    const label = `Pedido #${order.number}`;
    const key = (suffix: string) => `order:${order.id}:${suffix}`;
    const companyDiscount = coupon?.fundedBy === 'COMPANY' ? order.discountCents : 0;
    const platformDiscount = order.discountCents - companyDiscount;
    const company: WalletOwner = { type: 'COMPANY', companyId: order.companyId };
    const platform: WalletOwner = { type: 'PLATFORM' };

    return this.prisma.$transaction(async (tx) => {
      // Base da comissão: vendas menos o desconto em produtos bancado pela loja (entrega grátis não reduz a base).
      const productDiscount = coupon?.type === 'FREE_DELIVERY' ? 0 : companyDiscount;
      const commission = await this.commission.calculate(order.tenantId, order.company, order.subtotalCents - productDiscount, tx);
      const claimed = await tx.order.updateMany({
        where: { id: order.id, settledAt: null },
        data: { settledAt: new Date(), platformCommissionCents: commission.amountCents },
      });
      if (claimed.count === 0) return false;

      const percent = `${(commission.percentBps / 100).toLocaleString('pt-BR')}%${commission.fixedCents ? ` + ${formatBRL(commission.fixedCents)}` : ''}`;
      const base = { orderId: order.id };
      const entries: LedgerEntryInput[] = [
        { ...base, owner: company, type: 'SALE', amountCents: order.subtotalCents, description: `${label} — vendas`, availableAt: release.company, referenceKey: key('sale') },
        { ...base, owner: company, type: 'DISCOUNT', amountCents: -companyDiscount, description: `${label} — cupom ${coupon?.code ?? ''} (loja)`, availableAt: release.company, referenceKey: key('company-discount') },
        { ...base, owner: company, type: 'COMMISSION', amountCents: -commission.amountCents, description: `${label} — comissão (${percent})`, availableAt: release.company, referenceKey: key('commission') },
        { ...base, owner: platform, type: 'COMMISSION', amountCents: commission.amountCents, description: `${label} — comissão`, referenceKey: key('platform-commission') },
        { ...base, owner: platform, type: 'FEE', amountCents: order.serviceFeeCents, description: `${label} — taxa de serviço`, referenceKey: key('service-fee') },
        { ...base, owner: platform, type: 'DISCOUNT', amountCents: -platformDiscount, description: `${label} — cupom ${coupon?.code ?? ''} (plataforma)`, referenceKey: key('platform-discount') },
      ];

      const delivery = order.fulfillment === 'DELIVERY' ? order.delivery : null;
      // Quem recebe o dinheiro em mãos: o entregador (frota da plataforma) ou a própria loja.
      let cashHolder: WalletOwner = company;
      if (delivery?.driverId) {
        const ownFleet = delivery.driver?.fleetType === 'COMPANY' && !!delivery.driver.fleetCompanyId;
        const earner: WalletOwner = ownFleet ? { type: 'COMPANY', companyId: delivery.driver!.fleetCompanyId! } : { type: 'DRIVER', driverId: delivery.driverId };
        const earnerRelease = ownFleet ? release.company : release.driver;
        cashHolder = earner;
        entries.push(
          { ...base, owner: platform, type: 'FEE', amountCents: order.deliveryFeeCents, description: `${label} — taxa de entrega`, deliveryId: delivery.id, referenceKey: key('delivery-fee') },
          ...this.driverPay({ ...delivery, orderId: order.id }, earner, earnerRelease, delivery.payoutCents, order.tipCents, `${label} · entrega ${delivery.code}`),
        );
      } else {
        // Retirada na loja (ou pedido sem entregador): taxas residuais ficam com quem prestou o serviço.
        entries.push(
          { ...base, owner: platform, type: 'FEE', amountCents: order.deliveryFeeCents, description: `${label} — taxa de entrega`, referenceKey: key('delivery-fee') },
          { ...base, owner: company, type: 'TIP', amountCents: order.tipCents, description: `${label} — gorjeta`, availableAt: release.company, referenceKey: key('tip') },
        );
      }

      if (order.paymentMethod === 'CASH') {
        entries.push({ ...base, owner: cashHolder, type: 'CASH_COLLECTED', amountCents: -order.totalCents, description: `${label} — dinheiro recebido do cliente`, referenceKey: key('cash') });
        const existing = await tx.payment.findFirst({ where: { orderId: order.id, method: 'CASH' }, select: { id: true } });
        if (!existing) {
          const customer = await tx.customer.findUniqueOrThrow({ where: { id: order.customerId }, select: { userId: true } });
          await tx.payment.create({
            data: { tenantId: order.tenantId, purpose: 'ORDER', orderId: order.id, payerUserId: customer.userId, method: 'CASH', status: 'PAID', amountCents: order.totalCents, provider: 'cash', paidAt: new Date() },
          });
        }
        await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID' } });
      }

      await this.ledger.post(tx, order.tenantId, entries);
      return true;
    });
  }

  /** Repasse do entregador (ou da empresa dona da frota) e o custo correspondente da plataforma. */
  private driverPay(
    delivery: { id: string; code: string; orderId?: string | null },
    earner: WalletOwner,
    availableAt: Date | undefined,
    payoutCents: number,
    tipCents: number,
    label: string,
  ): LedgerEntryInput[] {
    const key = (suffix: string) => `delivery:${delivery.id}:${suffix}`;
    const refs = { deliveryId: delivery.id, orderId: delivery.orderId ?? undefined };
    return [
      { ...refs, owner: earner, type: 'EARNING', amountCents: payoutCents, description: `${label} — repasse`, availableAt, referenceKey: key('earning') },
      { ...refs, owner: { type: 'PLATFORM' }, type: 'EARNING', amountCents: -payoutCents, description: `Repasse da entrega ${delivery.code}`, referenceKey: key('platform-payout') },
      { ...refs, owner: earner, type: 'TIP', amountCents: tipCents, description: `${label} — gorjeta`, availableAt, referenceKey: key('tip') },
    ];
  }

  // ---------------------------------------------------------------------------
  // Entregas avulsas e tentativas sem sucesso
  // ---------------------------------------------------------------------------

  @OnEvent(DELIVERY_STATUS_CHANGED, { async: true, promisify: true })
  async onDeliveryStatus(event: DeliveryStatusChangedEvent) {
    try {
      if (event.kind === 'ON_DEMAND' && event.to === 'DELIVERED') {
        await this.settleOnDemand(event.deliveryId);
        if (event.driverId) await this.notifyCashLimit(event.driverId);
      }
      if (event.to === 'FAILED') await this.settleFailedAttempt(event.deliveryId);
      if (event.kind === 'ON_DEMAND' && event.to === 'CANCELED') await this.settleCanceledOnDemand(event.deliveryId, event.reason);
    } catch (error) {
      this.logger.error(`Falha na liquidação da entrega ${event.deliveryId}: ${(error as Error).message}`);
    }
  }

  private async loadDelivery(deliveryId: string) {
    return this.prisma.delivery.findUnique({ where: { id: deliveryId }, include: { driver: { select: { fleetType: true, fleetCompanyId: true } } } });
  }

  private earnerOf(delivery: { driverId: string | null; driver: { fleetType: string; fleetCompanyId: string | null } | null }): WalletOwner | null {
    if (!delivery.driverId) return null;
    if (delivery.driver?.fleetType === 'COMPANY' && delivery.driver.fleetCompanyId) return { type: 'COMPANY', companyId: delivery.driver.fleetCompanyId };
    return { type: 'DRIVER', driverId: delivery.driverId };
  }

  /** Entrega avulsa concluída: cobra o solicitante (dinheiro/faturado) e paga o entregador. */
  async settleOnDemand(deliveryId: string) {
    const delivery = await this.loadDelivery(deliveryId);
    if (!delivery || delivery.kind !== 'ON_DEMAND' || delivery.status !== 'DELIVERED') return;
    const earner = this.earnerOf(delivery);
    if (!earner) return;
    const release = await this.releaseDates(delivery.tenantId);
    const label = `Entrega ${delivery.code}`;
    const key = (suffix: string) => `delivery:${delivery.id}:${suffix}`;
    const charged = delivery.feeCents + delivery.tipCents;
    const entries: LedgerEntryInput[] = [
      { owner: { type: 'PLATFORM' }, type: 'FEE', amountCents: delivery.feeCents, description: `${label} — taxa de entrega`, deliveryId, referenceKey: key('platform-fee') },
      ...this.driverPay(delivery, earner, earner.type === 'COMPANY' ? release.company : release.driver, delivery.payoutCents, delivery.tipCents, label),
    ];
    if (delivery.paymentMethod === 'CASH') {
      entries.push({ owner: earner, type: 'CASH_COLLECTED', amountCents: -charged, description: `${label} — dinheiro recebido`, deliveryId, referenceKey: key('cash') });
    }
    if (delivery.paymentMethod === 'INVOICE' && delivery.companyId) {
      entries.push({ owner: { type: 'COMPANY', companyId: delivery.companyId }, type: 'FEE', amountCents: -charged, description: `${label} — entrega faturada`, deliveryId, referenceKey: key('invoice') });
    }
    await this.prisma.$transaction(async (tx) => {
      await this.ledger.post(tx, delivery.tenantId, entries);
      if (delivery.paymentMethod === 'CASH' || delivery.paymentMethod === 'INVOICE') {
        const existing = await tx.payment.findFirst({ where: { deliveryId, method: delivery.paymentMethod }, select: { id: true } });
        if (!existing) {
          await tx.payment.create({
            data: {
              tenantId: delivery.tenantId,
              purpose: 'DELIVERY',
              deliveryId,
              payerUserId: delivery.requesterUserId,
              method: delivery.paymentMethod,
              status: 'PAID',
              amountCents: charged,
              provider: delivery.paymentMethod === 'CASH' ? 'cash' : 'invoice',
              paidAt: new Date(),
            },
          });
        }
        await tx.delivery.update({ where: { id: deliveryId }, data: { paymentStatus: 'PAID' } });
      }
    });
  }

  /**
   * Tentativa sem sucesso (destinatário ausente, endereço incorreto...): o entregador recebe o repasse
   * pelo deslocamento. Em avulsas pagas (carteira/faturado) a taxa é cobrada e a gorjeta devolvida;
   * em pedidos, o estorno ao cliente segue o cancelamento do pedido.
   */
  async settleFailedAttempt(deliveryId: string) {
    const delivery = await this.loadDelivery(deliveryId);
    if (!delivery || delivery.status !== 'FAILED') return;
    const earner = this.earnerOf(delivery);
    if (!earner) return;
    const release = await this.releaseDates(delivery.tenantId);
    const label = `Tentativa de entrega ${delivery.code}`;
    const key = (suffix: string) => `delivery:${delivery.id}:${suffix}`;
    const entries: LedgerEntryInput[] = this.driverPay(delivery, earner, earner.type === 'COMPANY' ? release.company : release.driver, delivery.payoutCents, 0, label);

    if (delivery.kind === 'ON_DEMAND' && (delivery.paymentMethod === 'WALLET' || delivery.paymentMethod === 'INVOICE')) {
      entries.push({ owner: { type: 'PLATFORM' }, type: 'FEE', amountCents: delivery.feeCents, description: `${label} — taxa de entrega`, deliveryId, referenceKey: key('platform-fee') });
      if (delivery.paymentMethod === 'INVOICE' && delivery.companyId) {
        entries.push({ owner: { type: 'COMPANY', companyId: delivery.companyId }, type: 'FEE', amountCents: -delivery.feeCents, description: `${label} — entrega faturada`, deliveryId, referenceKey: key('invoice') });
      }
    }
    await this.prisma.$transaction((tx) => this.ledger.post(tx, delivery.tenantId, entries));

    if (delivery.kind === 'ON_DEMAND' && delivery.paymentMethod === 'WALLET' && delivery.tipCents > 0) {
      const payment = await this.prisma.payment.findFirst({ where: { deliveryId, method: 'WALLET', status: 'PAID' } });
      if (payment) await this.payments.refund(null, payment.id, Math.min(delivery.tipCents, payment.amountCents - payment.refundedCents), 'Gorjeta devolvida (entrega não realizada)', true);
    }
  }

  /** Avulsa cancelada: antes da coleta devolve tudo; após a coleta vale a regra da tentativa. */
  async settleCanceledOnDemand(deliveryId: string, reason?: string) {
    const delivery = await this.loadDelivery(deliveryId);
    if (!delivery || delivery.status !== 'CANCELED') return;
    if (delivery.pickedUpAt) {
      const earner = this.earnerOf(delivery);
      if (earner) {
        const release = await this.releaseDates(delivery.tenantId);
        await this.prisma.$transaction((tx) =>
          this.ledger.post(tx, delivery.tenantId, this.driverPay(delivery, earner, earner.type === 'COMPANY' ? release.company : release.driver, delivery.payoutCents, 0, `Entrega ${delivery.code} (cancelada após a coleta)`)),
        );
      }
    }
    const payment = await this.prisma.payment.findFirst({ where: { deliveryId, method: 'WALLET', status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } } });
    if (payment && payment.refundedCents < payment.amountCents) {
      await this.payments.refund(null, payment.id, payment.amountCents - payment.refundedCents, `Entrega cancelada${reason ? `: ${reason}` : ''}`, true);
    }
  }

  // ---------------------------------------------------------------------------
  // Limite de dinheiro em mãos (despacho)
  // ---------------------------------------------------------------------------

  /** Entregas pagas em dinheiro não são oferecidas a quem já deve acima do limite à plataforma. */
  private async filterCashDebt<T extends { driverId: string }>(delivery: { tenantId: string; paymentMethod: string | null }, candidates: T[]): Promise<T[]> {
    if (delivery.paymentMethod !== 'CASH' || candidates.length === 0) return candidates;
    const { maxDriverCashDebtCents } = await this.settings.get(delivery.tenantId, 'finance');
    const wallets = await this.prisma.wallet.findMany({
      where: { driverId: { in: candidates.map((candidate) => candidate.driverId) }, availableCents: { lt: -maxDriverCashDebtCents } },
      select: { driverId: true },
    });
    const blocked = new Set(wallets.map((wallet) => wallet.driverId));
    return candidates.filter((candidate) => !blocked.has(candidate.driverId));
  }

  // ---------------------------------------------------------------------------
  // Resiliência: reprocessa liquidações que falharam (ex.: queda durante o evento)
  // ---------------------------------------------------------------------------

  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweepUnsettled(): Promise<number> {
    const cutoff = new Date(Date.now() - 5 * 60_000);
    const orders = await this.prisma.order.findMany({ where: { status: 'DELIVERED', settledAt: null, deliveredAt: { lt: cutoff } }, select: { id: true }, take: 200 });
    let settled = 0;
    for (const order of orders) {
      if (await this.settleOrder(order.id).catch(() => false)) settled += 1;
    }
    const deliveries = await this.prisma.delivery.findMany({
      where: { kind: 'ON_DEMAND', status: 'DELIVERED', deliveredAt: { lt: cutoff, gt: new Date(Date.now() - 7 * DAY) } },
      select: { id: true },
      take: 500,
    });
    const done = new Set(
      (await this.prisma.walletTransaction.findMany({ where: { referenceKey: { in: deliveries.map((d) => `delivery:${d.id}:platform-fee`) } }, select: { deliveryId: true } })).map((row) => row.deliveryId),
    );
    for (const delivery of deliveries.filter((d) => !done.has(d.id))) {
      await this.settleOnDemand(delivery.id).catch((error) => this.logger.error(`Reprocessamento da entrega ${delivery.id}: ${(error as Error).message}`));
      settled += 1;
    }
    if (settled) this.logger.log(`${settled} liquidação(ões) reprocessada(s).`);
    return settled;
  }

  /** Aviso ao entregador quando o saldo devedor atinge o limite (recebe só pedidos pagos online). */
  async notifyCashLimit(driverId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId }, select: { userId: true, tenantId: true } });
    const wallet = await this.prisma.wallet.findUnique({ where: { driverId } });
    if (!driver || !wallet) return;
    const { maxDriverCashDebtCents } = await this.settings.get(driver.tenantId, 'finance');
    if (wallet.availableCents >= -maxDriverCashDebtCents) return;
    await this.notifications.notify({
      userId: driver.userId,
      type: 'driver.cash_limit',
      title: 'Limite de dinheiro em mãos atingido',
      body: `Seu saldo devedor é ${formatBRL(-wallet.availableCents)}. Quite pelo app para voltar a receber pedidos pagos em dinheiro.`,
      channels: ['inapp', 'push'],
      app: 'DRIVER',
    });
  }
}
