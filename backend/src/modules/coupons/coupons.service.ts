import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { applyBps } from '@levoja/shared';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { AuditService, diff } from '../audit/audit.service';
import { localWeekMinute } from '../../common/opening-hours';
import { paginated, PaginationQueryDto, skipOf } from '../../common/pagination';
import type { Coupon } from '../../generated/prisma/client';
import type { CouponFunding, CouponType } from '../../generated/prisma/enums';

export interface CouponInput {
  code: string;
  description?: string;
  type: CouponType;
  percentBps?: number;
  amountCents?: number;
  maxDiscountCents?: number;
  minOrderCents?: number;
  segmentId?: string | null;
  firstOrderOnly?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  weekdays?: number[];
  fromTime?: string | null;
  toTime?: string | null;
  maxRedemptions?: number | null;
  maxPerCustomer?: number;
  isActive?: boolean;
  visibility?: 'CODE' | 'PUBLIC' | 'TIER';
  minTier?: string | null;
}

export interface CouponContext {
  tenantId: string;
  customerId: string;
  companyId: string;
  segmentId: string;
  subtotalCents: number;
  deliveryFeeCents: number;
  at: Date;
  timeZone: string;
  /** Endereço de entrega (regras antifraude de cupom de primeira compra). */
  dropoff?: { zipCode?: string | null; street?: string | null; number?: string | null } | null;
}

/** Regra extra de elegibilidade (ex.: antifraude). Retorna o motivo da recusa ou null. */
export type CouponEligibility = (coupon: Coupon, context: CouponContext) => Promise<string | null>;

export type CouponEvaluation =
  | { ok: true; coupon: Coupon; discountCents: number; freeDelivery: boolean }
  | { ok: false; reason: string };

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

