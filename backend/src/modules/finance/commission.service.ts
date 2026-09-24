import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { applyBps } from '@levoja/shared';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { AuditService, diff } from '../audit/audit.service';
import type { CommissionRule } from '../../generated/prisma/client';

export interface CommissionRuleInput {
  name: string;
  companyId?: string | null;
  segmentId?: string | null;
  percentBps: number;
  fixedCents?: number;
  priority?: number;
  isActive?: boolean;
  validFrom?: string | null;
  validTo?: string | null;
}

/** Comissão padrão quando nenhuma regra está cadastrada (12%). */
export const DEFAULT_COMMISSION_BPS = 1200;

/**
 * Comissionamento da plataforma sobre as vendas das empresas.
 * Seleção: regra ativa e vigente mais específica (empresa > segmento > padrão); empate → maior prioridade.
 */
@Injectable()
export class CommissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async resolve(tenantId: string, company: { id: string; segmentId: string }, at = new Date(), tx: Tx = this.prisma): Promise<CommissionRule | null> {
    const rules = await tx.commissionRule.findMany({
      where: {
        tenantId,
        isActive: true,
        AND: [
          { OR: [{ companyId: null }, { companyId: company.id }] },
          { OR: [{ segmentId: null }, { segmentId: company.segmentId }] },
          { OR: [{ validFrom: null }, { validFrom: { lte: at } }] },
          { OR: [{ validTo: null }, { validTo: { gt: at } }] },
        ],
      },
    });
    const specificity = (rule: CommissionRule) => (rule.companyId ? 2 : 0) + (rule.segmentId ? 1 : 0);
    return rules.sort((a, b) => specificity(b) - specificity(a) || b.priority - a.priority)[0] ?? null;
  }

  /** Comissão sobre a base (subtotal dos produtos, já descontado o cupom financiado pela loja). */
  async calculate(tenantId: string, company: { id: string; segmentId: string }, baseCents: number, tx: Tx = this.prisma) {
    const rule = await this.resolve(tenantId, company, new Date(), tx);
    const percentBps = rule?.percentBps ?? DEFAULT_COMMISSION_BPS;
    const fixedCents = rule?.fixedCents ?? 0;
    const amountCents = Math.min(Math.max(0, baseCents), applyBps(Math.max(0, baseCents), percentBps) + fixedCents);
    return { amountCents, percentBps, fixedCents, ruleId: rule?.id ?? null, ruleName: rule?.name ?? 'Padrão da plataforma' };
  }

  async list(tenantId: string) {
    const rules = await this.prisma.commissionRule.findMany({ where: { tenantId }, orderBy: [{ isActive: 'desc' }, { priority: 'desc' }, { createdAt: 'asc' }] });
    const [companies, segments] = await Promise.all([
      this.prisma.company.findMany({ where: { id: { in: rules.map((rule) => rule.companyId).filter((id): id is string => !!id) } }, select: { id: true, tradeName: true } }),
      this.prisma.segment.findMany({ where: { id: { in: rules.map((rule) => rule.segmentId).filter((id): id is string => !!id) } }, select: { id: true, name: true } }),
    ]);
    const companyName = new Map(companies.map((company) => [company.id, company.tradeName]));
    const segmentName = new Map(segments.map((segment) => [segment.id, segment.name]));
    return rules.map((rule) => ({
      ...rule,
      companyName: rule.companyId ? (companyName.get(rule.companyId) ?? null) : null,
      segmentName: rule.segmentId ? (segmentName.get(rule.segmentId) ?? null) : null,
    }));
  }

  private validate(input: Partial<CommissionRuleInput>) {
    if (input.percentBps != null && (input.percentBps < 0 || input.percentBps > 5_000)) throw new BadRequestException('Comissão deve estar entre 0% e 50%.');
    if (input.fixedCents != null && (input.fixedCents < 0 || input.fixedCents > 100_000)) throw new BadRequestException('Valor fixo inválido.');
    if (input.validFrom && input.validTo && new Date(input.validTo) <= new Date(input.validFrom)) throw new BadRequestException('O fim da vigência deve ser depois do início.');
  }

  private async assertRefs(tenantId: string, input: Partial<CommissionRuleInput>) {
    if (input.companyId && !(await this.prisma.company.findFirst({ where: { id: input.companyId, tenantId }, select: { id: true } }))) {
      throw new BadRequestException('Empresa não encontrada.');
    }
    if (input.segmentId && !(await this.prisma.segment.findFirst({ where: { id: input.segmentId, tenantId }, select: { id: true } }))) {
      throw new BadRequestException('Segmento não encontrado.');
    }
  }

  async create(tenantId: string, input: CommissionRuleInput) {
    this.validate(input);
    await this.assertRefs(tenantId, input);
    const rule = await this.prisma.commissionRule.create({
      data: {
        tenantId,
        ...input,
        validFrom: input.validFrom ? new Date(input.validFrom) : null,
        validTo: input.validTo ? new Date(input.validTo) : null,
      },
    });
    await this.audit.log({ action: 'commission_rule.create', entityType: 'CommissionRule', entityId: rule.id, after: { ...input } });
    return rule;
  }

  async update(tenantId: string, id: string, input: Partial<CommissionRuleInput>) {
    const rule = await this.prisma.commissionRule.findFirst({ where: { id, tenantId } });
    if (!rule) throw new NotFoundException('Regra não encontrada.');
    this.validate({ ...input, validFrom: input.validFrom ?? rule.validFrom?.toISOString(), validTo: input.validTo ?? rule.validTo?.toISOString() });
    await this.assertRefs(tenantId, input);
    const updated = await this.prisma.commissionRule.update({
      where: { id },
      data: {
        ...input,
        validFrom: input.validFrom === undefined ? undefined : input.validFrom ? new Date(input.validFrom) : null,
        validTo: input.validTo === undefined ? undefined : input.validTo ? new Date(input.validTo) : null,
      },
    });
    await this.audit.log({ action: 'commission_rule.update', entityType: 'CommissionRule', entityId: id, ...diff(rule, updated) });
    return updated;
  }

  /** Regras são desativadas, nunca apagadas (histórico de liquidações). */
  async deactivate(tenantId: string, id: string) {
    return this.update(tenantId, id, { isActive: false });
  }
}
