import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { randomInt } from 'node:crypto';
import { normalizeReferralCode, ROLE_KEYS } from '@levoja/shared';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { SettingsService, SettingValue } from '../settings/settings.service';
import { LedgerService, WalletOwner } from '../finance/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { AuthService, SignupContext } from '../auth/auth.service';
import { ORDER_STATUS_CHANGED, OrderStatusChangedEvent } from '../orders/orders.service';
import { DELIVERY_STATUS_CHANGED, DeliveryStatusChangedEvent } from '../logistics/deliveries.service';
import { RISK_SIGNAL, RiskSignalEvent } from '../../common/intelligence-events';
import { paginated, PaginationQueryDto, skipOf } from '../../common/pagination';
import { retryOnConflict } from '../../common/retry';
import type { AuthUser } from '../../common/auth/auth-user';
import type { Referral } from '../../generated/prisma/client';
import { Prisma } from '../../generated/prisma/client';
import type { ReferralProgram, ReferralStatus } from '../../generated/prisma/enums';

type ReferralConfig = SettingValue<'referral'>;

const DAY = 86_400_000;
/** Sem caracteres ambíguos (0/O, 1/I/L). */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export interface ReferralsQuery extends PaginationQueryDto {
  status?: ReferralStatus;
  program?: ReferralProgram;
}

const programConfig = (config: ReferralConfig, program: ReferralProgram) =>
  program === 'CUSTOMER' ? config.customer : program === 'DRIVER' ? config.driver : config.company;

/** Primeiro nome, sem acentos, para o código (ex.: "MARIA7K2"). */
function codePrefix(name: string): string {
  const first = name.normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/)[0] ?? '';
  return first.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'LEVO';
}

/**
 * Indique e ganhe (configuração `referral`, desligado por padrão), para clientes, entregadores e empresas:
 * - cada pessoa tem um código; quem se cadastra com ele fica vinculado a quem indicou;
 * - a recompensa só é paga quando o indicado cumpre a meta do programa dentro do prazo
 *   (1º pedido entregue, N entregas concluídas ou N pedidos entregues pela empresa);
 * - antifraude por regra: mesmo aparelho em quem indica e em quem é indicado segura a recompensa
 *   (sinal de risco + revisão humana); limite mensal por quem indica; a equipe pode aprovar ou recusar.
 */
@Injectable()
export class ReferralsService implements OnModuleInit {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit(): void {
    this.auth.registerSignupHook((tx, context) => this.attachOnSignup(tx, context));
  }

  // ---------------------------------------------------------------------------
  // Código e vínculo no cadastro
  // ---------------------------------------------------------------------------

