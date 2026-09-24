import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { applyBps, formatBRL } from '@levoja/shared';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { AuditService, diff } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PricingService, QuoteInput } from '../pricing/pricing.service';
import type { PriceQuote, PriceRule } from '../pricing/pricing.engine';
import { SettingsService } from '../settings/settings.service';
import { DeliveriesService, StopSnapshot } from '../logistics/deliveries.service';
import { lockKey, nextCounter } from '../../common/counters';
import { paginated, PaginationQueryDto, skipOf } from '../../common/pagination';
import { formatLocalDate, parseLocalDate } from '../../common/time-range';
import type { AuthUser } from '../../common/auth/auth-user';
import { Prisma } from '../../generated/prisma/client';
import type { ContractPriceRule, CorporateContract } from '../../generated/prisma/client';
import type { ContractStatus, PaymentMethod } from '../../generated/prisma/enums';

export interface ContractInput {
  title: string;
  startsOn: string;
  endsOn?: string | null;
  billingDay: number;
  paymentTermDays: number;
  creditLimitCents: number;
  minimumMonthlyCents?: number;
  discountBps?: number;
  requireCostCenter?: boolean;
  notifyRecipients?: boolean;
  blockAfterOverdueDays?: number;
  notes?: string | null;
}

export type PriceRuleInput = Omit<Prisma.ContractPriceRuleUncheckedCreateInput, 'id' | 'contractId' | 'createdAt' | 'updatedAt'>;

/** Contrato encerrado: o faturamento emite a fatura final. */
export const CONTRACT_ENDED = 'b2b.contract.ended';

/** Valor cobrado de uma entrega faturada: entregue = taxa + gorjeta; não realizada = taxa; cancelada = nada. */
export const CHARGED_SQL = Prisma.sql`CASE WHEN d.status = 'CANCELED' THEN 0 WHEN d.status = 'FAILED' THEN d."feeCents" ELSE d."feeCents" + d."tipCents" END`;

const toEngineRule = (rule: ContractPriceRule): PriceRule => ({
  ...rule,
  demandSurchargeMaxBps: 0,
  timeWindows: null,
});

/**
 * Contratos corporativos: tabela especial (ou desconto) na cotação, limite de crédito para entregas
 * faturadas, bloqueio por fatura vencida, centros de custo obrigatórios e orçamento por centro de custo.
 */
