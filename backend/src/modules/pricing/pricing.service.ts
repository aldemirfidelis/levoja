import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CacheService } from '../../infra/cache/cache.service';
import { AuditService, diff } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { localWeekMinute } from '../../common/opening-hours';
import { computePrice, PriceQuote, PriceRule, selectRule, TimeWindow } from './pricing.engine';
import { Prisma } from '../../generated/prisma/client';
import type { PricingTarget, VehicleType } from '../../generated/prisma/enums';

export interface QuoteInput {
  tenantId: string;
  target: PricingTarget;
  distanceKm: number;
  durationMin: number;
  weightKg?: number;
  vehicleType?: VehicleType;
  city?: string;
  state?: string;
  at?: Date;
  timeZone?: string;
}

/** Fonte da pressão de demanda (oferta x demanda). O despacho registra a implementação real. */
export type DemandSignal = (tenantId: string, city?: string) => Promise<number>;

const normalizeCity = (city?: string, state?: string) =>
  `${(city ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()}/${(state ?? '').trim().toLowerCase()}`;

@Injectable()
export class PricingService {
  private demandSignal: DemandSignal = async () => 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  registerDemandSignal(signal: DemandSignal): void {
    this.demandSignal = signal;
  }

  private async rules(tenantId: string, target: PricingTarget): Promise<PriceRule[]> {
    return this.cache.wrap(`pricing:${tenantId}:${target}`, 60, async () => {
      const rows = await this.prisma.pricingRule.findMany({ where: { tenantId, target, isActive: true } });
      return rows.map((row) => ({ ...row, timeWindows: (row.timeWindows as TimeWindow[] | null) ?? null }));
    });
  }

  async quote(input: QuoteInput): Promise<PriceQuote> {
    const rules = await this.rules(input.tenantId, input.target);
    const { weekday, minute } = localWeekMinute(input.at ?? new Date(), input.timeZone ?? 'America/Sao_Paulo');
    const rainCities = await this.settings.get(input.tenantId, 'ops.rainCities');
    const context = {
      distanceKm: input.distanceKm,
      durationMin: input.durationMin,
      weightKg: input.weightKg,
      vehicleType: input.vehicleType,
      city: input.city,
      state: input.state,
      weekday,
      minuteOfDay: minute,
      raining: rainCities.includes(normalizeCity(input.city, input.state)),
      demandPressure: await this.demandSignal(input.tenantId, input.city),
    };
    const rule = selectRule(rules, context);
    if (!rule) throw new UnprocessableEntityException('Não há regra de preço configurada para esta entrega. Contate o suporte.');
    return computePrice(rule, context);
  }

  // --- Administração ---

  list(tenantId: string) {
    return this.prisma.pricingRule.findMany({ where: { tenantId }, orderBy: [{ target: 'asc' }, { priority: 'desc' }, { name: 'asc' }] });
  }

  async create(tenantId: string, data: Omit<Prisma.PricingRuleUncheckedCreateInput, 'tenantId'>) {
    const rule = await this.prisma.pricingRule.create({ data: { ...data, tenantId } });
    await this.invalidate(tenantId);
    await this.audit.log({ action: 'pricing.rule.create', entityType: 'PricingRule', entityId: rule.id, after: rule as unknown as Record<string, unknown> });
    return rule;
  }

  async update(tenantId: string, id: string, data: Prisma.PricingRuleUncheckedUpdateInput) {
    const rule = await this.prisma.pricingRule.findFirst({ where: { id, tenantId } });
    if (!rule) throw new NotFoundException('Regra não encontrada.');
    const updated = await this.prisma.pricingRule.update({ where: { id }, data });
    await this.invalidate(tenantId);
    await this.audit.log({ action: 'pricing.rule.update', entityType: 'PricingRule', entityId: id, ...diff(rule, updated) });
    return updated;
  }

  private async invalidate(tenantId: string) {
    await this.cache.del(`pricing:${tenantId}:CUSTOMER_FEE`, `pricing:${tenantId}:DRIVER_PAYOUT`);
  }
}
