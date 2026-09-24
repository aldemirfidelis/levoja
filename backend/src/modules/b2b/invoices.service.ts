import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { formatBRL } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LedgerService } from '../finance/ledger.service';
import { INVOICE_PAYMENT_CONFIRMED, InvoicePaymentConfirmedEvent, PaymentsService } from '../finance/payments.service';
import { lockKey, nextCounter } from '../../common/counters';
import { paginated, PaginationQueryDto, skipOf } from '../../common/pagination';
import { formatLocalDate, parseLocalDate } from '../../common/time-range';
import type { AuthUser } from '../../common/auth/auth-user';
import { Prisma } from '../../generated/prisma/client';
import type { CorporateContract, Invoice } from '../../generated/prisma/client';
import type { InvoiceStatus } from '../../generated/prisma/enums';
import { CHARGED_SQL, CONTRACT_ENDED, ContractsService } from './contracts.service';

const DAY_MS = 86_400_000;

/**
 * Faturamento mensal dos contratos: fecha o período no dia de fechamento, agrega as entregas faturadas
 * concluídas (entregues = taxa + gorjeta; não realizadas = taxa), aplica a franquia mínima, emite a
 * fatura com vencimento e acompanha pagamento (PIX ou baixa manual), atraso e cancelamento.
 */
