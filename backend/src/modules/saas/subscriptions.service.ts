import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { formatBRL, PLAN_FEATURE_LABELS, PLAN_FEATURES, PLAN_LIMIT_KEYS, PLAN_LIMIT_LABELS, type PlanFeature, type PlanLimitKey, type PlanLimits } from '@levoja/shared';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { CacheService } from '../../infra/cache/cache.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../finance/ledger.service';
import { nextCounter } from '../../common/counters';
import { paginated, PaginationQueryDto, skipOf } from '../../common/pagination';
import type { AuthUser } from '../../common/auth/auth-user';
import type { Plan, CompanySubscription } from '../../generated/prisma/client';
import type { SubscriptionStatus } from '../../generated/prisma/enums';

/** Cobrança da assinatura criada (webhooks). */
export const SUBSCRIPTION_INVOICE_CREATED = 'subscription.invoice.created';
export interface SubscriptionInvoiceCreatedEvent {
  tenantId: string;
  companyId: string;
  invoiceId: string;
  number: number;
  amountCents: number;
  description: string;
}

export interface EffectivePlan {
  /** false = planos desligados no tenant: todos os recursos, sem limites. */
  enforced: boolean;
  plan: { id: string; key: string; name: string } | null;
  status: SubscriptionStatus | null;
  /** Assinatura em atraso além da carência: recursos do plano padrão. */
  restricted: boolean;
  features: PlanFeature[];
  limits: PlanLimits;
}

export interface SubscriptionsQuery extends PaginationQueryDto {
  status?: SubscriptionStatus;
  planId?: string;
}

const UNLIMITED: PlanLimits = { maxProducts: null, maxUsers: null, maxApiKeys: null, maxLocations: null, apiRequestsPerMinute: null };
const ACTIVE_STATUSES: SubscriptionStatus[] = ['TRIALING', 'ACTIVE', 'PAST_DUE'];
const DAY = 86_400_000;

/** Mesmo dia no mês seguinte (31/01 → 28/02), em UTC. */
export function addMonth(date: Date): Date {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return next;
}

/** Diferença proporcional ao tempo restante do período (upgrade no meio do mês). */
export function prorate(oldPriceCents: number, newPriceCents: number, periodStart: Date, periodEnd: Date, now: Date): number {
  const total = periodEnd.getTime() - periodStart.getTime();
  const remaining = Math.max(0, periodEnd.getTime() - now.getTime());
  if (total <= 0 || newPriceCents <= oldPriceCents) return 0;
  return Math.round(((newPriceCents - oldPriceCents) * remaining) / total);
}

export function planLimits(value: unknown): PlanLimits {
  const raw = (value ?? {}) as Record<string, unknown>;
  return Object.fromEntries(PLAN_LIMIT_KEYS.map((key) => [key, typeof raw[key] === 'number' ? (raw[key] as number) : null])) as PlanLimits;
}