  async codeFor(tenantId: string, userId: string): Promise<string> {
    const existing = await this.prisma.referralCode.findUnique({ where: { userId } });
    if (existing) return existing.code;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
    const prefix = codePrefix(user.name);
    for (let attempt = 0; attempt < 8; attempt++) {
      const suffix = Array.from({ length: attempt < 4 ? 3 : 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      try {
        const created = await this.prisma.referralCode.create({ data: { userId, tenantId, code: `${prefix}${suffix}` } });
        return created.code;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        const raced = await this.prisma.referralCode.findUnique({ where: { userId } });
        if (raced) return raced.code;
      }
    }
    throw new ConflictException('Não foi possível gerar o código. Tente novamente.');
  }

  /** Pré-validação para o formulário de cadastro (não revela quem indicou). */
  async validate(tenantId: string, rawCode: string, program: ReferralProgram) {
    const config = await this.settings.get(tenantId, 'referral');
    const rules = programConfig(config, program);
    if (!config.enabled || !rules.enabled) return { valid: false, reason: 'O programa de indicação não está disponível.' };
    const code = normalizeReferralCode(rawCode);
    const owner = code ? await this.prisma.referralCode.findUnique({ where: { tenantId_code: { tenantId, code } }, select: { userId: true } }) : null;
    if (!owner) return { valid: false, reason: 'Código não encontrado.' };
    return { valid: true, code, referredRewardCents: rules.referredRewardCents, goal: this.goalText(config, program) };
  }

  goalText(config: ReferralConfig, program: ReferralProgram): string {
    const money = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
    if (program === 'CUSTOMER') return `Primeiro pedido entregue${config.customer.minOrderCents ? ` a partir de ${money(config.customer.minOrderCents)} em produtos` : ''} em até ${config.windowDays} dias`;
    if (program === 'DRIVER') return `${config.driver.deliveriesRequired} entregas concluídas em até ${config.windowDays} dias`;
    return `${config.company.ordersRequired} pedidos entregues em até ${config.windowDays} dias`;
  }

  /** Vincula o novo cadastro a quem indicou (dentro da transação do cadastro). */
  async attachOnSignup(tx: Tx, context: SignupContext) {
    if (!context.referralCode?.trim()) return;
    const config = await this.settings.get(context.tenantId, 'referral');
    const program: ReferralProgram = context.profile;
    const rules = programConfig(config, program);
    // Programa desligado: o código é ignorado (o cadastro não é bloqueado por isso).
    if (!config.enabled || !rules.enabled) return;
    const code = normalizeReferralCode(context.referralCode);
    const owner = await tx.referralCode.findUnique({ where: { tenantId_code: { tenantId: context.tenantId, code } } });
    if (!owner) throw new BadRequestException('Código de indicação não encontrado. Confira o código ou deixe o campo em branco.');
    if (owner.userId === context.userId) return;
    const referrer = await tx.user.findUnique({ where: { id: owner.userId }, select: { status: true } });
    if (referrer?.status !== 'ACTIVE') throw new BadRequestException('Este código de indicação não está mais ativo.');

    const monthAgo = new Date(Date.now() - 30 * DAY);
    const recent = await tx.referral.count({ where: { referrerUserId: owner.userId, createdAt: { gte: monthAgo } } });
    const overLimit = recent >= config.maxPerReferrerPerMonth;
    await tx.referral.create({
      data: {
        tenantId: context.tenantId,
        program,
        referrerUserId: owner.userId,
        referredUserId: context.userId,
        referredCompanyId: context.companyId ?? null,
        status: overLimit ? 'REJECTED' : 'PENDING',
        reason: overLimit ? `Quem indicou passou do limite de ${config.maxPerReferrerPerMonth} indicações em 30 dias.` : null,
        expiresAt: new Date(Date.now() + config.windowDays * DAY),
        referrerRewardCents: rules.referrerRewardCents,
        referredRewardCents: rules.referredRewardCents,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Metas
  // ---------------------------------------------------------------------------

  @OnEvent(ORDER_STATUS_CHANGED, { async: true, promisify: true })
  async onOrderStatus(event: OrderStatusChangedEvent) {
    if (event.to !== 'DELIVERED') return;
    await this.checkOrderGoals(event).catch((error) => this.logger.error(`Indicação (pedido ${event.orderId}): ${(error as Error).message}`));
  }

  @OnEvent(DELIVERY_STATUS_CHANGED, { async: true, promisify: true })
  async onDeliveryStatus(event: DeliveryStatusChangedEvent) {
    if (event.to !== 'DELIVERED' || !event.driverId) return;
    await this.checkDriverGoal(event.driverId).catch((error) => this.logger.error(`Indicação (entrega ${event.deliveryId}): ${(error as Error).message}`));
  }

  private async checkOrderGoals(event: OrderStatusChangedEvent) {
    const [customerReferral, companyReferral] = await Promise.all([
      this.prisma.referral.findFirst({ where: { program: 'CUSTOMER', referredUserId: event.customerUserId, status: 'PENDING' } }),
      this.prisma.referral.findFirst({ where: { program: 'COMPANY', referredCompanyId: event.companyId, status: 'PENDING' } }),
    ]);
    if (!customerReferral && !companyReferral) return;
    const config = await this.settings.get(event.tenantId, 'referral');
    if (customerReferral) {
      const order = await this.prisma.order.findUnique({ where: { id: event.orderId }, select: { subtotalCents: true } });
      if (order && order.subtotalCents >= config.customer.minOrderCents) await this.qualify(customerReferral);
    }
    if (companyReferral) {
      const delivered = await this.prisma.order.count({ where: { companyId: event.companyId, status: 'DELIVERED', createdAt: { gte: companyReferral.createdAt } } });
      if (delivered >= config.company.ordersRequired) await this.qualify(companyReferral);
    }
  }

  private async checkDriverGoal(driverId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId }, select: { userId: true, tenantId: true } });
    if (!driver) return;
    const referral = await this.prisma.referral.findFirst({ where: { program: 'DRIVER', referredUserId: driver.userId, status: 'PENDING' } });
    if (!referral) return;
    const config = await this.settings.get(driver.tenantId, 'referral');
    const delivered = await this.prisma.delivery.count({ where: { driverId, status: 'DELIVERED', createdAt: { gte: referral.createdAt } } });
    if (delivered >= config.driver.deliveriesRequired) await this.qualify(referral);
  }

  /** Meta cumprida: confere as regras antifraude e paga (ou segura para revisão). */
  async qualify(referral: Referral, now = new Date()) {
    if (referral.expiresAt <= now) {
      await this.prisma.referral.updateMany({ where: { id: referral.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
      return 'EXPIRED' as const;
    }
    const shared = await this.sharedDevice(referral.tenantId, referral.referrerUserId, referral.referredUserId);
    if (shared) {
      const held = await this.prisma.referral.updateMany({
        where: { id: referral.id, status: 'PENDING' },
        data: { status: 'REJECTED', reason: 'Mesmo aparelho usado por quem indicou e por quem foi indicado. Recompensa retida para análise da equipe.' },
      });
      if (held.count) {
        this.events.emit(RISK_SIGNAL, {
          tenantId: referral.tenantId,
          userId: referral.referredUserId,
          type: 'REFERRAL_ABUSE',
          message: 'Indicação cumprida por conta que usa o mesmo aparelho de quem indicou.',
          details: { referralId: referral.id, program: referral.program },
          relatedUserIds: [referral.referrerUserId],
          dedupeKey: `referral:${referral.id}`,
        } satisfies RiskSignalEvent);
      }
      return 'HELD' as const;
    }
    return (await this.pay(referral.id)) ? ('REWARDED' as const) : null;
  }

  private async sharedDevice(tenantId: string, a: string, b: string): Promise<boolean> {
    const hashes = await this.prisma.deviceSighting.findMany({ where: { tenantId, userId: a }, select: { deviceHash: true } });
    if (!hashes.length) return false;
    return (await this.prisma.deviceSighting.count({ where: { tenantId, userId: b, deviceHash: { in: hashes.map((row) => row.deviceHash) } } })) > 0;
  }

  /** Carteira de quem indicou: a do perfil do programa, senão a de outro perfil que a pessoa tenha. */
  private async referrerWallet(tx: Tx, userId: string, program: ReferralProgram): Promise<WalletOwner | null> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        customer: { select: { id: true } },
        driver: { select: { id: true } },
        companyMemberships: { where: { isActive: true, role: { key: ROLE_KEYS.COMPANY_OWNER } }, select: { companyId: true }, orderBy: { createdAt: 'asc' }, take: 1 },
      },
    });
    if (!user) return null;
    const customer: WalletOwner | null = user.customer ? { type: 'CUSTOMER', customerId: user.customer.id } : null;
    const driver: WalletOwner | null = user.driver ? { type: 'DRIVER', driverId: user.driver.id } : null;
    const company: WalletOwner | null = user.companyMemberships[0] ? { type: 'COMPANY', companyId: user.companyMemberships[0].companyId } : null;
    const order = program === 'CUSTOMER' ? [customer, driver, company] : program === 'DRIVER' ? [driver, customer, company] : [company, driver, customer];
    return order.find((owner) => owner) ?? null;
  }

  private async referredWallet(tx: Tx, referral: Referral): Promise<WalletOwner | null> {
    if (referral.program === 'COMPANY') return referral.referredCompanyId ? { type: 'COMPANY', companyId: referral.referredCompanyId } : null;
    if (referral.program === 'DRIVER') {
      const driver = await tx.driver.findUnique({ where: { userId: referral.referredUserId }, select: { id: true } });
      return driver ? { type: 'DRIVER', driverId: driver.id } : null;
    }
    const customer = await tx.customer.findUnique({ where: { userId: referral.referredUserId }, select: { id: true } });
    return customer ? { type: 'CUSTOMER', customerId: customer.id } : null;
  }

  /** Paga as recompensas (idempotente: só uma transição para REWARDED). Retida/recusada só com aprovação da equipe. */
  async pay(referralId: string, options: { approved?: boolean } = {}): Promise<boolean> {
    let paid: Referral | null = null;
    await retryOnConflict(() => this.prisma.$transaction(async (tx) => {
      paid = null;
      const from: ReferralStatus[] = options.approved ? ['PENDING', 'REJECTED'] : ['PENDING'];
      const moved = await tx.referral.updateMany({ where: { id: referralId, status: { in: from } }, data: { status: 'REWARDED', rewardedAt: new Date(), reason: null } });
      if (moved.count === 0) return;
      const referral = await tx.referral.findUniqueOrThrow({ where: { id: referralId } });
      const label = referral.program === 'CUSTOMER' ? 'cliente' : referral.program === 'DRIVER' ? 'entregador' : 'empresa';
      const referrerOwner = await this.referrerWallet(tx, referral.referrerUserId, referral.program);
      const referredOwner = await this.referredWallet(tx, referral);
      const entries = [];
      let platformCost = 0;
      if (referrerOwner && referral.referrerRewardCents > 0) {
        entries.push({ owner: referrerOwner, type: 'CREDIT' as const, amountCents: referral.referrerRewardCents, description: `Indique e ganhe — indicação de ${label}`, referenceKey: `referral:${referral.id}:referrer` });
        platformCost += referral.referrerRewardCents;
      }
      if (referredOwner && referral.referredRewardCents > 0) {
        entries.push({ owner: referredOwner, type: 'CREDIT' as const, amountCents: referral.referredRewardCents, description: 'Indique e ganhe — bônus de boas-vindas', referenceKey: `referral:${referral.id}:referred` });
        platformCost += referral.referredRewardCents;
      }
      if (platformCost > 0) {
        entries.push({ owner: { type: 'PLATFORM' } as WalletOwner, type: 'DISCOUNT' as const, amountCents: -platformCost, description: `Indique e ganhe — ${label}`, referenceKey: `referral:${referral.id}:platform` });
      }
      await this.ledger.post(tx, referral.tenantId, entries);
      paid = referral;
    }));
    if (!paid) return false;
    const referral = paid as Referral;
    const money = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
    if (referral.referrerRewardCents > 0) {
      await this.notifications.notify({ userId: referral.referrerUserId, type: 'referral.rewarded', title: 'Sua indicação deu certo!', body: `Você ganhou ${money(referral.referrerRewardCents)} na sua carteira.`, data: { referralId: referral.id }, channels: ['inapp', 'push'] });
    }
    if (referral.referredRewardCents > 0) {
      await this.notifications.notify({ userId: referral.referredUserId, type: 'referral.rewarded', title: 'Bônus de indicação liberado', body: `Você ganhou ${money(referral.referredRewardCents)} na sua carteira.`, data: { referralId: referral.id }, channels: ['inapp', 'push'] });
    }
    return true;
  }

  /** De hora em hora: indicações pendentes com prazo vencido. */
  @Cron(CronExpression.EVERY_HOUR)
  async expire(now = new Date()) {
    const result = await this.prisma.referral.updateMany({ where: { status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
    return result.count;
  }

  // ---------------------------------------------------------------------------
  // Pessoa (cliente, entregador ou empresa)
  // ---------------------------------------------------------------------------

  async mine(user: AuthUser, program: ReferralProgram) {
    const config = await this.settings.get(user.tenantId, 'referral');
    const rules = programConfig(config, program);
    if (!config.enabled) return { enabled: false as const };
    const code = await this.codeFor(user.tenantId, user.userId);
    const referrals = await this.prisma.referral.findMany({ where: { referrerUserId: user.userId }, orderBy: { createdAt: 'desc' }, take: 50 });
    const names = await this.prisma.user.findMany({ where: { id: { in: referrals.map((row) => row.referredUserId) } }, select: { id: true, name: true } });
    const firstName = new Map(names.map((row) => [row.id, row.name.split(/\s+/)[0]]));
    const earnedCents = referrals.filter((row) => row.status === 'REWARDED').reduce((sum, row) => sum + row.referrerRewardCents, 0);
    return {
      enabled: true as const,
      code,
      program,
      programEnabled: rules.enabled,
      referrerRewardCents: rules.referrerRewardCents,
      referredRewardCents: rules.referredRewardCents,
      goal: this.goalText(config, program),
      windowDays: config.windowDays,
      programs: (['CUSTOMER', 'DRIVER', 'COMPANY'] as const)
        .filter((key) => programConfig(config, key).enabled)
        .map((key) => ({ program: key, referrerRewardCents: programConfig(config, key).referrerRewardCents, referredRewardCents: programConfig(config, key).referredRewardCents, goal: this.goalText(config, key) })),
      stats: {
        total: referrals.length,
        pending: referrals.filter((row) => row.status === 'PENDING').length,
        rewarded: referrals.filter((row) => row.status === 'REWARDED').length,
        earnedCents,
      },
      // Só o primeiro nome de quem foi indicado (privacidade).
      referrals: referrals.map((row) => ({
        id: row.id,
        program: row.program,
        name: firstName.get(row.referredUserId) ?? 'Pessoa indicada',
        status: row.status,
        rewardCents: row.referrerRewardCents,
        expiresAt: row.expiresAt,
        rewardedAt: row.rewardedAt,
        createdAt: row.createdAt,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Painel (supervisão humana)
  // ---------------------------------------------------------------------------

  async list(tenantId: string, query: ReferralsQuery) {
    const where: Prisma.ReferralWhereInput = { tenantId, ...(query.status ? { status: query.status } : {}), ...(query.program ? { program: query.program } : {}) };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.referral.count({ where }),
      this.prisma.referral.findMany({ where, orderBy: { createdAt: 'desc' }, skip: skipOf(query), take: query.pageSize }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.flatMap((row) => [row.referrerUserId, row.referredUserId]) } }, select: { id: true, name: true, email: true } });
    const byId = new Map(users.map((row) => [row.id, row]));
    return paginated(
      rows.map((row) => ({ ...row, referrer: byId.get(row.referrerUserId) ?? null, referred: byId.get(row.referredUserId) ?? null })),
      total,
      query,
    );
  }

  async overview(tenantId: string) {
    const config = await this.settings.get(tenantId, 'referral');
    const [byStatus, paid] = await Promise.all([
      this.prisma.referral.groupBy({ by: ['program', 'status'], where: { tenantId }, _count: { _all: true } }),
      this.prisma.referral.aggregate({ where: { tenantId, status: 'REWARDED' }, _sum: { referrerRewardCents: true, referredRewardCents: true } }),
    ]);
    return {
      enabled: config.enabled,
      programs: (['CUSTOMER', 'DRIVER', 'COMPANY'] as const).map((program) => ({
        program,
        enabled: programConfig(config, program).enabled,
        goal: this.goalText(config, program),
        counts: Object.fromEntries(byStatus.filter((row) => row.program === program).map((row) => [row.status, row._count._all])),
      })),
      paidCents: (paid._sum.referrerRewardCents ?? 0) + (paid._sum.referredRewardCents ?? 0),
    };
  }

  /** A equipe libera a recompensa (indicação retida ou meta conferida manualmente). */
  async approve(actor: AuthUser, id: string, note: string) {
    const referral = await this.prisma.referral.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!referral) throw new NotFoundException('Indicação não encontrada.');
    if (!['PENDING', 'REJECTED'].includes(referral.status)) throw new ConflictException('Esta indicação já foi encerrada.');
    await this.pay(referral.id, { approved: true });
    await this.audit.log({ action: 'referral.approve', entityType: 'Referral', entityId: id, before: { status: referral.status, reason: referral.reason }, after: { status: 'REWARDED' }, metadata: { note } });
    return this.prisma.referral.findUniqueOrThrow({ where: { id } });
  }

  async reject(actor: AuthUser, id: string, reason: string) {
    const referral = await this.prisma.referral.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!referral) throw new NotFoundException('Indicação não encontrada.');
    if (referral.status !== 'PENDING' && referral.status !== 'REJECTED') throw new ConflictException('Esta indicação já foi encerrada.');
    const updated = await this.prisma.referral.update({ where: { id }, data: { status: 'REJECTED', reason } });
    await this.audit.log({ action: 'referral.reject', entityType: 'Referral', entityId: id, before: { status: referral.status }, after: { status: 'REJECTED', reason } });
    return updated;
  }

  assertProgram(user: AuthUser, program: ReferralProgram) {
    if (program === 'CUSTOMER' && !user.customerId) throw new ForbiddenException('Disponível para clientes.');
    if (program === 'DRIVER' && !user.driverId) throw new ForbiddenException('Disponível para entregadores.');
  }
}
