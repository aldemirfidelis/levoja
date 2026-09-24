import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { RISK_SIGNAL_LABELS } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { SettingsService, SettingValue } from '../settings/settings.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuditService } from '../audit/audit.service';
import { CouponsService, CouponContext } from '../coupons/coupons.service';
import { OrdersService, ORDER_CREATED, OrderStatusChangedEvent } from '../orders/orders.service';
import { nextCounter } from '../../common/counters';
import { utcTimestamp } from '../../common/sql';
import { paginated, PaginationQueryDto, skipOf } from '../../common/pagination';
import {
  AUTH_SESSION_STARTED,
  AuthSessionStartedEvent,
  PAYMENT_FAILED,
  PaymentFailedEvent,
  RISK_SIGNAL,
  RiskSignalEvent,
} from '../../common/intelligence-events';
import type { AuthUser } from '../../common/auth/auth-user';
import { Prisma, type Coupon } from '../../generated/prisma/client';
import type { PaymentMethod, RiskCaseStatus, RiskLevel, RiskSignalType } from '../../generated/prisma/enums';
import { decayedScore, LEVEL_RANK, rateOutliers, riskLevel } from './risk.engine';

type FraudSettings = SettingValue<'fraud'>;

export interface RiskCasesQuery extends PaginationQueryDto {
  status?: RiskCaseStatus;
  level?: RiskLevel;
}

export interface RiskSignalsQuery extends PaginationQueryDto {
  type?: RiskSignalType;
  userId?: string;
}

const OPEN_CASE: RiskCaseStatus[] = ['OPEN', 'IN_REVIEW'];
const DAY = 86_400_000;

/**
 * Antifraude baseado em regras configuráveis (configuração `fraud`):
 * - outros módulos emitem sinais (RISK_SIGNAL) com a evidência; aqui eles viram pontos;
 * - o score da conta decai com o tempo (meia-vida) e define o nível (baixo/médio/alto);
 * - acima do limite, um caso é aberto para revisão humana — nada é bloqueado automaticamente;
 * - as únicas ações automáticas são leves e reversíveis: exigir pagamento online e recusar
 *   cupom de primeira compra reaproveitado. Conta liberada pela equipe fica isenta por um período.
 */
@Injectable()
export class FraudService implements OnModuleInit {
  private readonly logger = new Logger(FraudService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly coupons: CouponsService,
    private readonly orders: OrdersService,
  ) {}

  onModuleInit(): void {
    this.coupons.registerEligibility((coupon, context) => this.couponEligibility(coupon, context));
    this.orders.registerCheckoutGuard((user, input) => this.checkoutGuard(user, input));
  }

  // ---------------------------------------------------------------------------
  // Sinais, score e casos
  // ---------------------------------------------------------------------------

  @OnEvent(RISK_SIGNAL, { async: true })
  async onSignal(event: RiskSignalEvent) {
    await this.record(event).catch((error) => this.logger.error(`Sinal de risco não registrado: ${(error as Error).message}`));
  }

