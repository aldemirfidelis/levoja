import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { cityKey } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { SettingsService } from '../settings/settings.service';
import type { AuthUser } from '../../common/auth/auth-user';
import type { SuggestionStatus } from '../../generated/prisma/enums';

export interface SurchargeInput {
  city?: string | null;
  state?: string | null;
  startsAt: string;
  endsAt: string;
  surchargeBps: number;
  reason: string;
}

/**
 * Adicionais de preço programados e as sugestões geradas pela previsão. A sugestão nunca é
 * aplicada sozinha: alguém com permissão de precificação aprova (vira um adicional com data e
 * hora) ou descarta. O adicional incide sobre o frete da tabela padrão e sobre o repasse ao
 * entregador — o incentivo que atrai mais entregadores para o pico.
 */
@Injectable()
export class SurchargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
  ) {}

  async suggestions(tenantId: string, status?: SuggestionStatus) {
    return this.prisma.pricingSuggestion.findMany({
      where: { tenantId, ...(status ? { status } : { status: 'PENDING', windowEnd: { gt: new Date() } }) },
      orderBy: { windowStart: status ? 'desc' : 'asc' },
      take: 100,
    });
  }

  async applySuggestion(actor: AuthUser, id: string, surchargeBps?: number) {
    const suggestion = await this.prisma.pricingSuggestion.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!suggestion) throw new NotFoundException('Sugestão não encontrada.');
    if (suggestion.status !== 'PENDING') throw new ConflictException('Esta sugestão já foi decidida.');
    if (suggestion.windowEnd <= new Date()) throw new ConflictException('O horário desta sugestão já passou.');
    const bps = surchargeBps ?? suggestion.surchargeBps;
    const { maxSurchargeBps } = await this.settings.get(actor.tenantId, 'intelligence');
    if (bps <= 0 || bps > maxSurchargeBps) throw new BadRequestException(`O adicional deve ficar entre 0,01% e ${(maxSurchargeBps / 100).toLocaleString('pt-BR')}%.`);
    const startsAt = suggestion.windowStart < new Date() ? new Date() : suggestion.windowStart;
    const surcharge = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.pricingSuggestion.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPLIED', decidedById: actor.userId, decidedAt: new Date() } });
      if (!claimed.count) throw new ConflictException('Esta sugestão já foi decidida.');
      const created = await tx.pricingSurcharge.create({
        data: { tenantId: actor.tenantId, city: suggestion.city, startsAt, endsAt: suggestion.windowEnd, surchargeBps: bps, reason: `Sugestão da previsão: ${suggestion.reason}`, createdById: actor.userId },
      });
      await tx.pricingSuggestion.update({ where: { id }, data: { surchargeId: created.id } });
      return created;
    });
    await this.pricing.invalidateSurcharges(actor.tenantId);
    await this.audit.log({ action: 'pricing.suggestion.apply', entityType: 'PricingSuggestion', entityId: id, after: { surchargeId: surcharge.id, surchargeBps: bps, suggestedBps: suggestion.surchargeBps } });
    return surcharge;
  }

  async dismissSuggestion(actor: AuthUser, id: string) {
    const updated = await this.prisma.pricingSuggestion.updateMany({
      where: { id, tenantId: actor.tenantId, status: 'PENDING' },
      data: { status: 'DISMISSED', decidedById: actor.userId, decidedAt: new Date() },
    });
    if (!updated.count) throw new ConflictException('Sugestão não encontrada ou já decidida.');
    await this.audit.log({ action: 'pricing.suggestion.dismiss', entityType: 'PricingSuggestion', entityId: id });
  }

  async list(tenantId: string) {
    const since = new Date(Date.now() - 7 * 86_400_000);
    return this.prisma.pricingSurcharge.findMany({ where: { tenantId, endsAt: { gte: since } }, orderBy: [{ startsAt: 'desc' }], take: 200 });
  }

  async create(actor: AuthUser, input: SurchargeInput) {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) throw new BadRequestException('Período inválido.');
    if (endsAt <= new Date()) throw new BadRequestException('O período precisa terminar no futuro.');
    if (endsAt.getTime() - startsAt.getTime() > 7 * 86_400_000) throw new BadRequestException('Um adicional programado dura no máximo 7 dias.');
    const { maxSurchargeBps } = await this.settings.get(actor.tenantId, 'intelligence');
    if (input.surchargeBps <= 0 || input.surchargeBps > maxSurchargeBps) {
      throw new BadRequestException(`O adicional deve ficar entre 0,01% e ${(maxSurchargeBps / 100).toLocaleString('pt-BR')}%.`);
    }
    const surcharge = await this.prisma.pricingSurcharge.create({
      data: {
        tenantId: actor.tenantId,
        city: input.city?.trim() ? cityKey(input.city, input.state) : null,
        startsAt,
        endsAt,
        surchargeBps: input.surchargeBps,
        reason: input.reason.trim(),
        createdById: actor.userId,
      },
    });
    await this.pricing.invalidateSurcharges(actor.tenantId);
    await this.audit.log({ action: 'pricing.surcharge.create', entityType: 'PricingSurcharge', entityId: surcharge.id, after: surcharge as unknown as Record<string, unknown> });
    return surcharge;
  }

  async cancel(actor: AuthUser, id: string) {
    const updated = await this.prisma.pricingSurcharge.updateMany({
      where: { id, tenantId: actor.tenantId, canceledAt: null, endsAt: { gt: new Date() } },
      data: { canceledAt: new Date(), canceledById: actor.userId },
    });
    if (!updated.count) throw new ConflictException('Adicional não encontrado, já encerrado ou cancelado.');
    await this.pricing.invalidateSurcharges(actor.tenantId);
    await this.audit.log({ action: 'pricing.surcharge.cancel', entityType: 'PricingSurcharge', entityId: id });
  }
}
