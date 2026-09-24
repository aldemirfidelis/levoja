import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { cityKey } from '@levoja/shared';
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

const normalizeCity = (city?: string, state?: string) => cityKey(city, state);

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

  /** Adicionais programados vigentes ou futuros (cache curto; a operação cria e encerra pelo painel). */
  private async surcharges(tenantId: string) {
    return this.cache.wrap(`pricing:${tenantId}:surcharges`, 60, async () => {
      const rows = await this.prisma.pricingSurcharge.findMany({
        where: { tenantId, canceledAt: null, endsAt: { gt: new Date(Date.now() - 3_600_000) } },
        select: { city: true, startsAt: true, endsAt: true, surchargeBps: true },
      });
      return rows.map((row) => ({ city: row.city, startsAt: row.startsAt.getTime(), endsAt: row.endsAt.getTime(), surchargeBps: row.surchargeBps }));
    });
  }

  /** Maior adicional programado que vale para a cidade no momento da entrega. */
  async scheduledSurchargeBps(tenantId: string, at: Date, city?: string, state?: string): Promise<number> {
    const key = normalizeCity(city, state);
    const time = at.getTime();
    const matching = (await this.surcharges(tenantId)).filter((row) => (!row.city || row.city === key) && row.startsAt <= time && time < row.endsAt);
    return matching.reduce((max, row) => Math.max(max, row.surchargeBps), 0);
  }

  async invalidateSurcharges(tenantId: string) {
    await this.cache.del(`pricing:${tenantId}:surcharges`);
  }

  private async context(input: Omit<QuoteInput, 'target'>, withDemand: boolean) {
    const { weekday, minute } = localWeekMinute(input.at ?? new Date(), input.timeZone ?? 'America/Sao_Paulo');
    const rainCities = await this.settings.get(input.tenantId, 'ops.rainCities');
    return {
      distanceKm: input.distanceKm,
      durationMin: input.durationMin,
      weightKg: input.weightKg,
      vehicleType: input.vehicleType,
      city: input.city,
      state: input.state,
      weekday,
      minuteOfDay: minute,
      raining: rainCities.includes(normalizeCity(input.city, input.state)),
      demandPressure: withDemand ? await this.demandSignal(input.tenantId, input.city) : 0,
      // Preço de contrato não oscila: o adicional programado vale só para a tabela padrão.
      scheduledSurchargeBps: withDemand ? await this.scheduledSurchargeBps(input.tenantId, input.at ?? new Date(), input.city, input.state) : 0,
    };
  }

  async quote(input: QuoteInput): Promise<PriceQuote> {
    const rules = await this.rules(input.tenantId, input.target);
    const context = await this.context(input, true);
    const rule = selectRule(rules, context);
    if (!rule) throw new UnprocessableEntityException('Não há regra de preço configurada para esta entrega. Contate o suporte.');
    return computePrice(rule, context);
  }

  /**
   * Cotação por uma tabela própria (ex.: tabela especial de contrato). Sem adicional de demanda:
   * o preço contratado não oscila com a oferta de entregadores. Retorna null se nenhuma regra se aplica.
   */
  async quoteWithRules(input: Omit<QuoteInput, 'target'>, rules: PriceRule[]): Promise<PriceQuote | null> {
    const context = await this.context(input, false);
    const rule = selectRule(rules, context);
    return rule ? computePrice(rule, context) : null;
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