  /** Registra o sinal (idempotente pelo dedupeKey), recalcula o score e abre/atualiza o caso. */
  async record(event: RiskSignalEvent, fraud?: FraudSettings) {
    const config = fraud ?? (await this.settings.get(event.tenantId, 'fraud'));
    if (!config.enabled) return null;
    const points = event.type === 'MANUAL' && typeof event.details?.points === 'number' ? Number(event.details.points) : config.points[event.type];
    let signal;
    try {
      signal = await this.prisma.riskSignal.create({
        data: {
          tenantId: event.tenantId,
          userId: event.userId,
          type: event.type,
          points,
          message: event.message.slice(0, 500),
          details: (event.details ?? undefined) as Prisma.InputJsonValue | undefined,
          relatedUserIds: [...new Set(event.relatedUserIds ?? [])].filter((id) => id !== event.userId),
          orderId: event.orderId,
          deliveryId: event.deliveryId,
          paymentId: event.paymentId,
          dedupeKey: event.dedupeKey,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
      throw error;
    }
    const profile = await this.rescore(event.tenantId, event.userId, config);
    const caseId = await this.syncCase(event.tenantId, event.userId, profile, config, signal.id);
    return { signalId: signal.id, score: profile.score, level: profile.level, caseId };
  }

  /** Recalcula o score com decaimento (sinais de até 10 meias-vidas atrás). */
  async rescore(tenantId: string, userId: string, fraud?: FraudSettings, now = new Date()) {
    const config = fraud ?? (await this.settings.get(tenantId, 'fraud'));
    const since = new Date(now.getTime() - config.halfLifeDays * 10 * DAY);
    const signals = await this.prisma.riskSignal.findMany({ where: { tenantId, userId, createdAt: { gte: since } }, select: { points: true, createdAt: true } });
    const score = decayedScore(
      signals.map((signal) => ({ points: signal.points, at: signal.createdAt })),
      now,
      config.halfLifeDays,
    );
    const level = riskLevel(score, { medium: config.mediumScore, high: config.highScore });
    const lastSignalAt = signals.reduce<Date | null>((latest, signal) => (!latest || signal.createdAt > latest ? signal.createdAt : latest), null);
    return this.prisma.riskProfile.upsert({
      where: { userId },
      create: { userId, tenantId, score, level, signals: signals.length, lastSignalAt },
      update: { score, level, signals: signals.length, lastSignalAt },
    });
  }

  private async syncCase(tenantId: string, userId: string, profile: { score: number; level: RiskLevel }, config: FraudSettings, signalId: string) {
    const open = await this.prisma.riskCase.findFirst({ where: { tenantId, userId, status: { in: OPEN_CASE } } });
    if (open) {
      await this.prisma.$transaction([
        this.prisma.riskSignal.update({ where: { id: signalId }, data: { caseId: open.id } }),
        this.prisma.riskCase.update({ where: { id: open.id }, data: { score: profile.score, level: profile.level } }),
      ]);
      return open.id;
    }
    if (profile.score < config.caseScore) return null;
    const created = await this.prisma.$transaction(async (tx) => {
      // Dois sinais simultâneos não abrem dois casos.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`risk-case:${userId}`}, 0))`;
      const again = await tx.riskCase.findFirst({ where: { tenantId, userId, status: { in: OPEN_CASE } } });
      if (again) return { case: again, isNew: false };
      const signals = await tx.riskSignal.findMany({ where: { tenantId, userId, caseId: null }, orderBy: { createdAt: 'desc' }, take: 50 });
      const types = [...new Set(signals.map((signal) => signal.type))];
      const riskCase = await tx.riskCase.create({
        data: {
          tenantId,
          number: await nextCounter(tx, tenantId, 'risk_case'),
          userId,
          level: profile.level,
          score: profile.score,
          summary: types.map((type) => RISK_SIGNAL_LABELS[type]).join(' · ').slice(0, 500),
        },
      });
      await tx.riskSignal.updateMany({ where: { id: { in: signals.map((signal) => signal.id) } }, data: { caseId: riskCase.id } });
      return { case: riskCase, isNew: true };
    });
    if (created.isNew) {
      this.realtime.toOps(tenantId, 'risk.case.opened', { id: created.case.id, number: created.case.number, level: created.case.level, score: created.case.score, summary: created.case.summary });
    }
    return created.case.id;
  }

  /** Nível atual considerando a liberação manual (conta revisada fica isenta das ações automáticas). */
  private async effectiveLevel(userId: string): Promise<RiskLevel> {
    const profile = await this.prisma.riskProfile.findUnique({ where: { userId }, select: { level: true, trustedUntil: true } });
    if (!profile) return 'LOW';
    if (profile.trustedUntil && profile.trustedUntil > new Date()) return 'LOW';
    return profile.level;
  }

  private async isTrusted(userId: string): Promise<boolean> {
    const profile = await this.prisma.riskProfile.findUnique({ where: { userId }, select: { trustedUntil: true } });
    return !!profile?.trustedUntil && profile.trustedUntil > new Date();
  }

  // ---------------------------------------------------------------------------
  // Aparelhos (várias contas)
  // ---------------------------------------------------------------------------

  deviceHash(tenantId: string, deviceId: string): string {
    return this.crypto.blindIndex(`device:${tenantId}:${deviceId}`);
  }

  @OnEvent(AUTH_SESSION_STARTED, { async: true })
  async onSession(event: AuthSessionStartedEvent) {
    await this.recordDevice(event).catch((error) => this.logger.error(`Aparelho não registrado: ${(error as Error).message}`));
  }

  async recordDevice(event: AuthSessionStartedEvent) {
    if (!event.deviceId) return;
    const deviceHash = this.deviceHash(event.tenantId, event.deviceId);
    await this.prisma.deviceSighting.upsert({
      where: { tenantId_deviceHash_userId: { tenantId: event.tenantId, deviceHash, userId: event.userId } },
      create: { tenantId: event.tenantId, deviceHash, userId: event.userId, lastIp: event.ip, userAgent: event.userAgent?.slice(0, 300) },
      update: { lastSeenAt: new Date(), lastIp: event.ip, userAgent: event.userAgent?.slice(0, 300), logins: { increment: 1 } },
    });
    const fraud = await this.settings.get(event.tenantId, 'fraud');
    const accounts = await this.prisma.deviceSighting.findMany({ where: { tenantId: event.tenantId, deviceHash }, select: { userId: true }, orderBy: { firstSeenAt: 'asc' } });
    if (accounts.length <= fraud.maxAccountsPerDevice) return;
    const others = accounts.map((account) => account.userId).filter((id) => id !== event.userId);
    await this.record(
      {
        tenantId: event.tenantId,
        userId: event.userId,
        type: 'SHARED_DEVICE',
        message: `Aparelho usado por ${accounts.length} contas (limite configurado: ${fraud.maxAccountsPerDevice}).`,
        details: { accounts: accounts.length, app: event.app },
        relatedUserIds: others,
        dedupeKey: `device:${deviceHash.slice(0, 32)}:${event.userId}`,
      },
      fraud,
    );
  }

  /** Outras contas que já usaram os mesmos aparelhos desta conta. */
  private async deviceSiblings(tenantId: string, userId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ userId: string }[]>`
      SELECT DISTINCT other."userId"
      FROM device_sightings mine
      JOIN device_sightings other ON other."tenantId" = mine."tenantId" AND other."deviceHash" = mine."deviceHash" AND other."userId" <> mine."userId"
      WHERE mine."tenantId" = ${tenantId}::uuid AND mine."userId" = ${userId}::uuid`;
    return rows.map((row) => row.userId);
  }

  // ---------------------------------------------------------------------------
  // Regras do checkout
  // ---------------------------------------------------------------------------

  /**
   * Cupom de primeira compra: recusado se outra conta do mesmo aparelho (ou com o mesmo endereço
   * de entrega) já usou um cupom de primeira compra. Evita criar contas só para repetir o desconto.
   */
  async couponEligibility(coupon: Coupon, context: CouponContext): Promise<string | null> {
    if (!coupon.firstOrderOnly) return null;
    const fraud = await this.settings.get(context.tenantId, 'fraud');
    if (!fraud.enabled || !fraud.blockSharedFirstOrderCoupon) return null;
    const customer = await this.prisma.customer.findUnique({ where: { id: context.customerId }, select: { userId: true } });
    if (!customer || (await this.isTrusted(customer.userId))) return null;

    const siblings = await this.deviceSiblings(context.tenantId, customer.userId);
    let viaDevice: string[] = [];
    if (siblings.length) {
      const used = await this.prisma.$queryRaw<{ userId: string }[]>`
        SELECT DISTINCT c."userId"
        FROM coupon_redemptions r
        JOIN coupons cp ON cp.id = r."couponId" AND cp."firstOrderOnly" = true
        JOIN customers c ON c.id = r."customerId"
        WHERE cp."tenantId" = ${context.tenantId}::uuid AND c."userId" = ANY(${siblings}::uuid[])
        LIMIT 10`;
      viaDevice = used.map((row) => row.userId);
    }
    let viaAddress: string[] = [];
    const zip = context.dropoff?.zipCode?.replace(/\D/g, '');
    const number = context.dropoff?.number?.trim().toLowerCase();
    if (zip && number) {
      const rows = await this.prisma.$queryRaw<{ userId: string }[]>`
        SELECT DISTINCT c."userId"
        FROM coupon_redemptions r
        JOIN coupons cp ON cp.id = r."couponId" AND cp."firstOrderOnly" = true
        JOIN orders o ON o.id = r."orderId"
        JOIN customers c ON c.id = r."customerId"
        WHERE cp."tenantId" = ${context.tenantId}::uuid
          AND r."customerId" <> ${context.customerId}::uuid
          AND regexp_replace(o."deliveryAddress"->>'zipCode', '\\D', '', 'g') = ${zip}
          AND lower(trim(o."deliveryAddress"->>'number')) = ${number}
        LIMIT 10`;
      viaAddress = rows.map((row) => row.userId);
    }
    const related = [...new Set([...viaDevice, ...viaAddress])];
    if (!related.length) return null;
    await this.record(
      {
        tenantId: context.tenantId,
        userId: customer.userId,
        type: 'COUPON_ABUSE',
        message: `Tentou usar o cupom de primeira compra ${coupon.code} já utilizado por outra conta no mesmo ${viaDevice.length ? 'aparelho' : 'endereço'}.`,
        details: { couponCode: coupon.code, sameDevice: viaDevice.length, sameAddress: viaAddress.length },
        relatedUserIds: related,
        dedupeKey: `coupon:${customer.userId}:${coupon.id}`,
      },
      fraud,
    );
    return 'Este cupom de primeira compra já foi usado em outra conta neste aparelho ou endereço.';
  }

  /** Conta de risco alto (configurável) paga pedidos acima do limite só por meios online. */
  async checkoutGuard(user: AuthUser, input: { customerId: string; companyId: string; paymentMethod: PaymentMethod; totalCents: number }) {
    if (input.paymentMethod !== 'CASH') return;
    const fraud = await this.settings.get(user.tenantId, 'fraud');
    if (!fraud.enabled || fraud.denyCashAtLevel === 'OFF' || input.totalCents <= fraud.denyCashAboveCents) return;
    const level = await this.effectiveLevel(user.userId);
    if (LEVEL_RANK[level] < LEVEL_RANK[fraud.denyCashAtLevel]) return;
    await this.audit.log({ action: 'fraud.cash_denied', entityType: 'User', entityId: user.userId, metadata: { level, totalCents: input.totalCents } });
    throw new UnprocessableEntityException('Por segurança, este pedido precisa ser pago online (PIX ou cartão). Se achar que é um engano, fale com o suporte.');
  }

  /** Pedido criado: conta nova com valor alto e muitos pedidos em pouco tempo. */
  @OnEvent(ORDER_CREATED, { async: true })
  async onOrderCreated(event: OrderStatusChangedEvent) {
    try {
      const fraud = await this.settings.get(event.tenantId, 'fraud');
      if (!fraud.enabled) return;
      const [order, user] = await Promise.all([
        this.prisma.order.findUnique({ where: { id: event.orderId }, select: { totalCents: true, customerId: true, paymentMethod: true } }),
        this.prisma.user.findUnique({ where: { id: event.customerUserId }, select: { createdAt: true } }),
      ]);
      if (!order || !user) return;
      const accountAgeDays = (Date.now() - user.createdAt.getTime()) / DAY;
      if (accountAgeDays <= fraud.newAccountDays && order.totalCents >= fraud.newAccountHighValueCents) {
        await this.record(
          {
            tenantId: event.tenantId,
            userId: event.customerUserId,
            type: 'NEW_ACCOUNT_HIGH_VALUE',
            message: `Pedido #${event.number} de R$ ${(order.totalCents / 100).toFixed(2).replace('.', ',')} em conta criada há ${Math.floor(accountAgeDays)} dia(s).`,
            details: { totalCents: order.totalCents, accountAgeDays: Math.round(accountAgeDays * 10) / 10, paymentMethod: order.paymentMethod },
            orderId: event.orderId,
            dedupeKey: `new-high:${event.orderId}`,
          },
          fraud,
        );
      }
      const lastHour = await this.prisma.order.count({ where: { customerId: order.customerId, createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
      if (lastHour > fraud.maxOrdersPerHour) {
        await this.record(
          {
            tenantId: event.tenantId,
            userId: event.customerUserId,
            type: 'ORDER_VELOCITY',
            message: `${lastHour} pedidos na última hora (limite: ${fraud.maxOrdersPerHour}).`,
            details: { lastHour },
            orderId: event.orderId,
            dedupeKey: `velocity:${event.customerUserId}:${new Date().toISOString().slice(0, 13)}`,
          },
          fraud,
        );
      }
    } catch (error) {
      this.logger.error(`Regras de pedido não avaliadas: ${(error as Error).message}`);
    }
  }

  /** Pagamentos recusados em sequência e vários cartões diferentes no mesmo dia. */
  @OnEvent(PAYMENT_FAILED, { async: true })
  async onPaymentFailed(event: PaymentFailedEvent) {
    try {
      const fraud = await this.settings.get(event.tenantId, 'fraud');
      if (!fraud.enabled) return;
      const since = new Date(Date.now() - DAY);
      const day = new Date().toISOString().slice(0, 10);
      const failed = await this.prisma.payment.count({ where: { payerUserId: event.payerUserId, status: 'FAILED', createdAt: { gte: since } } });
      if (failed >= fraud.paymentFailuresPerDay) {
        await this.record(
          {
            tenantId: event.tenantId,
            userId: event.payerUserId,
            type: 'PAYMENT_FAILURES',
            message: `${failed} pagamentos recusados nas últimas 24 horas.`,
            details: { failed },
            paymentId: event.paymentId,
            orderId: event.orderId ?? undefined,
            dedupeKey: `payfail:${event.payerUserId}:${day}`,
          },
          fraud,
        );
      }
      const cards = await this.prisma.payment.findMany({
        where: { payerUserId: event.payerUserId, method: { in: ['CREDIT_CARD', 'DEBIT_CARD'] }, cardLast4: { not: null }, createdAt: { gte: since } },
        select: { cardBrand: true, cardLast4: true },
        distinct: ['cardBrand', 'cardLast4'],
      });
      if (cards.length > fraud.maxCardsPerDay) {
        await this.record(
          {
            tenantId: event.tenantId,
            userId: event.payerUserId,
            type: 'CARD_TESTING',
            message: `${cards.length} cartões diferentes nas últimas 24 horas (limite: ${fraud.maxCardsPerDay}).`,
            details: { cards: cards.length },
            paymentId: event.paymentId,
            dedupeKey: `cards:${event.payerUserId}:${day}`,
          },
          fraud,
        );
      }
    } catch (error) {
      this.logger.error(`Regras de pagamento não avaliadas: ${(error as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Varredura diária: cancelamentos e desistências fora do padrão, decaimento dos scores
  // ---------------------------------------------------------------------------

  @Cron('0 50 3 * * *')
  async nightly(now = new Date()) {
    const tenants = await this.prisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    for (const tenant of tenants) {
      try {
        await this.scanTenant(tenant.id, now);
      } catch (error) {
        this.logger.error(`Varredura antifraude do tenant ${tenant.id} falhou: ${(error as Error).message}`);
      }
    }
  }

  async scanTenant(tenantId: string, now = new Date()) {
    const fraud = await this.settings.get(tenantId, 'fraud');
    if (!fraud.enabled) return { cancellations: 0, releases: 0 };
    const since = new Date(now.getTime() - 30 * DAY);
    const week = `${now.getUTCFullYear()}-${Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / (7 * DAY))}`;

    // Clientes: pedidos cancelados pelo próprio cliente ÷ pedidos (30 dias).
    const customers = await this.prisma.$queryRaw<{ userId: string; total: number; events: number }[]>`
      SELECT c."userId", count(*)::int AS total, (count(*) FILTER (WHERE o.status = 'CANCELED' AND o."canceledBy" = 'CUSTOMER'))::int AS events
      FROM orders o JOIN customers c ON c.id = o."customerId"
      WHERE o."tenantId" = ${tenantId}::uuid AND o."createdAt" >= ${utcTimestamp(since)}
      GROUP BY c."userId"`;
    const customerOutliers = rateOutliers(
      customers.map((row) => ({ id: row.userId, total: row.total, events: row.events })),
      { minTotal: fraud.cancellationMinTotal, minEvents: 3, zThreshold: fraud.cancellationZ, minRate: 0.3 },
    );
    for (const outlier of customerOutliers) {
      await this.record(
        {
          tenantId,
          userId: outlier.id,
          type: 'ABNORMAL_CANCELLATIONS',
          message: `Cancelou ${outlier.events} de ${outlier.total} pedidos em 30 dias (${Math.round(outlier.rate * 100)}%; média da plataforma ${Math.round(outlier.baseline * 100)}%).`,
          details: { total: outlier.total, canceled: outlier.events, rate: outlier.rate, baseline: outlier.baseline, z: outlier.z },
          dedupeKey: `cancel:${outlier.id}:${week}`,
        },
        fraud,
      );
    }

    // Entregadores: desistências (volta para a busca) ÷ entregas aceitas (30 dias).
    const drivers = await this.prisma.$queryRaw<{ userId: string; total: number; events: number }[]>`
      SELECT h."actorId" AS "userId",
             count(*) FILTER (WHERE h."toStatus" = 'DRIVER_ASSIGNED')::int + count(*) FILTER (WHERE h."toStatus" = 'SEARCHING_DRIVER' AND h."actorType" = 'DRIVER')::int AS total,
             (count(*) FILTER (WHERE h."toStatus" = 'SEARCHING_DRIVER' AND h."actorType" = 'DRIVER'))::int AS events
      FROM delivery_status_history h
      JOIN deliveries d ON d.id = h."deliveryId"
      WHERE d."tenantId" = ${tenantId}::uuid AND h."createdAt" >= ${utcTimestamp(since)} AND h."actorType" = 'DRIVER' AND h."actorId" IS NOT NULL
      GROUP BY h."actorId"`;
    const driverOutliers = rateOutliers(
      drivers.map((row) => ({ id: row.userId, total: row.total, events: row.events })),
      { minTotal: fraud.cancellationMinTotal, minEvents: 3, zThreshold: fraud.cancellationZ, minRate: 0.25 },
    );
    for (const outlier of driverOutliers) {
      await this.record(
        {
          tenantId,
          userId: outlier.id,
          type: 'DRIVER_RELEASES',
          message: `Desistiu de ${outlier.events} entregas aceitas em 30 dias (${Math.round(outlier.rate * 100)}%; média ${Math.round(outlier.baseline * 100)}%).`,
          details: { total: outlier.total, released: outlier.events, rate: outlier.rate, baseline: outlier.baseline, z: outlier.z },
          dedupeKey: `release:${outlier.id}:${week}`,
        },
        fraud,
      );
    }

    // Decaimento: recalcula quem ainda tem score.
    const profiles = await this.prisma.riskProfile.findMany({ where: { tenantId, score: { gt: 0 } }, select: { userId: true }, take: 5000 });
    for (const profile of profiles) await this.rescore(tenantId, profile.userId, fraud, now);
    return { cancellations: customerOutliers.length, releases: driverOutliers.length };
  }

  // ---------------------------------------------------------------------------
  // Painel (revisão humana)
  // ---------------------------------------------------------------------------

  private userSelect = { id: true, name: true, email: true, phone: true, status: true, createdAt: true, customer: { select: { id: true } }, driver: { select: { id: true } } } as const;

  private userView(user: Prisma.UserGetPayload<{ select: FraudService['userSelect'] }> | undefined | null) {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      status: user.status,
      createdAt: user.createdAt,
      customerId: user.customer?.id ?? null,
      driverId: user.driver?.id ?? null,
    };
  }

  /** Acrescenta número do pedido e código da entrega aos sinais (links no painel). */
  private async withRefs<T extends { orderId: string | null; deliveryId: string | null }>(signals: T[]) {
    const orderIds = [...new Set(signals.map((signal) => signal.orderId).filter((id): id is string => !!id))];
    const deliveryIds = [...new Set(signals.map((signal) => signal.deliveryId).filter((id): id is string => !!id))];
    const [orders, deliveries] = await Promise.all([
      orderIds.length ? this.prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, number: true } }) : [],
      deliveryIds.length ? this.prisma.delivery.findMany({ where: { id: { in: deliveryIds } }, select: { id: true, code: true } }) : [],
    ]);
    const numbers = new Map(orders.map((order) => [order.id, order.number]));
    const codes = new Map(deliveries.map((delivery) => [delivery.id, delivery.code]));
    return signals.map((signal) => ({
      ...signal,
      orderNumber: signal.orderId ? (numbers.get(signal.orderId) ?? null) : null,
      deliveryCode: signal.deliveryId ? (codes.get(signal.deliveryId) ?? null) : null,
    }));
  }

  async overview(tenantId: string) {
    const since = new Date(Date.now() - 7 * DAY);
    const [byStatus, byLevel, signals] = await Promise.all([
      this.prisma.riskCase.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
      this.prisma.riskCase.groupBy({ by: ['level'], where: { tenantId, status: { in: OPEN_CASE } }, _count: { _all: true } }),
      this.prisma.riskSignal.groupBy({ by: ['type'], where: { tenantId, createdAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { type: 'desc' } } }),
    ]);
    return {
      cases: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
      openByLevel: Object.fromEntries(byLevel.map((row) => [row.level, row._count._all])),
      signalsLast7Days: signals.map((row) => ({ type: row.type, count: row._count._all })),
    };
  }

  async listCases(tenantId: string, query: RiskCasesQuery) {
    const search = query.search?.trim();
    const where: Prisma.RiskCaseWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : { status: { in: OPEN_CASE } }),
      ...(query.level ? { level: query.level } : {}),
    };
    if (search) {
      const users = await this.prisma.user.findMany({
        where: { tenantId, OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search.toLowerCase() } }] },
        select: { id: true },
        take: 200,
      });
      const number = Number(search.replace('#', ''));
      where.OR = [{ userId: { in: users.map((user) => user.id) } }, ...(Number.isInteger(number) && number > 0 ? [{ number }] : [])];
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.riskCase.count({ where }),
      this.prisma.riskCase.findMany({
        where,
        orderBy: [{ level: 'desc' }, { score: 'desc' }, { createdAt: 'desc' }],
        skip: skipOf(query),
        take: query.pageSize,
        include: { _count: { select: { signals: true } } },
      }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((row) => row.userId) } }, select: this.userSelect });
    const byId = new Map(users.map((user) => [user.id, user]));
    return paginated(
      rows.map(({ _count, ...row }) => ({ ...row, signals: _count.signals, user: this.userView(byId.get(row.userId)) })),
      total,
      query,
    );
  }

  async getCase(tenantId: string, id: string) {
    const riskCase = await this.prisma.riskCase.findFirst({ where: { id, tenantId }, include: { signals: { orderBy: { createdAt: 'desc' } } } });
    if (!riskCase) throw new NotFoundException('Caso não encontrado.');
    return { ...riskCase, ...(await this.subject(tenantId, riskCase.userId)) };
  }

  /** Perfil de risco de uma conta com as evidências e contas relacionadas (aparelhos e sinais). */
  async subject(tenantId: string, userId: string) {
    const [user, profile, signals, devices, siblings, orders, deliveries, cases] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: userId, tenantId }, select: this.userSelect }),
      this.prisma.riskProfile.findUnique({ where: { userId } }),
      this.prisma.riskSignal.findMany({ where: { tenantId, userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.deviceSighting.findMany({ where: { tenantId, userId }, orderBy: { lastSeenAt: 'desc' }, take: 20 }),
      this.deviceSiblings(tenantId, userId),
      this.prisma.order.groupBy({ by: ['status'], where: { tenantId, customer: { userId } }, _count: { _all: true } }),
      this.prisma.delivery.groupBy({ by: ['status'], where: { tenantId, driver: { userId } }, _count: { _all: true } }),
      this.prisma.riskCase.findMany({ where: { tenantId, userId }, orderBy: { createdAt: 'desc' }, select: { id: true, number: true, status: true, level: true, score: true, createdAt: true, resolution: true } }),
    ]);
    if (!user) throw new NotFoundException('Conta não encontrada.');
    const relatedIds = [...new Set([...siblings, ...signals.flatMap((signal) => signal.relatedUserIds)])].filter((id) => id !== userId).slice(0, 50);
    const related = await this.prisma.user.findMany({ where: { id: { in: relatedIds } }, select: this.userSelect });
    const relatedProfiles = await this.prisma.riskProfile.findMany({ where: { userId: { in: relatedIds } }, select: { userId: true, score: true, level: true } });
    const profileOf = new Map(relatedProfiles.map((row) => [row.userId, row]));
    const sharedDevice = new Set(siblings);
    return {
      user: this.userView(user),
      profile,
      signals: await this.withRefs(signals),
      devices: devices.map((device) => ({
        id: device.id,
        fingerprint: device.deviceHash.slice(0, 10),
        firstSeenAt: device.firstSeenAt,
        lastSeenAt: device.lastSeenAt,
        logins: device.logins,
        lastIp: device.lastIp,
        userAgent: device.userAgent,
      })),
      related: related.map((other) => ({
        ...this.userView(other)!,
        sharedDevice: sharedDevice.has(other.id),
        score: profileOf.get(other.id)?.score ?? 0,
        level: profileOf.get(other.id)?.level ?? 'LOW',
      })),
      activity: {
        orders: Object.fromEntries(orders.map((row) => [row.status, row._count._all])),
        deliveries: Object.fromEntries(deliveries.map((row) => [row.status, row._count._all])),
      },
      cases,
    };
  }

  async startReview(actor: AuthUser, id: string) {
    const riskCase = await this.prisma.riskCase.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!riskCase) throw new NotFoundException('Caso não encontrado.');
    if (!OPEN_CASE.includes(riskCase.status)) throw new ConflictException('Este caso já foi resolvido.');
    await this.prisma.riskCase.update({ where: { id }, data: { status: 'IN_REVIEW', assigneeId: actor.userId } });
    await this.audit.log({ action: 'fraud.case.review', entityType: 'RiskCase', entityId: id });
    return this.getCase(actor.tenantId, id);
  }

  /**
   * Descarta o caso (falso positivo). A conta fica isenta das ações automáticas por `trustDays`
   * dias; novos sinais continuam sendo registrados para a próxima revisão.
   */
  async dismiss(actor: AuthUser, id: string, reason: string, trustDays: number) {
    const riskCase = await this.resolve(actor, id, 'DISMISSED', reason);
    const trustedUntil = trustDays > 0 ? new Date(Date.now() + trustDays * DAY) : null;
    await this.prisma.riskProfile.upsert({
      where: { userId: riskCase.userId },
      create: { userId: riskCase.userId, tenantId: actor.tenantId, trustedUntil, trustedReason: reason },
      update: { trustedUntil, trustedReason: reason },
    });
    return this.getCase(actor.tenantId, id);
  }

  /** Confirma a fraude. O bloqueio da conta é uma ação separada (permissão users.status.manage). */
  async confirm(actor: AuthUser, id: string, reason: string) {
    const riskCase = await this.resolve(actor, id, 'CONFIRMED', reason);
    await this.prisma.riskProfile.updateMany({ where: { userId: riskCase.userId }, data: { trustedUntil: null, trustedReason: null } });
    return this.getCase(actor.tenantId, id);
  }

  private async resolve(actor: AuthUser, id: string, status: 'DISMISSED' | 'CONFIRMED', reason: string) {
    const riskCase = await this.prisma.riskCase.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!riskCase) throw new NotFoundException('Caso não encontrado.');
    const updated = await this.prisma.riskCase.updateMany({
      where: { id, status: { in: OPEN_CASE } },
      data: { status, resolution: reason.trim(), resolvedById: actor.userId, resolvedAt: new Date(), assigneeId: riskCase.assigneeId ?? actor.userId },
    });
    if (!updated.count) throw new ConflictException('Este caso já foi resolvido.');
    await this.audit.log({ action: status === 'CONFIRMED' ? 'fraud.case.confirm' : 'fraud.case.dismiss', entityType: 'RiskCase', entityId: id, metadata: { reason, userId: riskCase.userId } });
    return riskCase;
  }

  /** Sinal registrado pela equipe (ex.: denúncia de loja ou de entregador). */
  async addManualSignal(actor: AuthUser, userId: string, message: string, points: number) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId: actor.tenantId }, select: { id: true } });
    if (!user) throw new NotFoundException('Conta não encontrada.');
    const result = await this.record({ tenantId: actor.tenantId, userId, type: 'MANUAL', message, details: { points, by: actor.userId } });
    if (!result) throw new ConflictException('O antifraude está desativado nas configurações.');
    await this.audit.log({ action: 'fraud.signal.manual', entityType: 'User', entityId: userId, metadata: { points, message } });
    return this.subject(actor.tenantId, userId);
  }

  /** Remove a isenção de uma conta (volta a valer o nível calculado). */
  async revokeTrust(actor: AuthUser, userId: string) {
    const updated = await this.prisma.riskProfile.updateMany({ where: { userId, tenantId: actor.tenantId }, data: { trustedUntil: null, trustedReason: null } });
    if (!updated.count) throw new NotFoundException('Conta sem perfil de risco.');
    await this.audit.log({ action: 'fraud.trust.revoke', entityType: 'User', entityId: userId });
    return this.subject(actor.tenantId, userId);
  }

  async listSignals(tenantId: string, query: RiskSignalsQuery) {
    const where: Prisma.RiskSignalWhereInput = { tenantId, ...(query.type ? { type: query.type } : {}), ...(query.userId ? { userId: query.userId } : {}) };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.riskSignal.count({ where }),
      this.prisma.riskSignal.findMany({ where, orderBy: { createdAt: 'desc' }, skip: skipOf(query), take: query.pageSize }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.userId))] } }, select: this.userSelect });
    const byId = new Map(users.map((user) => [user.id, user]));
    return paginated(
      (await this.withRefs(rows)).map((row) => ({ ...row, user: this.userView(byId.get(row.userId)) })),
      total,
      query,
    );
  }
}
