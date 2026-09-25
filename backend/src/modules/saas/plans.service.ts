import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CacheService } from '../../infra/cache/cache.service';
import { AuditService, diff } from '../audit/audit.service';
import { Prisma } from '../../generated/prisma/client';
import { planLimits, SubscriptionsService } from './subscriptions.service';

export interface PlanInput {
  key: string;
  name: string;
  description?: string | null;
  priceCents: number;
  features: string[];
  limits: Record<string, number | null>;
  trialDays?: number;
  isPublic?: boolean;
  isActive?: boolean;
  isDefault?: boolean;
  sortOrder?: number;
}

/** Planos SaaS do tenant (configuráveis no painel). */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string) {
    const [plans, counts] = await Promise.all([
      this.prisma.plan.findMany({ where: { tenantId }, orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }] }),
      this.prisma.companySubscription.groupBy({ by: ['planId'], where: { tenantId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } }, _count: { _all: true } }),
    ]);
    const subscribers = new Map(counts.map((row) => [row.planId, row._count._all]));
    return plans.map((plan) => ({ ...plan, limits: planLimits(plan.limits), subscribers: subscribers.get(plan.id) ?? 0 }));
  }

  async create(tenantId: string, input: PlanInput) {
    SubscriptionsService.validatePlanInput(input.features, input.limits);
    try {
      const plan = await this.prisma.$transaction(async (tx) => {
        if (input.isDefault) await tx.plan.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } });
        return tx.plan.create({ data: { ...this.data(input), tenantId, key: input.key } });
      });
      await this.afterChange();
      await this.audit.log({ action: 'plan.create', entityType: 'Plan', entityId: plan.id, after: plan as unknown as Record<string, unknown> });
      return plan;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Já existe um plano com esta chave.');
      throw error;
    }
  }

  async update(tenantId: string, id: string, input: Partial<PlanInput>) {
    const plan = await this.prisma.plan.findFirst({ where: { id, tenantId } });
    if (!plan) throw new NotFoundException('Plano não encontrado.');
    if (input.features || input.limits) SubscriptionsService.validatePlanInput(input.features ?? plan.features, input.limits ?? {});
    if (plan.isDefault && (input.isDefault === false || input.isActive === false)) {
      throw new BadRequestException('O plano padrão precisa continuar ativo. Defina outro plano como padrão antes.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) await tx.plan.updateMany({ where: { tenantId, isDefault: true, id: { not: id } }, data: { isDefault: false } });
      return tx.plan.update({ where: { id }, data: this.data({ ...input, limits: input.limits ? { ...planLimits(plan.limits), ...input.limits } : undefined } as Partial<PlanInput>) });
    });
    await this.afterChange();
    await this.audit.log({ action: 'plan.update', entityType: 'Plan', entityId: id, ...diff(plan, updated) });
    return updated;
  }

  private data(input: Partial<PlanInput>) {
    return {
      name: input.name?.trim(),
      description: input.description === undefined ? undefined : input.description?.trim() || null,
      priceCents: input.priceCents,
      features: input.features ? [...new Set(input.features)] : undefined,
      limits: input.limits ? (input.limits as Prisma.InputJsonValue) : undefined,
      trialDays: input.trialDays,
      isPublic: input.isPublic,
      isActive: input.isActive,
      isDefault: input.isDefault,
      sortOrder: input.sortOrder,
    } as Prisma.PlanUncheckedCreateInput;
  }

  /** Recursos e limites em cache (plano efetivo das empresas) deixam de valer. */
  private async afterChange() {
    await this.cache.delByPrefix('saas:effective:');
  }
}
