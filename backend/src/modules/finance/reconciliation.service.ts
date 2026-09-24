import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { paginated, PaginationQueryDto, skipOf } from '../../common/pagination';
import type { AuthUser } from '../../common/auth/auth-user';
import { ENTRY_LABELS, LedgerService } from './ledger.service';
import { Prisma } from '../../generated/prisma/client';
import type { LedgerEntryType, WalletOwnerType } from '../../generated/prisma/enums';

const MAX_RANGE_DAYS = 366;

export interface WalletsQuery extends PaginationQueryDto {
  ownerType?: WalletOwnerType;
  balance?: 'negative' | 'positive';
}

/**
 * Conciliação e visão financeira da plataforma:
 * pagamentos × razão, receita líquida, saldos a pagar/receber, saques e anomalias.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {}

  private range(from?: string, to?: string) {
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - 30 * 86_400_000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) throw new BadRequestException('Período inválido.');
    if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86_400_000) throw new BadRequestException(`O período máximo é de ${MAX_RANGE_DAYS} dias.`);
    return { start, end };
  }

  async report(tenantId: string, from?: string, to?: string) {
    const { start, end } = this.range(from, to);
    const period = { gte: start, lt: end };

    const [payments, platformEntries, ledgerByOwner, orders, balances, withdrawals, openWithdrawals] = await Promise.all([
      this.prisma.payment.groupBy({
        by: ['method', 'status'],
        where: { tenantId, createdAt: period },
        _count: { _all: true },
        _sum: { amountCents: true, refundedCents: true },
      }),
      this.prisma.walletTransaction.groupBy({
        by: ['type'],
        where: { wallet: { tenantId, ownerType: 'PLATFORM' }, status: { not: 'CANCELED' }, createdAt: period },
        _sum: { amountCents: true },
      }),
      this.prisma.walletTransaction.groupBy({
        by: ['type', 'status'],
        where: { wallet: { tenantId, ownerType: { in: ['COMPANY', 'DRIVER'] } }, createdAt: period },
        _sum: { amountCents: true },
      }),
      this.prisma.order.aggregate({
        where: { tenantId, status: 'DELIVERED', deliveredAt: period },
        _count: { _all: true },
        _sum: { totalCents: true, subtotalCents: true, discountCents: true, deliveryFeeCents: true, serviceFeeCents: true, tipCents: true, platformCommissionCents: true },
      }),
      this.prisma.wallet.groupBy({
        by: ['ownerType'],
        where: { tenantId, ownerType: { not: 'PLATFORM' } },
        _sum: { availableCents: true, pendingCents: true },
        _count: { _all: true },
      }),
      this.prisma.withdrawal.groupBy({ by: ['status'], where: { tenantId, createdAt: period }, _count: { _all: true }, _sum: { amountCents: true, feeCents: true } }),
      this.prisma.withdrawal.aggregate({ where: { tenantId, status: { in: ['REQUESTED', 'PROCESSING'] } }, _count: { _all: true }, _sum: { amountCents: true } }),
    ]);

    // Devedores (saldo negativo) x credores, por tipo de titular.
    const negatives = await this.prisma.wallet.groupBy({
      by: ['ownerType'],
      where: { tenantId, ownerType: { not: 'PLATFORM' }, availableCents: { lt: 0 } },
      _sum: { availableCents: true },
      _count: { _all: true },
    });

    const platform = Object.fromEntries(platformEntries.map((row) => [row.type, row._sum.amountCents ?? 0])) as Partial<Record<LedgerEntryType, number>>;
    const platformNet = Object.values(platform).reduce((sum, value) => sum + (value ?? 0), 0);

    return {
      period: { from: start, to: end },
      orders: {
        delivered: orders._count._all,
        gmvCents: orders._sum.totalCents ?? 0,
        subtotalCents: orders._sum.subtotalCents ?? 0,
        discountCents: orders._sum.discountCents ?? 0,
        deliveryFeeCents: orders._sum.deliveryFeeCents ?? 0,
        serviceFeeCents: orders._sum.serviceFeeCents ?? 0,
        tipCents: orders._sum.tipCents ?? 0,
        commissionCents: orders._sum.platformCommissionCents ?? 0,
      },
      payments: payments.map((row) => ({
        method: row.method,
        status: row.status,
        count: row._count._all,
        amountCents: row._sum.amountCents ?? 0,
        refundedCents: row._sum.refundedCents ?? 0,
      })),
      platform: {
        byType: Object.entries(platform).map(([type, amountCents]) => ({ type, label: ENTRY_LABELS[type as LedgerEntryType], amountCents })),
        netRevenueCents: platformNet,
      },
      partners: ledgerByOwner.map((row) => ({ type: row.type, label: ENTRY_LABELS[row.type], status: row.status, amountCents: row._sum.amountCents ?? 0 })),
      balances: balances.map((row) => {
        const negative = negatives.find((item) => item.ownerType === row.ownerType);
        return {
          ownerType: row.ownerType,
          wallets: row._count._all,
          availableCents: row._sum.availableCents ?? 0,
          pendingCents: row._sum.pendingCents ?? 0,
          debtorWallets: negative?._count._all ?? 0,
          debtCents: -(negative?._sum.availableCents ?? 0),
        };
      }),
      withdrawals: {
        byStatus: withdrawals.map((row) => ({ status: row.status, count: row._count._all, amountCents: row._sum.amountCents ?? 0, feeCents: row._sum.feeCents ?? 0 })),
        openCount: openWithdrawals._count._all,
        openAmountCents: openWithdrawals._sum.amountCents ?? 0,
      },
      anomalies: await this.anomalies(tenantId),
    };
  }

  /** Situações que exigem ação do financeiro. */
  async anomalies(tenantId: string) {
    const now = Date.now();
    const [unsettled, paidButCanceled, stalePix, failedRefunds] = await Promise.all([
      this.prisma.order.findMany({
        where: { tenantId, status: 'DELIVERED', settledAt: null, deliveredAt: { lt: new Date(now - 30 * 60_000) } },
        select: { id: true, number: true, deliveredAt: true },
        take: 50,
      }),
      this.prisma.payment.findMany({
        where: { tenantId, status: 'PAID', purpose: 'ORDER', method: { not: 'CASH' } },
        select: { id: true, orderId: true, amountCents: true },
        take: 500,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.payment.findMany({
        where: { tenantId, status: 'PENDING', method: 'PIX', pixExpiresAt: { lt: new Date(now - 10 * 60_000) } },
        select: { id: true, orderId: true, amountCents: true, pixExpiresAt: true },
        take: 50,
      }),
      this.prisma.refund.findMany({
        where: { status: { in: ['FAILED', 'PENDING'] }, payment: { tenantId }, createdAt: { lt: new Date(now - 60 * 60_000) } },
        select: { id: true, paymentId: true, amountCents: true, status: true, createdAt: true },
        take: 50,
      }),
    ]);
    const canceledOrders = await this.prisma.order.findMany({
      where: { id: { in: paidButCanceled.map((row) => row.orderId).filter((id): id is string => !!id) }, status: 'CANCELED' },
      select: { id: true, number: true },
    });
    const canceledById = new Map(canceledOrders.map((order) => [order.id, order]));
    return {
      unsettledOrders: unsettled,
      paidCanceledOrders: paidButCanceled
        .filter((row) => row.orderId && canceledById.has(row.orderId))
        .map((row) => ({ paymentId: row.id, orderId: row.orderId, number: canceledById.get(row.orderId!)!.number, amountCents: row.amountCents })),
      stalePixPayments: stalePix,
      stuckRefunds: failedRefunds,
    };
  }

  /** Confere os saldos em cache contra a soma dos lançamentos. */
  async verifyWallets(tenantId: string, limit = 500) {
    const wallets = await this.prisma.wallet.findMany({ where: { tenantId }, select: { id: true, ownerType: true }, orderBy: { updatedAt: 'desc' }, take: limit });
    const drift: { walletId: string; ownerType: WalletOwnerType; expected: { availableCents: number; pendingCents: number } }[] = [];
    for (const wallet of wallets) {
      const result = await this.ledger.recompute(wallet.id);
      if (result.drift) drift.push({ walletId: wallet.id, ownerType: wallet.ownerType, expected: { availableCents: result.availableCents, pendingCents: result.pendingCents } });
    }
    return { checked: wallets.length, drift };
  }

  // ---------------------------------------------------------------------------
  // Carteiras (painel)
  // ---------------------------------------------------------------------------

  async wallets(tenantId: string, query: WalletsQuery) {
    const where: Prisma.WalletWhereInput = {
      tenantId,
      ownerType: query.ownerType ?? { not: 'PLATFORM' },
      ...(query.balance === 'negative' ? { availableCents: { lt: 0 } } : query.balance === 'positive' ? { availableCents: { gt: 0 } } : {}),
      ...(query.search
        ? {
            OR: [
              { company: { tradeName: { contains: query.search, mode: 'insensitive' } } },
              { driver: { user: { name: { contains: query.search, mode: 'insensitive' } } } },
              { customer: { user: { name: { contains: query.search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.wallet.count({ where }),
      this.prisma.wallet.findMany({
        where,
        orderBy: query.balance === 'negative' ? { availableCents: 'asc' } : { updatedAt: 'desc' },
        skip: skipOf(query),
        take: query.pageSize,
        include: this.ownerInclude,
      }),
    ]);
    return paginated(rows.map((row) => this.walletView(row)), total, query);
  }

  private readonly ownerInclude = {
    driver: { select: { id: true, user: { select: { name: true } } } },
    company: { select: { id: true, tradeName: true } },
    customer: { select: { id: true, user: { select: { name: true } } } },
  } satisfies Prisma.WalletInclude;

  private walletView(wallet: Prisma.WalletGetPayload<{ include: ReconciliationService['ownerInclude'] }>) {
    return {
      id: wallet.id,
      ownerType: wallet.ownerType,
      ownerId: wallet.driver?.id ?? wallet.company?.id ?? wallet.customer?.id ?? null,
      ownerName: wallet.driver?.user.name ?? wallet.company?.tradeName ?? wallet.customer?.user.name ?? 'Plataforma',
      availableCents: wallet.availableCents,
      pendingCents: wallet.pendingCents,
      updatedAt: wallet.updatedAt,
    };
  }

  async wallet(tenantId: string, id: string) {
    const wallet = await this.prisma.wallet.findFirst({ where: { id, tenantId }, include: this.ownerInclude });
    if (!wallet) throw new NotFoundException('Carteira não encontrada.');
    const [summary, check] = await Promise.all([this.ledger.summary(wallet.id), this.ledger.recompute(wallet.id)]);
    return { ...this.walletView(wallet), monthTotals: summary.monthTotals, drift: check.drift };
  }

  async platformWallet(tenantId: string) {
    const wallet = await this.ledger.wallet(tenantId, { type: 'PLATFORM' });
    return { ...(await this.ledger.summary(wallet.id)), ownerType: 'PLATFORM' as const, ownerName: 'Plataforma' };
  }

  /**
   * Ajuste manual (crédito ou débito) com justificativa obrigatória e trilha de auditoria.
   * A contrapartida vai para a carteira da plataforma, mantendo o razão fechado.
   */
  async adjust(actor: AuthUser, walletId: string, amountCents: number, reason: string) {
    if (!Number.isInteger(amountCents) || amountCents === 0) throw new BadRequestException('Informe um valor diferente de zero.');
    const wallet = await this.prisma.wallet.findFirst({ where: { id: walletId, tenantId: actor.tenantId } });
    if (!wallet) throw new NotFoundException('Carteira não encontrada.');
    if (wallet.ownerType === 'PLATFORM') throw new BadRequestException('Ajustes são feitos na carteira do parceiro/cliente.');
    const referenceKey = `adjustment:${walletId}:${Date.now()}:${actor.userId}`;
    await this.prisma.$transaction(async (tx) => {
      await this.ledger.post(tx, actor.tenantId, [
        { owner: this.ledger.ownerOf(wallet), type: 'ADJUSTMENT', amountCents, description: `Ajuste: ${reason}`, referenceKey },
        { owner: { type: 'PLATFORM' }, type: 'ADJUSTMENT', amountCents: -amountCents, description: `Ajuste (${wallet.ownerType.toLowerCase()}): ${reason}`, referenceKey: `${referenceKey}:platform` },
      ]);
      await this.audit.log({ action: 'wallet.adjust', entityType: 'Wallet', entityId: walletId, after: { amountCents, reason } }, tx);
    });
    return this.wallet(actor.tenantId, walletId);
  }
}