@Injectable()
export class CouponsService {
  private readonly eligibility: CouponEligibility[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  registerEligibility(check: CouponEligibility): void {
    this.eligibility.push(check);
  }

  normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  /** Aplica as regras do cupom ao contexto do pedido (sem efeitos colaterais). */
  async evaluate(code: string, context: CouponContext, tx: Tx = this.prisma): Promise<CouponEvaluation> {
    const coupon = await tx.coupon.findUnique({ where: { tenantId_code: { tenantId: context.tenantId, code: this.normalizeCode(code) } } });
    if (!coupon || !coupon.isActive) return { ok: false, reason: 'Cupom inválido.' };
    if (coupon.startsAt && coupon.startsAt > context.at) return { ok: false, reason: 'Este cupom ainda não está válido.' };
    if (coupon.endsAt && coupon.endsAt <= context.at) return { ok: false, reason: 'Cupom expirado.' };
    if (coupon.companyId && coupon.companyId !== context.companyId) return { ok: false, reason: 'Cupom não válido para esta loja.' };
    if (coupon.segmentId && coupon.segmentId !== context.segmentId) return { ok: false, reason: 'Cupom não válido para esta categoria.' };
    if (context.subtotalCents < coupon.minOrderCents) {
      return { ok: false, reason: `Cupom válido para pedidos a partir de R$ ${(coupon.minOrderCents / 100).toFixed(2).replace('.', ',')}.` };
    }
    const { weekday, minute } = localWeekMinute(context.at, context.timeZone);
    if (coupon.weekdays.length && !coupon.weekdays.includes(weekday)) return { ok: false, reason: 'Cupom não válido hoje.' };
    if (coupon.fromTime && coupon.toTime) {
      const from = toMinutes(coupon.fromTime);
      const to = toMinutes(coupon.toTime);
      const inside = from <= to ? minute >= from && minute < to : minute >= from || minute < to;
      if (!inside) return { ok: false, reason: `Cupom válido das ${coupon.fromTime} às ${coupon.toTime}.` };
    }
    if (coupon.maxRedemptions != null && coupon.redemptions >= coupon.maxRedemptions) return { ok: false, reason: 'Cupom esgotado.' };
    const used = await tx.couponRedemption.count({ where: { couponId: coupon.id, customerId: context.customerId } });
    if (used >= coupon.maxPerCustomer) return { ok: false, reason: 'Você já usou este cupom.' };
    if (coupon.firstOrderOnly) {
      const previous = await tx.order.count({ where: { customerId: context.customerId, status: { not: 'CANCELED' } } });
      if (previous > 0) return { ok: false, reason: 'Cupom válido apenas na primeira compra.' };
    }
    for (const check of this.eligibility) {
      const reason = await check(coupon, context);
      if (reason) return { ok: false, reason };
    }

    let discountCents = 0;
    if (coupon.type === 'PERCENT') discountCents = applyBps(context.subtotalCents, coupon.percentBps ?? 0);
    if (coupon.type === 'FIXED') discountCents = coupon.amountCents ?? 0;
    if (coupon.type === 'FREE_DELIVERY') discountCents = context.deliveryFeeCents;
    if (coupon.maxDiscountCents != null) discountCents = Math.min(discountCents, coupon.maxDiscountCents);
    const cap = coupon.type === 'FREE_DELIVERY' ? context.deliveryFeeCents : context.subtotalCents;
    discountCents = Math.max(0, Math.min(discountCents, cap));
    if (discountCents === 0) return { ok: false, reason: coupon.type === 'FREE_DELIVERY' ? 'Este pedido já não tem taxa de entrega.' : 'Cupom sem desconto aplicável.' };
    return { ok: true, coupon, discountCents, freeDelivery: coupon.type === 'FREE_DELIVERY' };
  }

  /** Registra o uso no checkout (dentro da transação do pedido), com proteção contra esgotamento concorrente. */
  async redeem(tx: Tx, coupon: Coupon, customerId: string, orderId: string, discountCents: number) {
    const updated = await tx.coupon.updateMany({
      where: { id: coupon.id, ...(coupon.maxRedemptions != null ? { redemptions: { lt: coupon.maxRedemptions } } : {}) },
      data: { redemptions: { increment: 1 } },
    });
    if (updated.count === 0) throw new ConflictException('Cupom esgotado.');
    await tx.couponRedemption.create({ data: { couponId: coupon.id, customerId, orderId, discountCents } });
  }

  /** Pedido cancelado devolve o cupom ao cliente. */
  async release(orderId: string) {
    const redemption = await this.prisma.couponRedemption.findUnique({ where: { orderId } });
    if (!redemption) return;
    await this.prisma.$transaction([
      this.prisma.couponRedemption.delete({ where: { id: redemption.id } }),
      this.prisma.coupon.update({ where: { id: redemption.couponId }, data: { redemptions: { decrement: 1 } } }),
    ]);
  }

  // --- Administração (plataforma e empresas) ---

  async list(tenantId: string, query: PaginationQueryDto, companyId?: string | null) {
    const where = { tenantId, ...(companyId !== undefined ? { companyId } : {}), ...(query.search ? { code: { contains: query.search.toUpperCase() } } : {}) };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.coupon.count({ where }),
      this.prisma.coupon.findMany({ where, orderBy: { createdAt: 'desc' }, skip: skipOf(query), take: query.pageSize }),
    ]);
    const companies = await this.prisma.company.findMany({
      where: { id: { in: rows.map((row) => row.companyId).filter((id): id is string => !!id) } },
      select: { id: true, tradeName: true },
    });
    const companyName = new Map(companies.map((company) => [company.id, company.tradeName]));
    return paginated(
      rows.map((row) => ({ ...row, companyName: row.companyId ? (companyName.get(row.companyId) ?? null) : null })),
      total,
      query,
    );
  }

  private validate(input: CouponInput) {
    if (input.type === 'PERCENT' && !(input.percentBps && input.percentBps > 0 && input.percentBps <= 10_000)) {
      throw new BadRequestException('Informe o percentual (1 a 100%).');
    }
    if (input.type === 'FIXED' && !(input.amountCents && input.amountCents > 0)) throw new BadRequestException('Informe o valor do desconto.');
    if ((input.fromTime && !input.toTime) || (!input.fromTime && input.toTime)) throw new BadRequestException('Informe início e fim da janela de horário.');
    if (input.startsAt && input.endsAt && new Date(input.endsAt) <= new Date(input.startsAt)) throw new BadRequestException('O fim deve ser depois do início.');
    if (input.visibility === 'TIER' && !input.minTier) throw new BadRequestException('Informe o nível de fidelidade mínimo do cupom exclusivo.');
  }

  async create(tenantId: string, input: CouponInput, owner: { companyId?: string; fundedBy: CouponFunding }) {
    this.validate(input);
    const code = this.normalizeCode(input.code);
    if (await this.prisma.coupon.findUnique({ where: { tenantId_code: { tenantId, code } } })) throw new ConflictException('Já existe um cupom com este código.');
    const coupon = await this.prisma.coupon.create({
      data: {
        tenantId,
        ...input,
        code,
        weekdays: input.weekdays ?? [],
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        companyId: owner.companyId ?? null,
        fundedBy: owner.fundedBy,
        minTier: input.visibility === 'TIER' ? input.minTier : null,
      },
    });
    await this.audit.log({ action: 'coupon.create', entityType: 'Coupon', entityId: coupon.id, after: { code, type: input.type, fundedBy: owner.fundedBy } });
    return coupon;
  }

  async update(tenantId: string, id: string, input: Partial<CouponInput>, companyId?: string) {
    const coupon = await this.prisma.coupon.findFirst({ where: { id, tenantId, ...(companyId ? { companyId } : {}) } });
    if (!coupon) throw new NotFoundException('Cupom não encontrado.');
    this.validate({ ...coupon, ...input } as CouponInput);
    const { code: _code, ...rest } = input;
    const updated = await this.prisma.coupon.update({
      where: { id },
      data: {
        ...rest,
        startsAt: input.startsAt === undefined ? undefined : input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt === undefined ? undefined : input.endsAt ? new Date(input.endsAt) : null,
        ...(input.visibility && input.visibility !== 'TIER' ? { minTier: null } : {}),
      },
    });
    await this.audit.log({ action: 'coupon.update', entityType: 'Coupon', entityId: id, ...diff(coupon, updated) });
    return updated;
  }
}