/**
 * Assinaturas SaaS das empresas:
 * - o plano define recursos (PLAN_FEATURES) e limites; sem assinatura vale o plano padrão;
 * - a mensalidade é lançada na carteira da empresa (descontada das vendas); saldo negativo é
 *   quitado por PIX na tela de financeiro. Cobrança em aberto além da carência deixa a
 *   assinatura em atraso e, depois, reduz os recursos aos do plano padrão até a regularização;
 * - upgrade vale na hora (cobra a diferença proporcional); downgrade vale no fim do período.
 * Com a configuração `saas.enabled` desligada, nada é cobrado nem restringido.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly events: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------------
  // Plano efetivo, recursos e limites
  // ---------------------------------------------------------------------------

  async effective(tenantId: string, companyId: string): Promise<EffectivePlan> {
    const config = await this.settings.get(tenantId, 'saas');
    if (!config.enabled) return { enforced: false, plan: null, status: null, restricted: false, features: [...PLAN_FEATURES], limits: UNLIMITED };
    return this.cache.wrap(`saas:effective:${companyId}`, 30, async () => {
      const [subscription, fallback] = await Promise.all([
        this.prisma.companySubscription.findUnique({ where: { companyId }, include: { plan: true } }),
        this.defaultPlan(tenantId),
      ]);
      const view = (plan: Plan | null, status: SubscriptionStatus | null, restricted = false): EffectivePlan => ({
        enforced: true,
        plan: plan ? { id: plan.id, key: plan.key, name: plan.name } : null,
        status,
        restricted,
        features: (plan?.features ?? ['catalog', 'orders']) as PlanFeature[],
        limits: plan ? planLimits(plan.limits) : UNLIMITED,
      });
      if (!subscription || subscription.status === 'CANCELED') return view(fallback, subscription?.status ?? null);
      if (subscription.status === 'PAST_DUE' && subscription.pastDueSince && Date.now() - subscription.pastDueSince.getTime() > config.restrictAfterDays * DAY) {
        return view(fallback, 'PAST_DUE', true);
      }
      return view(subscription.plan, subscription.status);
    });
  }

  private defaultPlan(tenantId: string) {
    return this.prisma.plan.findFirst({ where: { tenantId, isDefault: true, isActive: true } });
  }

  async invalidate(companyId: string) {
    await this.cache.del(`saas:effective:${companyId}`);
  }

  /** Planos ativos que liberam o recurso (mensagem de upgrade). */
  private async plansWith(tenantId: string, feature: PlanFeature) {
    const plans = await this.prisma.plan.findMany({ where: { tenantId, isActive: true, isPublic: true, features: { has: feature } }, orderBy: { priceCents: 'asc' }, select: { key: true, name: true } });
    return plans;
  }

  async hasFeature(tenantId: string, companyId: string, feature: PlanFeature): Promise<boolean> {
    return (await this.effective(tenantId, companyId)).features.includes(feature);
  }

  async assertFeature(tenantId: string, companyId: string, feature: PlanFeature): Promise<void> {
    const effective = await this.effective(tenantId, companyId);
    if (effective.features.includes(feature)) return;
    const plans = await this.plansWith(tenantId, feature);
    const suffix = effective.restricted ? ' A assinatura está em atraso: regularize o pagamento para voltar a usar os recursos do seu plano.' : plans.length ? ` Disponível no plano ${plans.map((plan) => plan.name).join(' ou ')}.` : '';
    throw new ForbiddenException({
      message: `${PLAN_FEATURE_LABELS[feature]} não está incluído no plano ${effective.plan?.name ?? 'atual'}.${suffix}`,
      details: { feature, plans: plans.map((plan) => plan.key), restricted: effective.restricted },
    });
  }

  /** Limite do plano: `current` é a quantidade já existente antes de criar mais um. */
  async assertLimit(tenantId: string, companyId: string, key: PlanLimitKey, current: number): Promise<void> {
    const effective = await this.effective(tenantId, companyId);
    const limit = effective.limits[key];
    if (limit == null || current < limit) return;
    throw new ForbiddenException({
      message: `Limite do plano ${effective.plan?.name ?? 'atual'} atingido: ${PLAN_LIMIT_LABELS[key].toLowerCase()} — máximo de ${limit}. Troque de plano para ampliar.`,
      details: { limit: key, max: limit },
    });
  }

  /** Uso atual da empresa em cada limite. */
  async usage(companyId: string): Promise<Record<Exclude<PlanLimitKey, 'apiRequestsPerMinute'>, number>> {
    const now = new Date();
    const [maxProducts, maxUsers, maxApiKeys, maxLocations] = await Promise.all([
      this.prisma.product.count({ where: { companyId, deletedAt: null } }),
      this.prisma.companyUser.count({ where: { companyId, isActive: true } }),
      this.prisma.companyApiKey.count({ where: { companyId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
      this.prisma.companyLocation.count({ where: { companyId, isActive: true } }),
    ]);
    return { maxProducts, maxUsers, maxApiKeys, maxLocations };
  }

  // ---------------------------------------------------------------------------
  // Contratação, troca e cancelamento
  // ---------------------------------------------------------------------------

  private async company(tenantId: string, companyId: string) {
    const company = await this.prisma.company.findFirst({ where: { id: companyId, tenantId }, select: { id: true, tradeName: true, status: true } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    return company;
  }

  private async planByKey(tenantId: string, key: string, byStaff: boolean) {
    const plan = await this.prisma.plan.findUnique({ where: { tenantId_key: { tenantId, key } } });
    if (!plan || !plan.isActive || (!byStaff && !plan.isPublic)) throw new NotFoundException('Plano não encontrado ou indisponível.');
    return plan;
  }

  /** Contrata ou troca de plano (a equipe pode aplicar na hora e usar planos não públicos). */
  async choose(actor: AuthUser, companyId: string, planKey: string, options: { immediate?: boolean } = {}) {
    await this.company(actor.tenantId, companyId);
    const byStaff = actor.isStaff;
    const plan = await this.planByKey(actor.tenantId, planKey, byStaff);
    const current = await this.prisma.companySubscription.findUnique({ where: { companyId }, include: { plan: true } });
    const now = new Date();

    // Sem assinatura, cancelada ou saindo de um plano grátis para um pago: começa um período novo (com teste grátis, se ainda não usou).
    if (!current || current.status === 'CANCELED' || (current.priceCents === 0 && plan.priceCents > 0)) {
      const trialUsed = !!current?.trialEndsAt;
      const trial = plan.priceCents > 0 && plan.trialDays > 0 && !trialUsed;
      const periodEnd = trial ? new Date(now.getTime() + plan.trialDays * DAY) : addMonth(now);
      const data = {
        planId: plan.id,
        status: (trial ? 'TRIALING' : 'ACTIVE') as SubscriptionStatus,
        priceCents: plan.priceCents,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        trialEndsAt: trial ? periodEnd : (current?.trialEndsAt ?? null),
        cancelAtPeriodEnd: false,
        scheduledPlanId: null,
        pastDueSince: null,
        canceledAt: null,
      };
      await this.assertFits(companyId, plan);
      const subscription = current
        ? await this.prisma.companySubscription.update({ where: { id: current.id }, data })
        : await this.prisma.companySubscription.create({ data: { tenantId: actor.tenantId, companyId, ...data } });
      if (!trial && plan.priceCents > 0) await this.invoice(subscription, plan, now, periodEnd, plan.priceCents, `Plano ${plan.name} — ${this.periodLabel(now, periodEnd)}`);
      await this.audit.log({ action: 'subscription.start', entityType: 'Company', entityId: companyId, after: { plan: plan.key, trial } });
      await this.invalidate(companyId);
      return this.companyView(actor.tenantId, companyId);
    }

    if (current.planId === plan.id) {
      if (current.scheduledPlanId || current.cancelAtPeriodEnd) {
        // Voltar ao plano atual desfaz a troca/cancelamento agendados.
        await this.prisma.companySubscription.update({ where: { id: current.id }, data: { scheduledPlanId: null, cancelAtPeriodEnd: false } });
        await this.invalidate(companyId);
        return this.companyView(actor.tenantId, companyId);
      }
      throw new ConflictException('A empresa já está neste plano.');
    }

    const upgrade = plan.priceCents > current.priceCents;
    const freeToFree = current.priceCents === 0 && plan.priceCents === 0;
    if (upgrade || freeToFree || current.status === 'TRIALING' || options.immediate) {
      await this.assertFits(companyId, plan);
      const amount = current.status === 'TRIALING' ? 0 : prorate(current.priceCents, plan.priceCents, current.currentPeriodStart, current.currentPeriodEnd, now);
      const updated = await this.prisma.companySubscription.update({
        where: { id: current.id },
        data: { planId: plan.id, priceCents: current.status === 'TRIALING' || upgrade ? plan.priceCents : current.priceCents, scheduledPlanId: null, cancelAtPeriodEnd: false },
      });
      if (amount > 0) {
        await this.invoice(updated, plan, now, current.currentPeriodEnd, amount, `Diferença proporcional: de ${current.plan.name} para ${plan.name}`);
      }
      await this.audit.log({ action: 'subscription.change', entityType: 'Company', entityId: companyId, before: { plan: current.plan.key }, after: { plan: plan.key, proratedCents: amount } });
    } else {
      // Plano menor: vale a partir do próximo período (o período atual já foi pago).
      await this.assertFits(companyId, plan);
      await this.prisma.companySubscription.update({ where: { id: current.id }, data: { scheduledPlanId: plan.id, cancelAtPeriodEnd: false } });
      await this.audit.log({ action: 'subscription.schedule_change', entityType: 'Company', entityId: companyId, before: { plan: current.plan.key }, after: { plan: plan.key, at: current.currentPeriodEnd } });
    }
    await this.invalidate(companyId);
    return this.companyView(actor.tenantId, companyId);
  }

  /** O uso atual cabe nos limites do plano de destino? */
  private async assertFits(companyId: string, plan: Plan) {
    const limits = planLimits(plan.limits);
    const usage = await this.usage(companyId);
    const over = (Object.keys(usage) as (keyof typeof usage)[]).filter((key) => limits[key] != null && usage[key] > limits[key]!);
    if (over.length) {
      throw new ConflictException({
        message: `O plano ${plan.name} não comporta o uso atual: ${over.map((key) => `${PLAN_LIMIT_LABELS[key].toLowerCase()} (${usage[key]} de ${limits[key]})`).join(', ')}. Reduza o uso antes de trocar.`,
        details: { over },
      });
    }
  }

  async cancel(actor: AuthUser, companyId: string) {
    const subscription = await this.prisma.companySubscription.findUnique({ where: { companyId } });
    if (!subscription || subscription.status === 'CANCELED' || subscription.tenantId !== actor.tenantId) throw new ConflictException('Não há assinatura ativa.');
    if (subscription.status === 'TRIALING') {
      await this.prisma.companySubscription.update({ where: { id: subscription.id }, data: { status: 'CANCELED', canceledAt: new Date(), scheduledPlanId: null } });
    } else {
      await this.prisma.companySubscription.update({ where: { id: subscription.id }, data: { cancelAtPeriodEnd: true, scheduledPlanId: null } });
    }
    await this.audit.log({ action: 'subscription.cancel', entityType: 'Company', entityId: companyId });
    await this.invalidate(companyId);
    return this.companyView(actor.tenantId, companyId);
  }

  async resume(actor: AuthUser, companyId: string) {
    const updated = await this.prisma.companySubscription.updateMany({ where: { companyId, tenantId: actor.tenantId, cancelAtPeriodEnd: true, status: { in: ACTIVE_STATUSES } }, data: { cancelAtPeriodEnd: false } });
    if (!updated.count) throw new ConflictException('Não há cancelamento agendado.');
    await this.audit.log({ action: 'subscription.resume', entityType: 'Company', entityId: companyId });
    await this.invalidate(companyId);
    return this.companyView(actor.tenantId, companyId);
  }

  // ---------------------------------------------------------------------------
  // Cobrança
  // ---------------------------------------------------------------------------

  private periodLabel(start: Date, end: Date) {
    const format = (date: Date) => date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return `${format(start)} a ${format(new Date(end.getTime() - 1))}`;
  }

  /** Cria a cobrança e lança na carteira da empresa (e na da plataforma), de forma idempotente. */
  private async invoice(subscription: CompanySubscription, plan: Plan, periodStart: Date, periodEnd: Date, amountCents: number, description: string) {
    const invoice = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.subscriptionInvoice.findUnique({ where: { subscriptionId_periodStart: { subscriptionId: subscription.id, periodStart } } });
      if (existing) return null;
      const created = await tx.subscriptionInvoice.create({
        data: {
          tenantId: subscription.tenantId,
          subscriptionId: subscription.id,
          companyId: subscription.companyId,
          planId: plan.id,
          number: await nextCounter(tx, subscription.tenantId, 'subscription_invoice'),
          description,
          periodStart,
          periodEnd,
          amountCents,
        },
      });
      await this.ledger.post(tx, subscription.tenantId, [
        { owner: { type: 'COMPANY', companyId: subscription.companyId }, type: 'SUBSCRIPTION', amountCents: -amountCents, description: `${description} (cobrança #${created.number})`, referenceKey: `subscription:${created.id}:company` },
        { owner: { type: 'PLATFORM' }, type: 'SUBSCRIPTION', amountCents, description: `Assinatura — ${description} (cobrança #${created.number})`, referenceKey: `subscription:${created.id}:platform` },
      ]);
      await this.settleIfCovered(tx, created.id, subscription.companyId);
      return created;
    });
    if (invoice) {
      this.events.emit(SUBSCRIPTION_INVOICE_CREATED, {
        tenantId: subscription.tenantId,
        companyId: subscription.companyId,
        invoiceId: invoice.id,
        number: invoice.number,
        amountCents,
        description,
      } satisfies SubscriptionInvoiceCreatedEvent);
    }
    return invoice;
  }

  /** Cobrança paga quando a carteira da empresa não está negativa (vendas ou PIX cobriram o valor). */
  private async settleIfCovered(tx: Tx, invoiceId: string, companyId: string) {
    const wallet = await tx.wallet.findUnique({ where: { companyId }, select: { availableCents: true } });
    if ((wallet?.availableCents ?? 0) >= 0) {
      await tx.subscriptionInvoice.updateMany({ where: { id: invoiceId, status: 'OPEN' }, data: { status: 'PAID', paidAt: new Date() } });
      return true;
    }
    return false;
  }

  /** Renovações vencidas, trocas agendadas, cancelamentos e situação de pagamento (a cada hora). */
  @Cron('0 25 * * * *')
  async billingCycle(now = new Date()) {
    let renewed = 0;
    const due = await this.prisma.companySubscription.findMany({ where: { status: { in: ACTIVE_STATUSES }, currentPeriodEnd: { lte: now } }, include: { plan: true }, take: 500 });
    for (const subscription of due) {
      try {
        if (await this.renew(subscription, now)) renewed++;
      } catch (error) {
        this.logger.error(`Renovação da assinatura ${subscription.id} falhou: ${(error as Error).message}`);
      }
    }
    await this.reconcile(now);
    return { renewed };
  }

  private async renew(subscription: CompanySubscription & { plan: Plan }, now: Date): Promise<boolean> {
    if (subscription.cancelAtPeriodEnd) {
      await this.prisma.companySubscription.update({ where: { id: subscription.id }, data: { status: 'CANCELED', canceledAt: now, cancelAtPeriodEnd: false } });
      await this.invalidate(subscription.companyId);
      return true;
    }
    const plan = subscription.scheduledPlanId ? await this.prisma.plan.findUnique({ where: { id: subscription.scheduledPlanId } }) : subscription.plan;
    const next = plan && plan.isActive ? plan : subscription.plan;
    let start = subscription.currentPeriodEnd;
    let end = addMonth(start);
    // API parada por muito tempo: começa o período atual, sem cobrar meses retroativos.
    while (end <= now) {
      start = end;
      end = addMonth(start);
    }
    const updated = await this.prisma.companySubscription.update({
      where: { id: subscription.id },
      data: {
        planId: next.id,
        priceCents: next.priceCents,
        scheduledPlanId: null,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        status: subscription.status === 'TRIALING' ? 'ACTIVE' : subscription.status,
      },
    });
    if (next.priceCents > 0) await this.invoice(updated, next, start, end, next.priceCents, `Plano ${next.name} — ${this.periodLabel(start, end)}`);
    await this.invalidate(subscription.companyId);
    return true;
  }

  /** Baixa das cobranças cobertas pelo saldo e atualização de atraso. */
  async reconcile(now = new Date()) {
    const open = await this.prisma.subscriptionInvoice.findMany({ where: { status: 'OPEN' }, select: { id: true, companyId: true }, take: 2000 });
    for (const invoice of open) {
      await this.prisma.$transaction((tx) => this.settleIfCovered(tx, invoice.id, invoice.companyId));
    }
    const stillOpen = await this.prisma.subscriptionInvoice.groupBy({ by: ['subscriptionId'], where: { status: 'OPEN' }, _min: { createdAt: true } });
    const oldestOpen = new Map(stillOpen.map((row) => [row.subscriptionId, row._min.createdAt!]));
    const subscriptions = await this.prisma.companySubscription.findMany({
      where: { OR: [{ status: 'PAST_DUE' }, { status: 'ACTIVE', id: { in: [...oldestOpen.keys()] } }] },
      select: { id: true, tenantId: true, companyId: true, status: true },
    });
    for (const subscription of subscriptions) {
      const oldest = oldestOpen.get(subscription.id);
      const { graceDays } = await this.settings.get(subscription.tenantId, 'saas');
      if (oldest && now.getTime() - oldest.getTime() > graceDays * DAY) {
        if (subscription.status === 'ACTIVE') {
          await this.prisma.companySubscription.update({ where: { id: subscription.id }, data: { status: 'PAST_DUE', pastDueSince: now } });
          await this.invalidate(subscription.companyId);
        }
      } else if (!oldest && subscription.status === 'PAST_DUE') {
        await this.prisma.companySubscription.update({ where: { id: subscription.id }, data: { status: 'ACTIVE', pastDueSince: null } });
        await this.invalidate(subscription.companyId);
      }
    }
  }

  /** Anula uma cobrança (estorna o lançamento na carteira). */
  async voidInvoice(actor: AuthUser, invoiceId: string, reason: string) {
    const invoice = await this.prisma.subscriptionInvoice.findFirst({ where: { id: invoiceId, tenantId: actor.tenantId } });
    if (!invoice) throw new NotFoundException('Cobrança não encontrada.');
    if (invoice.status === 'VOID') throw new ConflictException('Cobrança já anulada.');
    await this.prisma.$transaction(async (tx) => {
      await tx.subscriptionInvoice.update({ where: { id: invoiceId }, data: { status: 'VOID', voidedAt: new Date() } });
      await this.ledger.post(tx, actor.tenantId, [
        { owner: { type: 'COMPANY', companyId: invoice.companyId }, type: 'SUBSCRIPTION', amountCents: invoice.amountCents, description: `Estorno da cobrança #${invoice.number}: ${reason}`, referenceKey: `subscription:${invoice.id}:void-company` },
        { owner: { type: 'PLATFORM' }, type: 'SUBSCRIPTION', amountCents: -invoice.amountCents, description: `Estorno da cobrança #${invoice.number}`, referenceKey: `subscription:${invoice.id}:void-platform` },
      ]);
    });
    await this.audit.log({ action: 'subscription.invoice.void', entityType: 'SubscriptionInvoice', entityId: invoiceId, metadata: { reason } });
    await this.reconcile();
  }

  // ---------------------------------------------------------------------------
  // Consultas
  // ---------------------------------------------------------------------------

  async companyView(tenantId: string, companyId: string) {
    await this.company(tenantId, companyId);
    const [config, subscription, effective, usage, invoices, plans, wallet] = await Promise.all([
      this.settings.get(tenantId, 'saas'),
      this.prisma.companySubscription.findUnique({ where: { companyId }, include: { plan: true } }),
      this.effective(tenantId, companyId),
      this.usage(companyId),
      this.prisma.subscriptionInvoice.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 24 }),
      this.prisma.plan.findMany({ where: { tenantId, isActive: true, isPublic: true }, orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }] }),
      this.prisma.wallet.findUnique({ where: { companyId }, select: { availableCents: true } }),
    ]);
    const scheduled = subscription?.scheduledPlanId ? await this.prisma.plan.findUnique({ where: { id: subscription.scheduledPlanId }, select: { key: true, name: true } }) : null;
    return {
      enabled: config.enabled,
      effective,
      usage,
      walletAvailableCents: wallet?.availableCents ?? 0,
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            plan: { key: subscription.plan.key, name: subscription.plan.name },
            priceCents: subscription.priceCents,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            trialEndsAt: subscription.trialEndsAt,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            scheduledPlan: scheduled,
            pastDueSince: subscription.pastDueSince,
          }
        : null,
      invoices,
      plans: plans.map((plan) => ({ ...plan, limits: planLimits(plan.limits), priceLabel: plan.priceCents ? `${formatBRL(plan.priceCents)}/mês` : 'Grátis' })),
    };
  }

  async list(tenantId: string, query: SubscriptionsQuery) {
    const search = query.search?.trim();
    const where = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.planId ? { planId: query.planId } : {}),
      ...(search ? { company: { tradeName: { contains: search, mode: 'insensitive' as const } } } : {}),
    };
    const [total, rows, mrr] = await Promise.all([
      this.prisma.companySubscription.count({ where }),
      this.prisma.companySubscription.findMany({
        where,
        include: { plan: { select: { key: true, name: true } }, company: { select: { id: true, tradeName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: skipOf(query),
        take: query.pageSize,
      }),
      this.prisma.companySubscription.aggregate({ where: { tenantId, status: { in: ['ACTIVE', 'PAST_DUE'] } }, _sum: { priceCents: true }, _count: { _all: true } }),
    ]);
    const openInvoices = await this.prisma.subscriptionInvoice.groupBy({ by: ['companyId'], where: { companyId: { in: rows.map((row) => row.companyId) }, status: 'OPEN' }, _sum: { amountCents: true } });
    const openBy = new Map(openInvoices.map((row) => [row.companyId, row._sum.amountCents ?? 0]));
    return {
      ...paginated(
        rows.map((row) => ({ ...row, openCents: openBy.get(row.companyId) ?? 0 })),
        total,
        query,
      ),
      mrrCents: mrr._sum.priceCents ?? 0,
      paying: mrr._count._all,
    };
  }

  async invoices(tenantId: string, query: PaginationQueryDto & { status?: 'OPEN' | 'PAID' | 'VOID' }) {
    const where = { tenantId, ...(query.status ? { status: query.status } : {}) };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.subscriptionInvoice.count({ where }),
      this.prisma.subscriptionInvoice.findMany({ where, orderBy: { createdAt: 'desc' }, skip: skipOf(query), take: query.pageSize }),
    ]);
    const companies = await this.prisma.company.findMany({ where: { id: { in: rows.map((row) => row.companyId) } }, select: { id: true, tradeName: true } });
    const name = new Map(companies.map((company) => [company.id, company.tradeName]));
    return paginated(
      rows.map((row) => ({ ...row, companyName: name.get(row.companyId) ?? null })),
      total,
      query,
    );
  }

  /** Valida recursos e limites informados para um plano. */
  static validatePlanInput(features: string[], limits: Record<string, unknown>) {
    const unknown = features.filter((feature) => !PLAN_FEATURES.includes(feature as PlanFeature));
    if (unknown.length) throw new BadRequestException(`Recursos desconhecidos: ${unknown.join(', ')}.`);
    const badLimit = Object.entries(limits).find(([key, value]) => !PLAN_LIMIT_KEYS.includes(key as PlanLimitKey) || (value !== null && (!Number.isInteger(value) || (value as number) < 0)));
    if (badLimit) throw new BadRequestException(`Limite inválido: ${badLimit[0]}.`);
  }
}
