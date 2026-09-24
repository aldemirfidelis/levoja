import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LEDGER_ENTRY_LABELS } from '@levoja/shared';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { paginated, PaginationQueryDto, skipOf } from '../../common/pagination';
import type { LedgerEntryType, WalletOwnerType } from '../../generated/prisma/enums';
import type { Wallet } from '../../generated/prisma/client';

export type WalletOwner =
  | { type: 'DRIVER'; driverId: string }
  | { type: 'COMPANY'; companyId: string }
  | { type: 'CUSTOMER'; customerId: string }
  | { type: 'PLATFORM' };

export interface LedgerEntryInput {
  owner: WalletOwner;
  type: LedgerEntryType;
  amountCents: number;
  description: string;
  /** Sem data = disponível imediatamente. */
  availableAt?: Date;
  orderId?: string;
  deliveryId?: string;
  paymentId?: string;
  withdrawalId?: string;
  /** Chave de idempotência (ex.: "order:<id>:sale"). */
  referenceKey: string;
}

export const ENTRY_LABELS: Record<LedgerEntryType, string> = LEDGER_ENTRY_LABELS;

/**
 * Razão financeiro (ledger). Toda movimentação é um lançamento imutável com sinal;
 * saldos das carteiras são caches atualizados na mesma transação.
 * - PENDING: ainda não liberado (prazo de liberação); AVAILABLE: pode ser sacado.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async wallet(tenantId: string, owner: WalletOwner, tx: Tx = this.prisma): Promise<Wallet> {
    const where =
      owner.type === 'DRIVER'
        ? { driverId: owner.driverId }
        : owner.type === 'COMPANY'
          ? { companyId: owner.companyId }
          : owner.type === 'CUSTOMER'
            ? { customerId: owner.customerId }
            : { platformTenantId: tenantId };
    const existing = await tx.wallet.findUnique({ where: where as never });
    if (existing) return existing;
    // upsert: dentro de uma transação, um INSERT com erro abortaria a transação inteira.
    return tx.wallet.upsert({ where: where as never, create: { tenantId, ownerType: owner.type as WalletOwnerType, ...where }, update: {} });
  }

  /** Lança entradas de forma idempotente (chaves já existentes são ignoradas). */
  async post(tx: Tx, tenantId: string, entries: LedgerEntryInput[]): Promise<number> {
    let created = 0;
    for (const entry of entries) {
      if (entry.amountCents === 0) continue;
      const exists = await tx.walletTransaction.findUnique({ where: { referenceKey: entry.referenceKey }, select: { id: true } });
      if (exists) continue;
      const wallet = await this.wallet(tenantId, entry.owner, tx);
      const pending = !!entry.availableAt && entry.availableAt > new Date();
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: entry.type,
          amountCents: entry.amountCents,
          status: pending ? 'PENDING' : 'AVAILABLE',
          availableAt: entry.availableAt ?? new Date(),
          description: entry.description,
          orderId: entry.orderId,
          deliveryId: entry.deliveryId,
          paymentId: entry.paymentId,
          withdrawalId: entry.withdrawalId,
          referenceKey: entry.referenceKey,
        },
      });
      await tx.wallet.update({
        where: { id: wallet.id },
        data: pending ? { pendingCents: { increment: entry.amountCents } } : { availableCents: { increment: entry.amountCents } },
      });
      created += 1;
    }
    return created;
  }

  /**
   * Débito condicional do saldo disponível (saques, pagamentos com carteira): nunca deixa o saldo
   * negativo, mesmo com requisições simultâneas. Retorna false se o saldo for insuficiente.
   */
  async debitAvailable(tx: Tx, walletId: string, entries: Omit<LedgerEntryInput, 'owner' | 'availableAt'>[]): Promise<boolean> {
    const total = entries.reduce((sum, entry) => sum + Math.abs(entry.amountCents), 0);
    if (total === 0) return true;
    const updated = await tx.wallet.updateMany({ where: { id: walletId, availableCents: { gte: total } }, data: { availableCents: { decrement: total } } });
    if (updated.count === 0) return false;
    for (const entry of entries) {
      if (entry.amountCents === 0) continue;
      await tx.walletTransaction.create({
        data: {
          walletId,
          type: entry.type,
          amountCents: -Math.abs(entry.amountCents),
          status: 'AVAILABLE',
          availableAt: new Date(),
          description: entry.description,
          orderId: entry.orderId,
          deliveryId: entry.deliveryId,
          paymentId: entry.paymentId,
          withdrawalId: entry.withdrawalId,
          referenceKey: entry.referenceKey,
        },
      });
    }
    return true;
  }

  ownerOf(wallet: Pick<Wallet, 'ownerType' | 'driverId' | 'companyId' | 'customerId'>): WalletOwner {
    if (wallet.ownerType === 'DRIVER') return { type: 'DRIVER', driverId: wallet.driverId! };
    if (wallet.ownerType === 'COMPANY') return { type: 'COMPANY', companyId: wallet.companyId! };
    if (wallet.ownerType === 'CUSTOMER') return { type: 'CUSTOMER', customerId: wallet.customerId! };
    return { type: 'PLATFORM' };
  }

  /** Libera lançamentos pendentes cujo prazo venceu (executado a cada 10 minutos). */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async releaseDue(): Promise<number> {
    const due = await this.prisma.walletTransaction.findMany({ where: { status: 'PENDING', availableAt: { lte: new Date() } }, take: 1000 });
    for (const entry of due) {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.walletTransaction.updateMany({ where: { id: entry.id, status: 'PENDING' }, data: { status: 'AVAILABLE' } });
        if (updated.count === 0) return;
        await tx.wallet.update({
          where: { id: entry.walletId },
          data: { pendingCents: { decrement: entry.amountCents }, availableCents: { increment: entry.amountCents } },
        });
      });
    }
    if (due.length) this.logger.log(`${due.length} lançamento(s) liberado(s).`);
    return due.length;
  }

  /** Cancela lançamentos pendentes (ex.: estorno antes da liberação). */
  async cancelPending(tx: Tx, where: { orderId?: string; deliveryId?: string }): Promise<void> {
    const entries = await tx.walletTransaction.findMany({ where: { ...where, status: 'PENDING' } });
    for (const entry of entries) {
      await tx.walletTransaction.update({ where: { id: entry.id }, data: { status: 'CANCELED' } });
      await tx.wallet.update({ where: { id: entry.walletId }, data: { pendingCents: { decrement: entry.amountCents } } });
    }
  }

  async summary(walletId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) throw new NotFoundException('Carteira não encontrada.');
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth(), 1);
    const byType = await this.prisma.walletTransaction.groupBy({
      by: ['type'],
      where: { walletId, status: { not: 'CANCELED' }, createdAt: { gte: since } },
      _sum: { amountCents: true },
    });
    return {
      id: wallet.id,
      availableCents: wallet.availableCents,
      pendingCents: wallet.pendingCents,
      monthTotals: Object.fromEntries(byType.map((row) => [row.type, row._sum.amountCents ?? 0])),
    };
  }

  async transactions(walletId: string, query: PaginationQueryDto) {
    const where = { walletId, status: { not: 'CANCELED' as const } };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.walletTransaction.count({ where }),
      this.prisma.walletTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: skipOf(query), take: query.pageSize }),
    ]);
    return paginated(
      rows.map((row) => ({
        id: row.id,
        type: row.type,
        label: ENTRY_LABELS[row.type],
        amountCents: row.amountCents,
        status: row.status,
        availableAt: row.availableAt,
        description: row.description,
        orderId: row.orderId,
        deliveryId: row.deliveryId,
        createdAt: row.createdAt,
      })),
      total,
      query,
    );
  }

  /** Recalcula os saldos a partir dos lançamentos (auditoria/conciliação). */
  async recompute(walletId: string): Promise<{ availableCents: number; pendingCents: number; drift: boolean }> {
    const sums = await this.prisma.walletTransaction.groupBy({ by: ['status'], where: { walletId }, _sum: { amountCents: true } });
    const get = (status: string) => sums.find((row) => row.status === status)?._sum.amountCents ?? 0;
    const wallet = await this.prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    const availableCents = get('AVAILABLE');
    const pendingCents = get('PENDING');
    return { availableCents, pendingCents, drift: availableCents !== wallet.availableCents || pendingCents !== wallet.pendingCents };
  }
}