@Injectable()
export class ContractsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly deliveries: DeliveriesService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit(): void {
    this.deliveries.registerCorporateHook({
      price: (input) => this.price(input),
      validate: (input) => this.validate(input),
      location: (companyId, locationId) => this.locationStop(companyId, locationId),
    });
  }

  // ---------------------------------------------------------------------------
  // Regras aplicadas às entregas
  // ---------------------------------------------------------------------------

  /** Contrato vigente da empresa (ativo e dentro do período). */
  async activeContract(companyId: string, at = new Date(), db: Tx | PrismaService = this.prisma) {
    const contract = await db.corporateContract.findFirst({
      where: { companyId, status: 'ACTIVE' },
      include: { priceRules: { orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] } },
    });
    if (!contract) return null;
    const { timeZone } = await this.settings.get(contract.tenantId, 'operations');
    const today = formatLocalDate(at, timeZone);
    const starts = formatLocalDate(contract.startsOn, 'UTC');
    const ends = contract.endsOn ? formatLocalDate(contract.endsOn, 'UTC') : null;
    if (today < starts || (ends && today > ends)) return null;
    return contract;
  }

  async price(input: { tenantId: string; companyId: string; context: Omit<QuoteInput, 'target' | 'tenantId'> }): Promise<{ fee: PriceQuote; contractId: string } | null> {
    const contract = await this.activeContract(input.companyId);
    if (!contract) return null;
    const quoteInput = { ...input.context, tenantId: input.tenantId };
    const special = await this.pricing.quoteWithRules(quoteInput, contract.priceRules.map(toEngineRule));
    if (special) {
      return { fee: { ...special, lines: special.lines.map((line) => (line.label === 'Valor base' ? { ...line, label: `Valor base (contrato ${contract.number})` } : line)) }, contractId: contract.id };
    }
    if (contract.discountBps > 0) {
      const standard = await this.pricing.quote({ ...quoteInput, target: 'CUSTOMER_FEE' });
      const discount = applyBps(standard.totalCents, contract.discountBps);
      return {
        fee: {
          ...standard,
          totalCents: standard.totalCents - discount,
          lines: [...standard.lines, { label: `Desconto do contrato (${(contract.discountBps / 100).toLocaleString('pt-BR')}%)`, cents: -discount }],
        },
        contractId: contract.id,
      };
    }
    return null;
  }

  /** Em aberto: entregas faturadas não pagas (ainda sem fatura ou em fatura aberta/vencida) + franquias pendentes. */
  async exposure(companyId: string, db: Tx | PrismaService = this.prisma): Promise<number> {
    const [deliveries, minimums] = await Promise.all([
      db.$queryRaw<{ amount: number }[]>`
        SELECT COALESCE(sum(${CHARGED_SQL}), 0)::float8 AS amount
        FROM deliveries d LEFT JOIN invoices i ON i.id = d."invoiceId"
        WHERE d."companyId" = ${companyId}::uuid AND d."paymentMethod" = 'INVOICE' AND d.status <> 'CANCELED'
          AND (d."invoiceId" IS NULL OR i.status IN ('ISSUED', 'OVERDUE'))`,
      db.invoice.aggregate({ where: { companyId, status: { in: ['ISSUED', 'OVERDUE'] } }, _sum: { minimumAdjustmentCents: true } }),
    ]);
    return Math.round(Number(deliveries[0]?.amount ?? 0)) + (minimums._sum.minimumAdjustmentCents ?? 0);
  }

  /** Gasto do centro de custo no mês corrente (fuso da operação). */
  async monthSpend(costCenterId: string, tenantId: string, db: Tx | PrismaService = this.prisma): Promise<number> {
    const { timeZone } = await this.settings.get(tenantId, 'operations');
    const today = formatLocalDate(new Date(), timeZone);
    const monthStart = parseLocalDate(`${today.slice(0, 8)}01`, timeZone);
    const rows = await db.$queryRaw<{ amount: number }[]>`
      SELECT COALESCE(sum(${CHARGED_SQL}), 0)::float8 AS amount FROM deliveries d
      WHERE d."costCenterId" = ${costCenterId}::uuid AND d.status <> 'CANCELED'
        AND d."createdAt" >= (${monthStart.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
    return Math.round(Number(rows[0]?.amount ?? 0));
  }

  /** Faturado: contrato vigente, sem fatura vencida além da tolerância e dentro do limite de crédito. */
  async assertInvoiceAllowed(companyId: string, amountCents: number, db: Tx | PrismaService = this.prisma) {
    const contract = await this.activeContract(companyId, new Date(), db);
    if (!contract) throw new UnprocessableEntityException('Entregas faturadas exigem um contrato corporativo ativo. Fale com o comercial ou pague com a carteira.');
    const blockBefore = new Date(Date.now() - contract.blockAfterOverdueDays * 86_400_000);
    const overdue = await db.invoice.findFirst({ where: { companyId, status: 'OVERDUE', dueAt: { lt: blockBefore } }, select: { number: true } });
    if (overdue) throw new ForbiddenException(`A fatura #${overdue.number} está vencida. Regularize o pagamento para voltar a solicitar entregas faturadas.`);
    const exposure = await this.exposure(companyId, db);
    if (exposure + amountCents > contract.creditLimitCents) {
      const available = Math.max(0, contract.creditLimitCents - exposure);
      throw new UnprocessableEntityException(`Limite de crédito do contrato atingido: disponível ${formatBRL(available)}, necessário ${formatBRL(amountCents)}.`);
    }
    return contract;
  }

  /** Centro de custo ativo da empresa e dentro do orçamento mensal. */
  async assertCostCenter(tenantId: string, companyId: string, costCenterId: string, amountCents: number, db: Tx | PrismaService = this.prisma) {
    const center = await db.costCenter.findFirst({ where: { id: costCenterId, companyId, isActive: true } });
    if (!center) throw new BadRequestException('Centro de custo inválido ou inativo.');
    if (center.monthlyBudgetCents != null) {
      const spent = await this.monthSpend(center.id, tenantId, db);
      if (spent + amountCents > center.monthlyBudgetCents) {
        throw new UnprocessableEntityException(`Orçamento mensal do centro de custo ${center.code} esgotado: disponível ${formatBRL(Math.max(0, center.monthlyBudgetCents - spent))}.`);
      }
    }
    return center;
  }

  async validate(input: { tenantId: string; companyId: string; paymentMethod: PaymentMethod; amountCents: number; costCenterId?: string | null; tx?: Tx }) {
    const db = input.tx ?? this.prisma;
    if (input.tx) await lockKey(input.tx, `b2b:${input.companyId}`);
    const contract = input.paymentMethod === 'INVOICE' ? await this.assertInvoiceAllowed(input.companyId, input.amountCents, db) : await this.activeContract(input.companyId, new Date(), db);
    if (contract?.requireCostCenter && !input.costCenterId) throw new BadRequestException('Informe o centro de custo (exigido pelo contrato).');
    if (input.costCenterId) await this.assertCostCenter(input.tenantId, input.companyId, input.costCenterId, input.amountCents, db);
    return { contractId: contract?.id ?? null, costCenterId: input.costCenterId ?? null };
  }

  async locationStop(companyId: string, locationId: string): Promise<StopSnapshot> {
    const location = await this.prisma.companyLocation.findFirst({ where: { id: locationId, companyId, isActive: true } });
    if (!location) throw new NotFoundException('Local não encontrado entre as unidades da empresa.');
    return {
      name: location.contactName ?? location.name,
      phone: location.contactPhone,
      zipCode: location.zipCode,
      street: location.street,
      number: location.number,
      complement: location.complement,
      district: location.district,
      city: location.city,
      state: location.state,
      reference: location.reference ?? location.name,
      lat: location.lat,
      lng: location.lng,
    };
  }

  // ---------------------------------------------------------------------------
  // Administração (comercial)
  // ---------------------------------------------------------------------------

  private assertInput(input: Partial<ContractInput>) {
    if (input.billingDay != null && (input.billingDay < 1 || input.billingDay > 28)) throw new BadRequestException('Dia de fechamento entre 1 e 28.');
    if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) throw new BadRequestException('O fim do contrato deve ser depois do início.');
  }

  async list(user: AuthUser, query: PaginationQueryDto & { status?: ContractStatus; companyId?: string }) {
    const search = query.search?.trim();
    const where: Prisma.CorporateContractWhereInput = {
      tenantId: user.tenantId,
      status: query.status,
      companyId: query.companyId,
      ...(search ? { OR: [{ title: { contains: search, mode: 'insensitive' } }, { company: { tradeName: { contains: search, mode: 'insensitive' } } }, ...(/^\d+$/.test(search) ? [{ number: Number(search) }] : [])] } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.corporateContract.count({ where }),
      this.prisma.corporateContract.findMany({ where, orderBy: { createdAt: 'desc' }, skip: skipOf(query), take: query.pageSize, include: { company: { select: { id: true, tradeName: true } }, _count: { select: { priceRules: true } } } }),
    ]);
    return paginated(
      rows.map(({ _count, ...contract }) => ({ ...this.view(contract), company: contract.company, priceRules: _count.priceRules })),
      total,
      query,
    );
  }

  view(contract: CorporateContract) {
    return {
      id: contract.id,
      number: contract.number,
      companyId: contract.companyId,
      title: contract.title,
      status: contract.status,
      startsOn: formatLocalDate(contract.startsOn, 'UTC'),
      endsOn: contract.endsOn ? formatLocalDate(contract.endsOn, 'UTC') : null,
      billingDay: contract.billingDay,
      paymentTermDays: contract.paymentTermDays,
      creditLimitCents: contract.creditLimitCents,
      minimumMonthlyCents: contract.minimumMonthlyCents,
      discountBps: contract.discountBps,
      requireCostCenter: contract.requireCostCenter,
      notifyRecipients: contract.notifyRecipients,
      blockAfterOverdueDays: contract.blockAfterOverdueDays,
      notes: contract.notes,
      activatedAt: contract.activatedAt,
      endedAt: contract.endedAt,
      invoicedUntil: contract.invoicedUntil,
      createdAt: contract.createdAt,
    };
  }

  private async find(user: AuthUser, id: string) {
    const contract = await this.prisma.corporateContract.findFirst({ where: { id, tenantId: user.tenantId }, include: { priceRules: { orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] }, company: { select: { id: true, tradeName: true, status: true } } } });
    if (!contract) throw new NotFoundException('Contrato não encontrado.');
    return contract;
  }

  async get(user: AuthUser, id: string) {
    const contract = await this.find(user, id);
    const [exposure, invoices] = await Promise.all([
      this.exposure(contract.companyId),
      this.prisma.invoice.findMany({ where: { contractId: id }, orderBy: { periodStart: 'desc' }, take: 12, select: { id: true, number: true, status: true, periodStart: true, periodEnd: true, totalCents: true, dueAt: true, paidAt: true } }),
    ]);
    return {
      ...this.view(contract),
      company: contract.company,
      priceRules: contract.priceRules,
      exposureCents: exposure,
      availableCreditCents: Math.max(0, contract.creditLimitCents - exposure),
      invoices,
    };
  }

  async create(user: AuthUser, companyId: string, input: ContractInput) {
    this.assertInput(input);
    const company = await this.prisma.company.findFirst({ where: { id: companyId, tenantId: user.tenantId }, select: { id: true } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    const contract = await this.prisma.$transaction(async (tx) => {
      const created = await tx.corporateContract.create({
        data: {
          tenantId: user.tenantId,
          companyId,
          number: await nextCounter(tx, user.tenantId, 'contract'),
          title: input.title.trim(),
          startsOn: new Date(`${input.startsOn}T00:00:00Z`),
          endsOn: input.endsOn ? new Date(`${input.endsOn}T00:00:00Z`) : null,
          billingDay: input.billingDay,
          paymentTermDays: input.paymentTermDays,
          creditLimitCents: input.creditLimitCents,
          minimumMonthlyCents: input.minimumMonthlyCents ?? 0,
          discountBps: input.discountBps ?? 0,
          requireCostCenter: input.requireCostCenter ?? false,
          notifyRecipients: input.notifyRecipients ?? true,
          blockAfterOverdueDays: input.blockAfterOverdueDays ?? 5,
          notes: input.notes?.trim() || null,
          createdById: user.userId,
        },
      });
      await this.audit.log({ action: 'contract.create', entityType: 'CorporateContract', entityId: created.id, after: this.view(created) }, tx);
      return created;
    });
    return this.get(user, contract.id);
  }

  async update(user: AuthUser, id: string, input: Partial<ContractInput>) {
    const contract = await this.find(user, id);
    if (contract.status === 'ENDED') throw new ConflictException('Contrato encerrado não pode ser alterado.');
    this.assertInput({ startsOn: input.startsOn ?? formatLocalDate(contract.startsOn, 'UTC'), endsOn: input.endsOn, billingDay: input.billingDay });
    const updated = await this.prisma.corporateContract.update({
      where: { id },
      data: {
        title: input.title?.trim(),
        // Início e dia de fechamento só mudam antes da ativação (afetam os períodos já faturados).
        ...(contract.status === 'DRAFT' && input.startsOn ? { startsOn: new Date(`${input.startsOn}T00:00:00Z`) } : {}),
        ...(contract.status === 'DRAFT' && input.billingDay != null ? { billingDay: input.billingDay } : {}),
        endsOn: input.endsOn === undefined ? undefined : input.endsOn ? new Date(`${input.endsOn}T00:00:00Z`) : null,
        paymentTermDays: input.paymentTermDays,
        creditLimitCents: input.creditLimitCents,
        minimumMonthlyCents: input.minimumMonthlyCents,
        discountBps: input.discountBps,
        requireCostCenter: input.requireCostCenter,
        notifyRecipients: input.notifyRecipients,
        blockAfterOverdueDays: input.blockAfterOverdueDays,
        notes: input.notes === undefined ? undefined : input.notes?.trim() || null,
      },
    });
    await this.audit.log({ action: 'contract.update', entityType: 'CorporateContract', entityId: id, ...diff(this.view(contract), this.view(updated)) });
    return this.get(user, id);
  }

  async setStatus(user: AuthUser, id: string, action: 'activate' | 'suspend' | 'resume' | 'end', reason?: string) {
    const contract = await this.find(user, id);
    const transitions: Record<typeof action, { from: ContractStatus[]; to: ContractStatus }> = {
      activate: { from: ['DRAFT'], to: 'ACTIVE' },
      suspend: { from: ['ACTIVE'], to: 'SUSPENDED' },
      resume: { from: ['SUSPENDED'], to: 'ACTIVE' },
      end: { from: ['DRAFT', 'ACTIVE', 'SUSPENDED'], to: 'ENDED' },
    };
    const rule = transitions[action];
    if (!rule.from.includes(contract.status)) throw new ConflictException(`Não é possível ${action === 'activate' ? 'ativar' : action === 'suspend' ? 'suspender' : action === 'resume' ? 'reativar' : 'encerrar'} um contrato ${contract.status.toLowerCase()}.`);
    if ((action === 'suspend' || action === 'end') && !reason?.trim()) throw new BadRequestException('Informe o motivo.');
    if (rule.to === 'ACTIVE') {
      if (contract.company.status !== 'APPROVED') throw new ConflictException('A empresa precisa estar aprovada.');
      const other = await this.prisma.corporateContract.findFirst({ where: { companyId: contract.companyId, status: { in: ['ACTIVE', 'SUSPENDED'] }, id: { not: id } }, select: { number: true } });
      if (other) throw new ConflictException(`A empresa já tem o contrato #${other.number} em vigor. Encerre-o antes.`);
    }
    await this.prisma.corporateContract.update({
      where: { id },
      data: {
        status: rule.to,
        ...(action === 'activate' ? { activatedAt: new Date(), activatedById: user.userId } : {}),
        ...(action === 'end' ? { endedAt: new Date() } : {}),
      },
    });
    await this.audit.log({ action: `contract.${action}`, entityType: 'CorporateContract', entityId: id, before: { status: contract.status }, after: { status: rule.to, reason } });
    if (action === 'end') this.events.emit(CONTRACT_ENDED, { contractId: id });
    await this.notifyCompany(contract.companyId, `Contrato #${contract.number}: ${{ activate: 'ativado', suspend: 'suspenso', resume: 'reativado', end: 'encerrado' }[action]}`, reason ?? (action === 'activate' ? 'Entregas faturadas, tabela especial e centros de custo já estão disponíveis no portal.' : 'Confira os detalhes no portal.'));
    return this.get(user, id);
  }

  private async notifyCompany(companyId: string, title: string, body: string) {
    const members = await this.prisma.companyUser.findMany({
      where: { companyId, isActive: true, role: { permissions: { some: { permission: { key: { in: ['company.finance.read', 'company.b2b.manage'] } } } } } },
      select: { userId: true },
    });
    await this.notifications.notifyMany(members.map((member) => member.userId), { type: 'b2b.contract', title, body, data: { companyId }, channels: ['inapp', 'email'] });
  }

  // --- Tabela especial ---

  async addRule(user: AuthUser, contractId: string, input: PriceRuleInput) {
    const contract = await this.find(user, contractId);
    if (contract.status === 'ENDED') throw new ConflictException('Contrato encerrado.');
    const rule = await this.prisma.contractPriceRule.create({ data: { ...input, contractId } });
    await this.audit.log({ action: 'contract.rule.create', entityType: 'ContractPriceRule', entityId: rule.id, after: rule as unknown as Record<string, unknown> });
    return rule;
  }

  async updateRule(user: AuthUser, contractId: string, ruleId: string, input: Partial<PriceRuleInput>) {
    await this.find(user, contractId);
    const rule = await this.prisma.contractPriceRule.findFirst({ where: { id: ruleId, contractId } });
    if (!rule) throw new NotFoundException('Regra não encontrada.');
    const updated = await this.prisma.contractPriceRule.update({ where: { id: ruleId }, data: input });
    await this.audit.log({ action: 'contract.rule.update', entityType: 'ContractPriceRule', entityId: ruleId, ...diff(rule, updated) });
    return updated;
  }

  async deleteRule(user: AuthUser, contractId: string, ruleId: string) {
    await this.find(user, contractId);
    const deleted = await this.prisma.contractPriceRule.deleteMany({ where: { id: ruleId, contractId } });
    if (!deleted.count) throw new NotFoundException('Regra não encontrada.');
    await this.audit.log({ action: 'contract.rule.delete', entityType: 'ContractPriceRule', entityId: ruleId });
  }

  /** Simulação para o comercial: preço do contrato x tabela padrão para a mesma entrega. */
  async simulate(user: AuthUser, contractId: string, input: { distanceKm: number; durationMin?: number; weightKg?: number; vehicleType?: string; city?: string; state?: string }) {
    const contract = await this.find(user, contractId);
    const quoteInput = {
      tenantId: user.tenantId,
      distanceKm: input.distanceKm,
      durationMin: input.durationMin ?? Math.round((input.distanceKm / 22) * 60),
      weightKg: input.weightKg,
      vehicleType: input.vehicleType as never,
      city: input.city,
      state: input.state,
    };
    const standard = await this.pricing.quote({ ...quoteInput, target: 'CUSTOMER_FEE' }).catch(() => null);
    const special = await this.pricing.quoteWithRules(quoteInput, contract.priceRules.map(toEngineRule));
    const contracted = special ?? (standard && contract.discountBps ? { ...standard, totalCents: standard.totalCents - applyBps(standard.totalCents, contract.discountBps) } : standard);
    return {
      standardCents: standard?.totalCents ?? null,
      contractCents: contracted?.totalCents ?? null,
      source: special ? 'SPECIAL_TABLE' : contract.discountBps ? 'DISCOUNT' : 'STANDARD',
      rule: special?.ruleName ?? null,
      lines: (special ?? standard)?.lines ?? [],
    };
  }

  async companyTenant(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { tenantId: true } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    return company.tenantId;
  }

  /** Resumo para o portal da empresa. */
  async companyOverview(companyId: string) {
    const contract = await this.activeContract(companyId);
    const pending = contract ? null : await this.prisma.corporateContract.findFirst({ where: { companyId, status: { in: ['SUSPENDED', 'DRAFT'] } }, orderBy: { createdAt: 'desc' } });
    const [exposure, openInvoices, overdue] = await Promise.all([
      this.exposure(companyId),
      this.prisma.invoice.count({ where: { companyId, status: { in: ['ISSUED', 'OVERDUE'] } } }),
      this.prisma.invoice.count({ where: { companyId, status: 'OVERDUE' } }),
    ]);
    return {
      contract: contract
        ? {
            ...this.view(contract),
            priceRules: contract.priceRules.map((rule) => ({ name: rule.name, vehicleType: rule.vehicleType, city: rule.city, baseCents: rule.baseCents, perKmCents: rule.perKmCents, includedKm: rule.includedKm, minimumCents: rule.minimumCents })),
          }
        : null,
      contractStatus: contract ? 'ACTIVE' : (pending?.status ?? null),
      exposureCents: exposure,
      availableCreditCents: contract ? Math.max(0, contract.creditLimitCents - exposure) : 0,
      openInvoices,
      overdueInvoices: overdue,
      canInvoice: !!contract,
    };
  }
}
