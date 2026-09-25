import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { applyBps, earnedPoints, nextTier, tierFor, tierRank, type LoyaltyTier } from '@levoja/shared';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { SettingsService, SettingValue } from '../settings/settings.service';
import { LedgerService } from '../finance/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { CouponContext, CouponsService } from '../coupons/coupons.service';
import { ORDER_STATUS_CHANGED, OrderStatusChangedEvent } from '../orders/orders.service';
import { paginated, PaginationQueryDto, skipOf } from '../../common/pagination';
import { utcTimestamp } from '../../common/sql';
import { retryOnConflict } from '../../common/retry';
import type { AuthUser } from '../../common/auth/auth-user';
import type { Coupon } from '../../generated/prisma/client';
import { Prisma } from '../../generated/prisma/client';

type LoyaltyConfig = SettingValue<'loyalty'>;

const DAY = 86_400_000;
/** Nível = pontos ganhos nos últimos 12 meses. */
const TIER_WINDOW_DAYS = 365;

export interface LoyaltyAccountsQuery extends PaginationQueryDto {
  tier?: string;
}

/**
 * Programa de fidelidade (configuração `loyalty`, desligado por padrão):
 * - pedido entregue gera pontos (valor dos produtos × pontos por real × multiplicador do nível)
 *   e, nos níveis com cashback, crédito na carteira do cliente (custo da plataforma);
 * - o nível vem dos pontos ganhos nos últimos 12 meses (sobe na hora, desce na revisão diária);
 * - pontos viram saldo na carteira (resgate), usado como forma de pagamento no checkout;
 * - saldo expira após o período configurado sem ganhar pontos; ajustes manuais ficam na auditoria.
 */