@Injectable()
export class InvoicesService implements OnModuleInit {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
    private readonly contracts: ContractsService,
  ) {}

  onModuleInit(): void {
    // A quitação avulsa de saldo não cobra o que será cobrado na fatura.
    this.payments.registerDebtExclusion(async (owner) => (owner.type === 'COMPANY' ? this.contracts.exposure(owner.companyId) : 0));
  }

  // ---------------------------------------------------------------------------
  // Períodos
  // ---------------------------------------------------------------------------

  /** Último fechamento (meia-noite local do dia de fechamento) igual ou anterior a hoje. */
  lastClosing(billingDay: number, timeZone: string, now = new Date()): Date {
    const today = formatLocalDate(now, timeZone);
    const [year, month, day] = today.split('-').map(Number);
    const target = day >= billingDay ? new Date(Date.UTC(year, month - 1, billingDay)) : new Date(Date.UTC(year, month - 2, billingDay));
    return parseLocalDate(target.toISOString().slice(0, 10), timeZone);
  }

  private async periodStart(contract: CorporateContract): Promise<Date> {
    if (contract.invoicedUntil) return contract.invoicedUntil;
    const { timeZone } = await this.settings.get(contract.tenantId, 'operations');
    return parseLocalDate(formatLocalDate(contract.startsOn, 'UTC'), timeZone);
  }

  /** Fecha os contratos cujo período terminou (recupera fechamentos perdidos se o servidor ficou fora). */
  @Cron('0 15 3 * * *')
  async closeDuePeriods(now = new Date()): Promise<number> {
    const contracts = await this.prisma.corporateContract.findMany({ where: { status: { in: ['ACTIVE', 'SUSPENDED'] } } });
    let issued = 0;
    for (const contract of contracts) {
      try {
        const { timeZone } = await this.settings.get(contract.tenantId, 'operations');
        const closing = this.lastClosing(contract.billingDay, timeZone, now);
        const start = await this.periodStart(contract);
        if (closing.getTime() > start.getTime()) {
          if (await this.generate(contract.id, closing, null)) issued += 1;
        }
      } catch (error) {
        this.logger.error(`Fechamento do contrato ${contract.id} falhou: ${(error as Error).message}`);
      }
    }
    return issued;
  }

  /** Contrato encerrado: fatura final com o que estiver em aberto até agora. */
  @OnEvent(CONTRACT_ENDED, { async: true, promisify: true })
  async onContractEnded(event: { contractId: string }) {
    await this.generate(event.contractId, new Date(), null).catch((error) => this.logger.error(`Fatura final do contrato ${event.contractId}: ${(error as Error).message}`));
  }

  /**
   * Emite a fatura do período [início, fim). Idempotente: o período só é faturado uma vez. Sem
   * entregas nem franquia, apenas avança o início do próximo período. Retorna a fatura (ou null).
   */
  async generate(contractId: string, periodEnd: Date, actor: AuthUser | null): Promise<Invoice | null> {
    const result = await this.prisma.$transaction(
      async (tx) => {
        await lockKey(tx, `invoice:${contractId}`);
        const contract = await tx.corporateContract.findUniqueOrThrow({ where: { id: contractId } });
        // Contrato que nunca vigorou não tem o que faturar.
        if (!contract.activatedAt) return null;
        const periodStart = await this.periodStart(contract);
        if (periodEnd.getTime() <= periodStart.getTime()) return null;
        // Entregas faturadas anteriores aos contratos (sem contrato) entram na fatura do contrato vigente.
        const current = contract.status === 'ACTIVE' || contract.status === 'SUSPENDED';
        const end = Prisma.sql`(${periodEnd.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
        const rows = await tx.$queryRaw<{ id: string; charged: number; cost_center_id: string | null }[]>`
          SELECT d.id, (${CHARGED_SQL})::int AS charged, d."costCenterId" AS cost_center_id
          FROM deliveries d
          WHERE d."companyId" = ${contract.companyId}::uuid AND d."paymentMethod" = 'INVOICE' AND d."invoiceId" IS NULL
            AND (d."contractId" = ${contractId}::uuid ${current ? Prisma.sql`OR d."contractId" IS NULL` : Prisma.empty})
            AND d.status IN ('DELIVERED', 'FAILED')
            AND COALESCE(d."deliveredAt", d."failedAt") < ${end}`;
        const deliveriesCents = rows.reduce((sum, row) => sum + Number(row.charged), 0);
        // Franquia mínima: aplicada em períodos completos (≥ 28 dias).
        const fullPeriod = periodEnd.getTime() - periodStart.getTime() >= 28 * DAY_MS;
        const minimumAdjustmentCents = fullPeriod && contract.minimumMonthlyCents > deliveriesCents ? contract.minimumMonthlyCents - deliveriesCents : 0;
        await tx.corporateContract.update({ where: { id: contractId }, data: { invoicedUntil: periodEnd } });
        if (!rows.length && !minimumAdjustmentCents) return null;

        const centers = await tx.costCenter.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.cost_center_id).filter((id): id is string => !!id))] } } });
        const centerOf = new Map(centers.map((center) => [center.id, center]));
        const groups = new Map<string, { costCenterId: string | null; code: string | null; name: string; deliveries: number; amountCents: number }>();
        for (const row of rows) {
          const key = row.cost_center_id ?? 'none';
          const center = row.cost_center_id ? centerOf.get(row.cost_center_id) : undefined;
          const group = groups.get(key) ?? { costCenterId: row.cost_center_id, code: center?.code ?? null, name: center?.name ?? 'Sem centro de custo', deliveries: 0, amountCents: 0 };
          group.deliveries += 1;
          group.amountCents += Number(row.charged);
          groups.set(key, group);
        }
        const issuedAt = new Date();
        const invoice = await tx.invoice.create({
          data: {
            tenantId: contract.tenantId,
            companyId: contract.companyId,
            contractId,
            number: await nextCounter(tx, contract.tenantId, 'invoice'),
            periodStart,
            periodEnd,
            deliveriesCount: rows.length,
            deliveriesCents,
            minimumAdjustmentCents,
            totalCents: deliveriesCents + minimumAdjustmentCents,
            byCostCenter: [...groups.values()] as unknown as Prisma.InputJsonValue,
            issuedAt,
            dueAt: new Date(issuedAt.getTime() + contract.paymentTermDays * DAY_MS),
          },
        });
        if (rows.length) await tx.delivery.updateMany({ where: { id: { in: rows.map((row) => row.id) }, invoiceId: null }, data: { invoiceId: invoice.id } });
        if (minimumAdjustmentCents) {
          await this.ledger.post(tx, contract.tenantId, [
            { owner: { type: 'COMPANY', companyId: contract.companyId }, type: 'FEE', amountCents: -minimumAdjustmentCents, description: `Fatura #${invoice.number} — complemento da franquia mínima`, referenceKey: `invoice:${invoice.id}:minimum` },
            { owner: { type: 'PLATFORM' }, type: 'FEE', amountCents: minimumAdjustmentCents, description: `Fatura #${invoice.number} — franquia mínima`, referenceKey: `invoice:${invoice.id}:minimum-platform` },
          ]);
        }
        await this.audit.log({ action: 'invoice.issue', entityType: 'Invoice', entityId: invoice.id, actorId: actor?.userId ?? null, tenantId: contract.tenantId, after: { number: invoice.number, totalCents: invoice.totalCents, deliveries: rows.length } }, tx);
        return invoice;
      },
      { timeout: 120_000 },
    );
    if (result) {
      await this.notifyCompany(result.companyId, `Fatura #${result.number} emitida`, `Total ${formatBRL(result.totalCents)} (${result.deliveriesCount} entrega(s)), vencimento em ${result.dueAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`, result.id);
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Pagamento, atraso e cancelamento
  // ---------------------------------------------------------------------------

  private async findForCompany(companyId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, companyId } });
    if (!invoice) throw new NotFoundException('Fatura não encontrada.');
    return invoice;
  }

  private async findForStaff(user: AuthUser, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, tenantId: user.tenantId } });
    if (!invoice) throw new NotFoundException('Fatura não encontrada.');
    return invoice;
  }

  async pay(user: AuthUser, companyId: string, invoiceId: string) {
    const invoice = await this.findForCompany(companyId, invoiceId);
    if (!['ISSUED', 'OVERDUE'].includes(invoice.status)) throw new ConflictException('Esta fatura não está em aberto.');
    return this.payments.createInvoicePayment(user, { companyId, invoiceId, amountCents: invoice.totalCents, number: invoice.number });
  }

  private async settle(invoiceId: string, reference: string | null): Promise<boolean> {
    const updated = await this.prisma.invoice.updateMany({ where: { id: invoiceId, status: { in: ['ISSUED', 'OVERDUE'] } }, data: { status: 'PAID', paidAt: new Date(), paidReference: reference } });
    return updated.count > 0;
  }

  @OnEvent(INVOICE_PAYMENT_CONFIRMED, { async: true, promisify: true })
  async onPaymentConfirmed(event: InvoicePaymentConfirmedEvent) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: event.invoiceId } });
    if (!invoice) return;
    if (await this.settle(invoice.id, `PIX ${event.paymentId}`)) {
      await this.audit.log({ action: 'invoice.paid', entityType: 'Invoice', entityId: invoice.id, actorId: null, tenantId: invoice.tenantId, after: { paymentId: event.paymentId, amountCents: event.amountCents } });
      await this.notifyCompany(invoice.companyId, `Fatura #${invoice.number} paga`, `Recebemos ${formatBRL(event.amountCents)}. Obrigado!`, invoice.id);
    }
  }

  /** Baixa manual pelo financeiro (transferência, boleto de outro banco...). */
  async markPaid(user: AuthUser, invoiceId: string, reference: string) {
    const invoice = await this.findForStaff(user, invoiceId);
    if (!['ISSUED', 'OVERDUE'].includes(invoice.status)) throw new ConflictException('Esta fatura não está em aberto.');
    if (!reference.trim()) throw new BadRequestException('Informe a referência do pagamento (ex.: comprovante, TED).');
    const pending = await this.prisma.payment.findFirst({ where: { invoiceId, purpose: 'INVOICE', status: 'PAID' } });
    if (pending) throw new ConflictException('Já existe um pagamento confirmado para esta fatura.');
    await this.payments.recordInvoicePayment(user, { companyId: invoice.companyId, invoiceId, amountCents: invoice.totalCents, number: invoice.number, reference: reference.trim() });
    await this.settle(invoiceId, reference.trim());
    await this.audit.log({ action: 'invoice.mark_paid', entityType: 'Invoice', entityId: invoiceId, before: { status: invoice.status }, after: { status: 'PAID', reference } });
    await this.notifyCompany(invoice.companyId, `Fatura #${invoice.number} paga`, `Pagamento de ${formatBRL(invoice.totalCents)} confirmado pelo financeiro.`, invoiceId);
    return this.staffView(user, invoiceId);
  }

  /** Cancela a fatura: as entregas voltam para o próximo fechamento e a franquia é estornada. */
  async cancel(user: AuthUser, invoiceId: string, reason: string) {
    const invoice = await this.findForStaff(user, invoiceId);
    if (!['ISSUED', 'OVERDUE'].includes(invoice.status)) throw new ConflictException('Somente faturas em aberto podem ser canceladas.');
    const paid = await this.prisma.payment.count({ where: { invoiceId, status: 'PAID' } });
    if (paid) throw new ConflictException('A fatura tem pagamento confirmado. Use um ajuste financeiro.');
    await this.prisma.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELED', canceledAt: new Date(), cancelReason: reason } });
      await tx.delivery.updateMany({ where: { invoiceId }, data: { invoiceId: null } });
      // O período volta a ficar aberto a partir do início desta fatura.
      await tx.corporateContract.update({ where: { id: invoice.contractId }, data: { invoicedUntil: invoice.periodStart } });
      await tx.payment.updateMany({ where: { invoiceId, status: 'PENDING' }, data: { status: 'CANCELED', canceledAt: new Date() } });
      if (invoice.minimumAdjustmentCents) {
        await this.ledger.post(tx, invoice.tenantId, [
          { owner: { type: 'COMPANY', companyId: invoice.companyId }, type: 'ADJUSTMENT', amountCents: invoice.minimumAdjustmentCents, description: `Fatura #${invoice.number} cancelada — estorno da franquia`, referenceKey: `invoice:${invoice.id}:minimum-reversal` },
          { owner: { type: 'PLATFORM' }, type: 'ADJUSTMENT', amountCents: -invoice.minimumAdjustmentCents, description: `Fatura #${invoice.number} cancelada — estorno da franquia`, referenceKey: `invoice:${invoice.id}:minimum-reversal-platform` },
        ]);
      }
      await this.audit.log({ action: 'invoice.cancel', entityType: 'Invoice', entityId: invoiceId, before: { status: invoice.status }, after: { status: 'CANCELED', reason } }, tx);
    });
    return this.staffView(user, invoiceId);
  }

  @Cron('0 20 * * * *')
  async markOverdue(now = new Date()): Promise<number> {
    const due = await this.prisma.invoice.findMany({ where: { status: 'ISSUED', dueAt: { lt: now } }, take: 500 });
    for (const invoice of due) {
      const updated = await this.prisma.invoice.updateMany({ where: { id: invoice.id, status: 'ISSUED' }, data: { status: 'OVERDUE' } });
      if (!updated.count) continue;
      await this.notifyCompany(invoice.companyId, `Fatura #${invoice.number} vencida`, `O pagamento de ${formatBRL(invoice.totalCents)} venceu. Novas entregas faturadas serão bloqueadas se o atraso continuar.`, invoice.id);
    }
    return due.length;
  }

  // ---------------------------------------------------------------------------
  // Consultas
  // ---------------------------------------------------------------------------

  private view(invoice: Invoice & { contract?: { id: string; number: number; title: string } | null; company?: { id: string; tradeName: string } | null }) {
    return {
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      contract: invoice.contract ?? null,
      company: invoice.company ?? null,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      deliveriesCount: invoice.deliveriesCount,
      deliveriesCents: invoice.deliveriesCents,
      minimumAdjustmentCents: invoice.minimumAdjustmentCents,
      totalCents: invoice.totalCents,
      byCostCenter: invoice.byCostCenter,
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt,
      paidAt: invoice.paidAt,
      paidReference: invoice.paidReference,
      canceledAt: invoice.canceledAt,
      cancelReason: invoice.cancelReason,
    };
  }

  async listForCompany(companyId: string, query: PaginationQueryDto & { status?: InvoiceStatus }) {
    const where: Prisma.InvoiceWhereInput = { companyId, status: query.status };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({ where, orderBy: { issuedAt: 'desc' }, skip: skipOf(query), take: query.pageSize, include: { contract: { select: { id: true, number: true, title: true } } } }),
    ]);
    return paginated(rows.map((row) => this.view(row)), total, query);
  }

  async getForCompany(companyId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, companyId }, include: { contract: { select: { id: true, number: true, title: true } } } });
    if (!invoice) throw new NotFoundException('Fatura não encontrada.');
    const pending = await this.prisma.payment.findFirst({ where: { invoiceId, purpose: 'INVOICE', status: 'PENDING', pixExpiresAt: { gt: new Date() } }, select: { id: true, pixCopyPaste: true, pixExpiresAt: true, amountCents: true } });
    return { ...this.view(invoice), pendingPix: pending };
  }

  async listForStaff(user: AuthUser, query: PaginationQueryDto & { status?: InvoiceStatus; companyId?: string }) {
    const where: Prisma.InvoiceWhereInput = {
      tenantId: user.tenantId,
      status: query.status,
      companyId: query.companyId,
      ...(query.search?.trim() ? { OR: [{ company: { tradeName: { contains: query.search.trim(), mode: 'insensitive' } } }, ...(/^\d+$/.test(query.search.trim()) ? [{ number: Number(query.search.trim()) }] : [])] } : {}),
    };
    const [total, rows, totals] = await this.prisma.$transaction([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({ where, orderBy: { issuedAt: 'desc' }, skip: skipOf(query), take: query.pageSize, include: { contract: { select: { id: true, number: true, title: true } }, company: { select: { id: true, tradeName: true } } } }),
      this.prisma.invoice.groupBy({ by: ['status'], where: { tenantId: user.tenantId }, _sum: { totalCents: true }, _count: { _all: true }, orderBy: { status: 'asc' } }),
    ]);
    return {
      ...paginated(rows.map((row) => this.view(row)), total, query),
      totals: Object.fromEntries(totals.map((row) => [row.status, { count: (row._count as { _all: number })._all, totalCents: row._sum?.totalCents ?? 0 }])),
    };
  }

  async staffView(user: AuthUser, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, tenantId: user.tenantId }, include: { contract: { select: { id: true, number: true, title: true } }, company: { select: { id: true, tradeName: true } } } });
    if (!invoice) throw new NotFoundException('Fatura não encontrada.');
    const payments = await this.prisma.payment.findMany({ where: { invoiceId }, orderBy: { createdAt: 'desc' }, select: { id: true, method: true, provider: true, status: true, amountCents: true, paidAt: true, createdAt: true } });
    return { ...this.view(invoice), payments };
  }

  /** Demonstrativo da fatura (CSV para a contabilidade do cliente). */
  async exportCsv(invoiceId: string, scope: { companyId?: string; tenantId?: string }) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, ...scope } });
    if (!invoice) throw new NotFoundException('Fatura não encontrada.');
    const deliveries = await this.prisma.delivery.findMany({
      where: { invoiceId },
      orderBy: { createdAt: 'asc' },
      select: { code: true, externalRef: true, status: true, createdAt: true, deliveredAt: true, failedAt: true, feeCents: true, tipCents: true, distanceKm: true, dropoff: true, costCenterId: true, batchId: true },
    });
    const centers = await this.prisma.costCenter.findMany({ where: { id: { in: [...new Set(deliveries.map((delivery) => delivery.costCenterId).filter((id): id is string => !!id))] } } });
    const centerOf = new Map(centers.map((center) => [center.id, center]));
    const money = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
    const escape = (value: string) => {
      const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
      return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = [['entrega', 'referencia', 'solicitada_em', 'concluida_em', 'situacao', 'destinatario', 'cidade', 'km', 'centro_custo', 'valor'].join(';')];
    for (const delivery of deliveries) {
      const dropoff = delivery.dropoff as { name?: string | null; city?: string };
      const charged = delivery.status === 'FAILED' ? delivery.feeCents : delivery.feeCents + delivery.tipCents;
      const center = delivery.costCenterId ? centerOf.get(delivery.costCenterId) : undefined;
      lines.push(
        [
          delivery.code,
          delivery.externalRef ?? '',
          delivery.createdAt.toISOString(),
          (delivery.deliveredAt ?? delivery.failedAt)?.toISOString() ?? '',
          delivery.status === 'FAILED' ? 'Não realizada (taxa de deslocamento)' : 'Entregue',
          dropoff.name ?? '',
          dropoff.city ?? '',
          delivery.distanceKm.toFixed(1).replace('.', ','),
          center ? `${center.code} - ${center.name}` : '',
          money(charged),
        ]
          .map(escape)
          .join(';'),
      );
    }
    if (invoice.minimumAdjustmentCents) lines.push(['', '', '', '', 'Complemento da franquia mínima', '', '', '', '', money(invoice.minimumAdjustmentCents)].join(';'));
    lines.push(['', '', '', '', 'TOTAL', '', '', '', '', money(invoice.totalCents)].join(';'));
    return { fileName: `fatura-${invoice.number}.csv`, content: `﻿${lines.join('\r\n')}\r\n` };
  }

  private async notifyCompany(companyId: string, title: string, body: string, invoiceId: string) {
    const members = await this.prisma.companyUser.findMany({
      where: { companyId, isActive: true, role: { permissions: { some: { permission: { key: 'company.finance.read' } } } } },
      select: { userId: true },
    });
    await this.notifications.notifyMany(members.map((member) => member.userId), { type: 'b2b.invoice', title, body, data: { invoiceId, companyId }, channels: ['inapp', 'email'] });
  }
}