@Injectable()
export class LoyaltyService implements OnModuleInit {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly coupons: CouponsService,
  ) {}

  onModuleInit(): void {
    this.coupons.registerEligibility((coupon, context) => this.tierEligibility(coupon, context));
  }

  private sortedTiers(config: LoyaltyConfig): LoyaltyTier[] {
    return [...config.tiers].sort((a, b) => a.minPoints - b.minPoints);
  }

  private tierOf(config: LoyaltyConfig, key: string | null | undefined): LoyaltyTier {
    const tiers = this.sortedTiers(config);
    return tiers.find((tier) => tier.key === key) ?? tiers[0];
  }

  async account(tenantId: string, customerId: string, tx: Tx = this.prisma) {
    const existing = await tx.loyaltyAccount.findUnique({ where: { customerId } });
    if (existing) return existing;
    const config = await this.settings.get(tenantId, 'loyalty');
    return tx.loyaltyAccount.upsert({ where: { customerId }, create: { customerId, tenantId, tier: this.sortedTiers(config)[0].key }, update: {} });
  }

  /** Cupom exclusivo de nível: o cliente precisa estar no nível mínimo (ou acima). */
  async tierEligibility(coupon: Coupon, context: CouponContext): Promise<string | null> {
    if (coupon.visibility !== 'TIER' || !coupon.minTier) return null;
    const config = await this.settings.get(context.tenantId, 'loyalty');
    if (!config.enabled) return 'Cupom exclusivo do programa de fidelidade.';
    const account = await this.prisma.loyaltyAccount.findUnique({ where: { customerId: context.customerId }, select: { tier: true } });
    const tiers = this.sortedTiers(config);
    const current = this.tierOf(config, account?.tier);
    if (tierRank(current.key, tiers) >= tierRank(coupon.minTier, tiers)) return null;
    return `Cupom exclusivo para clientes ${tiers.find((tier) => tier.key === coupon.minTier)?.name ?? coupon.minTier} ou superior.`;
  }

  // ---------------------------------------------------------------------------
  // Pontos por pedido entregue
  // ---------------------------------------------------------------------------

  @OnEvent(ORDER_STATUS_CHANGED, { async: true, promisify: true })
  async onOrderStatus(event: OrderStatusChangedEvent) {
    if (event.to !== 'DELIVERED') return;
    await this.earnForOrder(event.orderId).catch((error) => this.logger.error(`Pontos do pedido ${event.orderId} não lançados: ${(error as Error).message}`));
  }

  /** Lança pontos e cashback de um pedido entregue (idempotente). */
  async earnForOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, tenantId: true, customerId: true, number: true, status: true, subtotalCents: true, discountCents: true, company: { select: { tradeName: true } }, customer: { select: { userId: true } } },
    });
    if (!order || order.status !== 'DELIVERED') return null;
    const config = await this.settings.get(order.tenantId, 'loyalty');
    if (!config.enabled) return null;
    const referenceKey = `loyalty:order:${order.id}:earn`;
    if (await this.prisma.loyaltyTransaction.findUnique({ where: { referenceKey }, select: { id: true } })) return null;

    // Base: valor dos produtos pago pelo cliente (desconto de entrega grátis não reduz a base).
    const redemption = await this.prisma.couponRedemption.findUnique({ where: { orderId }, select: { discountCents: true, coupon: { select: { type: true } } } });
    const productDiscount = redemption && redemption.coupon.type !== 'FREE_DELIVERY' ? redemption.discountCents : 0;
    const base = Math.max(0, order.subtotalCents - productDiscount);

    const account = await this.account(order.tenantId, order.customerId);
    const tier = this.tierOf(config, account.tier);
    const points = earnedPoints(base, config.pointsPerReal, tier.multiplierBps);
    const cashbackCents = applyBps(base, tier.cashbackBps);
    const label = `Pedido #${order.number} — ${order.company.tradeName}`;

    try {
      await retryOnConflict(() => this.prisma.$transaction(async (tx) => {
        if (points > 0) {
          await tx.loyaltyTransaction.create({ data: { tenantId: order.tenantId, customerId: order.customerId, type: 'EARN', points, description: label, orderId: order.id, referenceKey } });
          await tx.loyaltyAccount.update({ where: { customerId: order.customerId }, data: { points: { increment: points }, lifetimePoints: { increment: points }, lastEarnedAt: new Date() } });
        }
        if (cashbackCents > 0) {
          await this.ledger.post(tx, order.tenantId, [
            { owner: { type: 'CUSTOMER', customerId: order.customerId }, type: 'CREDIT', amountCents: cashbackCents, description: `Cashback ${tier.name} — pedido #${order.number}`, orderId: order.id, referenceKey: `order:${order.id}:cashback` },
            { owner: { type: 'PLATFORM' }, type: 'DISCOUNT', amountCents: -cashbackCents, description: `Cashback de fidelidade — pedido #${order.number}`, orderId: order.id, referenceKey: `order:${order.id}:cashback-platform` },
          ]);
        }
      }));
    } catch (error) {
      // Evento repetido para o mesmo pedido: a chave única garante um único lançamento.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
      throw error;
    }
    if (points === 0 && cashbackCents === 0) return { points, cashbackCents };

    const { promoted } = await this.refreshTier(order.tenantId, order.customerId, config);
    const parts = [points > 0 ? `${points.toLocaleString('pt-BR')} pontos` : null, cashbackCents > 0 ? `R$ ${(cashbackCents / 100).toFixed(2).replace('.', ',')} de cashback` : null].filter(Boolean);
    await this.notifications.notify({
      userId: order.customer.userId,
      type: 'loyalty.earned',
      title: promoted ? `Você agora é ${promoted.name}!` : 'Você ganhou pontos',
      body: `${label}: ${parts.join(' e ')}.${promoted ? ` Novo nível com ${promoted.multiplierBps / 10_000}x pontos${promoted.cashbackBps ? ` e ${promoted.cashbackBps / 100}% de cashback` : ''}.` : ''}`,
      data: { orderId: order.id, points, cashbackCents },
      channels: promoted ? ['inapp', 'push'] : ['inapp'],
      app: 'CUSTOMER',
    });
    return { points, cashbackCents };
  }

  /** Pontos que contam para o nível (ganhos e ajustes dos últimos 12 meses). */
  private async windowPoints(customerId: string, now = new Date()): Promise<number> {
    const since = new Date(now.getTime() - TIER_WINDOW_DAYS * DAY);
    const sum = await this.prisma.loyaltyTransaction.aggregate({ where: { customerId, type: { in: ['EARN', 'ADJUST'] }, createdAt: { gte: since } }, _sum: { points: true } });
    return Math.max(0, sum._sum.points ?? 0);
  }

  /** Recalcula o nível; `promoted` traz o novo nível quando o cliente subiu. */
  async refreshTier(tenantId: string, customerId: string, config?: LoyaltyConfig): Promise<{ changed: boolean; promoted: LoyaltyTier | null }> {
    const loyalty = config ?? (await this.settings.get(tenantId, 'loyalty'));
    const tiers = this.sortedTiers(loyalty);
    const account = await this.account(tenantId, customerId);
    const target = tierFor(await this.windowPoints(customerId), tiers);
    if (target.key === account.tier) return { changed: false, promoted: null };
    await this.prisma.loyaltyAccount.update({ where: { customerId }, data: { tier: target.key } });
    return { changed: true, promoted: tierRank(target.key, tiers) > tierRank(account.tier, tiers) ? target : null };
  }

  // ---------------------------------------------------------------------------
  // Cliente
  // ---------------------------------------------------------------------------

  private customerId(user: AuthUser): string {
    if (!user.customerId) throw new ForbiddenException('Disponível para clientes.');
    return user.customerId;
  }

  async summary(user: AuthUser) {
    const customerId = this.customerId(user);
    const config = await this.settings.get(user.tenantId, 'loyalty');
    if (!config.enabled) return { enabled: false as const };
    const account = await this.account(user.tenantId, customerId);
    const tiers = this.sortedTiers(config);
    const tier = this.tierOf(config, account.tier);
    const yearPoints = await this.windowPoints(customerId);
    const next = nextTier(yearPoints, tiers);
    const recent = await this.prisma.loyaltyTransaction.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 10 });
    return {
      enabled: true as const,
      points: account.points,
      lifetimePoints: account.lifetimePoints,
      yearPoints,
      redeemableCents: Math.floor(account.points * config.pointValueCents),
      pointValueCents: config.pointValueCents,
      pointsPerReal: config.pointsPerReal,
      minRedeemPoints: config.minRedeemPoints,
      tier,
      next: next ? { tier: next.tier, missing: next.missing } : null,
      tiers,
      expiresAt:
        account.points > 0 && config.expireAfterInactiveDays > 0 && account.lastEarnedAt
          ? new Date(account.lastEarnedAt.getTime() + config.expireAfterInactiveDays * DAY)
          : null,
      recent,
    };
  }

  async history(user: AuthUser, query: PaginationQueryDto) {
    const customerId = this.customerId(user);
    const where = { customerId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.loyaltyTransaction.count({ where }),
      this.prisma.loyaltyTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: skipOf(query), take: query.pageSize }),
    ]);
    return paginated(rows, total, query);
  }

  /** Converte pontos em saldo na carteira do cliente. */
  async redeem(user: AuthUser, points: number) {
    const customerId = this.customerId(user);
    const config = await this.settings.get(user.tenantId, 'loyalty');
    if (!config.enabled) throw new BadRequestException('Programa de fidelidade indisponível.');
    if (points < config.minRedeemPoints) throw new BadRequestException(`O resgate mínimo é de ${config.minRedeemPoints.toLocaleString('pt-BR')} pontos.`);
    const cents = Math.floor(points * config.pointValueCents);
    if (cents < 1) throw new BadRequestException('Pontos insuficientes para gerar saldo.');
    await this.account(user.tenantId, customerId);
    const id = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      const debited = await tx.loyaltyAccount.updateMany({ where: { customerId, points: { gte: points } }, data: { points: { decrement: points } } });
      if (debited.count === 0) throw new BadRequestException('Saldo de pontos insuficiente.');
      const referenceKey = `loyalty:redeem:${id}`;
      const description = `Resgate de ${points.toLocaleString('pt-BR')} pontos`;
      await tx.loyaltyTransaction.create({ data: { tenantId: user.tenantId, customerId, type: 'REDEEM', points: -points, description, referenceKey } });
      await this.ledger.post(tx, user.tenantId, [
        { owner: { type: 'CUSTOMER', customerId }, type: 'CREDIT', amountCents: cents, description, referenceKey },
        { owner: { type: 'PLATFORM' }, type: 'DISCOUNT', amountCents: -cents, description: `Fidelidade — ${description.toLowerCase()}`, referenceKey: `${referenceKey}:platform` },
      ]);
    });
    await this.audit.log({ action: 'loyalty.redeem', entityType: 'LoyaltyAccount', entityId: customerId, metadata: { points, cents } });
    return { creditedCents: cents, summary: await this.summary(user) };
  }

  // ---------------------------------------------------------------------------
  // Rotinas
  // ---------------------------------------------------------------------------

  /** Diariamente: expira saldos parados e revisa níveis (rebaixa quem ficou abaixo do mínimo). */
  @Cron('0 20 4 * * *')
  async daily(now = new Date()) {
    const tenants = await this.prisma.loyaltyAccount.findMany({ distinct: ['tenantId'], select: { tenantId: true } });
    let expired = 0;
    let retiered = 0;
    for (const { tenantId } of tenants) {
      const config = await this.settings.get(tenantId, 'loyalty');
      if (!config.enabled) continue;
      if (config.expireAfterInactiveDays > 0) expired += await this.expireInactive(tenantId, config, now);
      const lowest = this.sortedTiers(config)[0].key;
      const upper = await this.prisma.loyaltyAccount.findMany({ where: { tenantId, tier: { not: lowest } }, select: { customerId: true } });
      for (const { customerId } of upper) if ((await this.refreshTier(tenantId, customerId, config)).changed) retiered += 1;
    }
    if (expired || retiered) this.logger.log(`Fidelidade: ${expired} saldo(s) expirado(s), ${retiered} nível(is) revisto(s).`);
    return { expired, retiered };
  }

  async expireInactive(tenantId: string, config: LoyaltyConfig, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - config.expireAfterInactiveDays * DAY);
    const stale = await this.prisma.$queryRaw<{ customerId: string; points: number; userId: string }[]>`
      SELECT a."customerId", a.points, c."userId"
      FROM loyalty_accounts a JOIN customers c ON c.id = a."customerId"
      WHERE a."tenantId" = ${tenantId}::uuid AND a.points > 0
        AND COALESCE(a."lastEarnedAt", a."updatedAt") < ${utcTimestamp(cutoff)}
      LIMIT 1000`;
    const day = now.toISOString().slice(0, 10);
    let count = 0;
    for (const row of stale) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const cleared = await tx.loyaltyAccount.updateMany({ where: { customerId: row.customerId, points: row.points }, data: { points: 0 } });
          if (cleared.count === 0) return;
          await tx.loyaltyTransaction.create({
            data: { tenantId, customerId: row.customerId, type: 'EXPIRE', points: -row.points, description: `Pontos expirados após ${config.expireAfterInactiveDays} dias sem compras`, referenceKey: `loyalty:expire:${row.customerId}:${day}` },
          });
          count += 1;
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        continue;
      }
      await this.notifications.notify({ userId: row.userId, type: 'loyalty.expired', title: 'Seus pontos expiraram', body: `${row.points.toLocaleString('pt-BR')} pontos expiraram por falta de compras no período. Faça um pedido para voltar a acumular.`, channels: ['inapp'] });
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // Painel
  // ---------------------------------------------------------------------------

  async overview(tenantId: string, now = new Date()) {
    const config = await this.settings.get(tenantId, 'loyalty');
    const since = new Date(now.getTime() - 30 * DAY);
    const [byTier, balance, earned, redeemed, expired, cashback] = await Promise.all([
      this.prisma.loyaltyAccount.groupBy({ by: ['tier'], where: { tenantId }, _count: { _all: true } }),
      this.prisma.loyaltyAccount.aggregate({ where: { tenantId }, _sum: { points: true } }),
      this.prisma.loyaltyTransaction.aggregate({ where: { tenantId, type: 'EARN', createdAt: { gte: since } }, _sum: { points: true } }),
      this.prisma.loyaltyTransaction.aggregate({ where: { tenantId, type: 'REDEEM', createdAt: { gte: since } }, _sum: { points: true } }),
      this.prisma.loyaltyTransaction.aggregate({ where: { tenantId, type: 'EXPIRE', createdAt: { gte: since } }, _sum: { points: true } }),
      this.prisma.$queryRaw<{ cents: number }[]>`
        SELECT COALESCE(SUM(t."amountCents"), 0)::float8 AS cents
        FROM wallet_transactions t JOIN wallets w ON w.id = t."walletId"
        WHERE w."tenantId" = ${tenantId}::uuid AND w."ownerType" = 'CUSTOMER' AND t."referenceKey" LIKE 'order:%:cashback'
          AND t."createdAt" >= ${utcTimestamp(since)}`,
    ]);
    const outstanding = balance._sum.points ?? 0;
    return {
      enabled: config.enabled,
      tiers: this.sortedTiers(config).map((tier) => ({ ...tier, customers: byTier.find((row) => row.tier === tier.key)?._count._all ?? 0 })),
      outstandingPoints: outstanding,
      liabilityCents: Math.floor(outstanding * config.pointValueCents),
      last30Days: { earnedPoints: earned._sum.points ?? 0, redeemedPoints: -(redeemed._sum.points ?? 0), expiredPoints: -(expired._sum.points ?? 0), cashbackCents: Number(cashback[0]?.cents ?? 0) },
    };
  }

  async accounts(tenantId: string, query: LoyaltyAccountsQuery) {
    const search = query.search?.trim();
    const customerFilter = search
      ? { user: { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { email: { contains: search.toLowerCase() } }] } }
      : undefined;
    const customerIds = customerFilter ? (await this.prisma.customer.findMany({ where: { tenantId, ...customerFilter }, select: { id: true }, take: 500 })).map((row) => row.id) : undefined;
    const where: Prisma.LoyaltyAccountWhereInput = { tenantId, ...(query.tier ? { tier: query.tier } : {}), ...(customerIds ? { customerId: { in: customerIds } } : {}) };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.loyaltyAccount.count({ where }),
      this.prisma.loyaltyAccount.findMany({ where, orderBy: [{ lifetimePoints: 'desc' }], skip: skipOf(query), take: query.pageSize }),
    ]);
    const customers = await this.prisma.customer.findMany({ where: { id: { in: rows.map((row) => row.customerId) } }, select: { id: true, user: { select: { name: true, email: true } } } });
    const byId = new Map(customers.map((customer) => [customer.id, customer.user]));
    return paginated(
      rows.map((row) => ({ ...row, name: byId.get(row.customerId)?.name ?? '—', email: byId.get(row.customerId)?.email ?? null })),
      total,
      query,
    );
  }

  async customerHistory(tenantId: string, customerId: string, query: PaginationQueryDto) {
    if (!(await this.prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } }))) throw new NotFoundException('Cliente não encontrado.');
    const where = { customerId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.loyaltyTransaction.count({ where }),
      this.prisma.loyaltyTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: skipOf(query), take: query.pageSize }),
    ]);
    return paginated(rows, total, query);
  }

  /** Ajuste manual (crédito ou débito de pontos), com motivo e auditoria. */
  async adjust(actor: AuthUser, customerId: string, points: number, reason: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId: actor.tenantId }, select: { id: true, userId: true } });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');
    const account = await this.account(actor.tenantId, customerId);
    if (account.points + points < 0) throw new BadRequestException(`O cliente tem só ${account.points.toLocaleString('pt-BR')} pontos.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.loyaltyTransaction.create({ data: { tenantId: actor.tenantId, customerId, type: 'ADJUST', points, description: reason, referenceKey: `loyalty:adjust:${randomUUID()}` } });
      await tx.loyaltyAccount.update({
        where: { customerId },
        data: { points: { increment: points }, ...(points > 0 ? { lifetimePoints: { increment: points } } : {}) },
      });
    });
    await this.refreshTier(actor.tenantId, customerId);
    await this.audit.log({ action: 'loyalty.adjust', entityType: 'LoyaltyAccount', entityId: customerId, metadata: { points, reason } });
    await this.notifications.notify({
      userId: customer.userId,
      type: 'loyalty.adjusted',
      title: points > 0 ? 'Você recebeu pontos' : 'Ajuste nos seus pontos',
      body: `${points > 0 ? '+' : ''}${points.toLocaleString('pt-BR')} pontos: ${reason}`,
      channels: ['inapp'],
    });
    return this.prisma.loyaltyAccount.findUniqueOrThrow({ where: { customerId } });
  }
}
