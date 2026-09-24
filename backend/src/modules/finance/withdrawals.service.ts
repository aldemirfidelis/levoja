import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { formatBRL, WITHDRAWAL_STATUS_LABELS } from '@levoja/shared';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { AppConfig } from '../../config/config.module';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { paginated, PaginationQueryDto, skipOf } from '../../common/pagination';
import type { AuthUser } from '../../common/auth/auth-user';
import { PayoutProvider, SandboxPayoutProvider } from './gateways';
import { LedgerService, WalletOwner } from './ledger.service';
import { Prisma } from '../../generated/prisma/client';
import type { Withdrawal, WithdrawalStatus } from '../../generated/prisma/client';

export { WITHDRAWAL_STATUS_LABELS };

/**
 * Saques de entregadores e empresas via PIX para a chave cadastrada nos dados bancários.
 * O valor (+ tarifa) sai do saldo disponível na solicitação; recusa, cancelamento ou falha devolvem.
 * Provedor "manual": o financeiro transfere pelo banco e confirma no painel com o comprovante.
 */
@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);
  private readonly provider: PayoutProvider | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly ledger: LedgerService,
  ) {
    this.provider = config.env.PAYOUT_PROVIDER === 'sandbox' ? new SandboxPayoutProvider() : null;
  }

  get mode(): 'manual' | 'automatic' {
    return this.provider ? 'automatic' : 'manual';
  }

  async request(user: AuthUser, owner: Extract<WalletOwner, { type: 'DRIVER' | 'COMPANY' }>, amountCents: number) {
    const finance = await this.settings.get(user.tenantId, 'finance');
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new BadRequestException('Valor inválido.');
    if (amountCents < finance.minWithdrawalCents) throw new BadRequestException(`O valor mínimo para saque é ${formatBRL(finance.minWithdrawalCents)}.`);

    const account = await this.prisma.bankAccount.findUnique({ where: owner.type === 'DRIVER' ? { driverId: owner.driverId } : { companyId: owner.companyId } });
    if (!account?.pixKeyEncrypted) throw new UnprocessableEntityException('Cadastre uma chave PIX nos dados bancários para solicitar saques.');
    // Antifraude: após trocar a chave PIX, saques ficam retidos por um período (o cadastro inicial é validado na análise).
    const changed = account.updatedAt.getTime() - account.createdAt.getTime() > 60_000;
    const releaseAt = account.updatedAt.getTime() + finance.pixKeyChangeHoldHours * 3_600_000;
    if (changed && releaseAt > Date.now()) {
      throw new UnprocessableEntityException(
        `Por segurança, saques ficam disponíveis ${finance.pixKeyChangeHoldHours} h após a alteração dos dados bancários (a partir de ${new Date(releaseAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}).`,
      );
    }
    const wallet = await this.ledger.wallet(user.tenantId, owner);
    const open = await this.prisma.withdrawal.count({ where: { walletId: wallet.id, status: { in: ['REQUESTED', 'PROCESSING'] } } });
    if (open > 0) throw new ConflictException('Já existe um saque em andamento. Aguarde a conclusão para solicitar outro.');

    const feeCents = finance.withdrawalFeeCents;
    const withdrawal = await this.prisma.$transaction(async (tx) => {
      const created = await tx.withdrawal.create({
        data: {
          tenantId: user.tenantId,
          walletId: wallet.id,
          amountCents,
          feeCents,
          destination: `PIX ${account.pixKeyMasked ?? ''}`.trim(),
          destinationEncrypted: account.pixKeyEncrypted,
          requestedById: user.userId,
        },
      });
      const ok = await this.ledger.debitAvailable(tx, wallet.id, [
        { type: 'WITHDRAWAL', amountCents, description: `Saque para ${created.destination}`, withdrawalId: created.id, referenceKey: `withdrawal:${created.id}` },
        { type: 'FEE', amountCents: feeCents, description: 'Tarifa de saque', withdrawalId: created.id, referenceKey: `withdrawal:${created.id}:fee` },
      ]);
      if (!ok) throw new UnprocessableEntityException(`Saldo disponível insuficiente${feeCents ? ` (valor + tarifa de ${formatBRL(feeCents)})` : ''}.`);
      await this.ledger.post(tx, user.tenantId, [
        { owner: { type: 'PLATFORM' }, type: 'FEE', amountCents: feeCents, description: 'Tarifa de saque', withdrawalId: created.id, referenceKey: `withdrawal:${created.id}:platform-fee` },
      ]);
      await this.audit.log({ action: 'withdrawal.request', entityType: 'Withdrawal', entityId: created.id, after: { amountCents, feeCents, walletId: wallet.id } }, tx);
      return created;
    });

    if (this.provider && amountCents <= finance.autoApproveWithdrawalsUpToCents && account.verifiedAt) {
      await this.approve(null, withdrawal.id).catch((error) => this.logger.error(`Aprovação automática do saque ${withdrawal.id}: ${(error as Error).message}`));
    }
    return this.view(await this.prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } }));
  }

  /** O próprio solicitante cancela enquanto o saque ainda não foi analisado. */
  async cancel(user: AuthUser, owner: WalletOwner, id: string) {
    const wallet = await this.ledger.wallet(user.tenantId, owner);
    const withdrawal = await this.prisma.withdrawal.findFirst({ where: { id, walletId: wallet.id } });
    if (!withdrawal) throw new NotFoundException('Saque não encontrado.');
    await this.close(withdrawal, 'REQUESTED', 'CANCELED', { actorId: user.userId, reason: 'Cancelado pelo solicitante' });
    return this.view(await this.prisma.withdrawal.findUniqueOrThrow({ where: { id } }));
  }

  /** Aprova e, com provedor automático, envia o PIX. Com o provedor manual fica "em processamento". */
  async approve(actor: AuthUser | null, id: string) {
    const withdrawal = await this.find(actor, id);
    const updated = await this.prisma.withdrawal.updateMany({
      where: { id, status: 'REQUESTED' },
      data: { status: 'PROCESSING', reviewedById: actor?.userId ?? null, reviewedAt: new Date() },
    });
    if (updated.count === 0) throw new ConflictException('O saque não está aguardando aprovação.');
    await this.audit.log({ action: 'withdrawal.approve', entityType: 'Withdrawal', entityId: id, actorId: actor?.userId ?? null, tenantId: withdrawal.tenantId, after: { status: 'PROCESSING', automatic: !actor } });

    if (this.provider) {
      try {
        const result = await this.provider.sendPix({
          amountCents: withdrawal.amountCents,
          pixKey: this.crypto.decrypt(withdrawal.destinationEncrypted!),
          description: `Saque ${withdrawal.id.slice(-8)}`,
          idempotencyKey: withdrawal.id,
        });
        if (result.status === 'PAID') await this.markPaid(null, id, result.transferId);
        else if (result.status === 'FAILED') await this.markFailed(null, id, result.failureReason ?? 'Transferência recusada pelo banco.');
        else await this.prisma.withdrawal.update({ where: { id }, data: { providerTransferId: result.transferId } });
      } catch (error) {
        this.logger.error(`Envio do saque ${id} falhou: ${(error as Error).message}`);
        await this.markFailed(null, id, 'Falha na comunicação com o banco. O valor voltou ao saldo.');
      }
    }
    return this.view(await this.prisma.withdrawal.findUniqueOrThrow({ where: { id } }));
  }

  async reject(actor: AuthUser, id: string, reason: string) {
    const withdrawal = await this.find(actor, id);
    await this.close(withdrawal, 'REQUESTED', 'REJECTED', { actorId: actor.userId, reason });
    return this.view(await this.prisma.withdrawal.findUniqueOrThrow({ where: { id } }));
  }

  /** Confirmação manual da transferência (comprovante/identificador do banco). */
  async markPaid(actor: AuthUser | null, id: string, transferReference: string) {
    const withdrawal = await this.find(actor, id);
    const updated = await this.prisma.withdrawal.updateMany({
      where: { id, status: 'PROCESSING' },
      data: { status: 'PAID', paidAt: new Date(), providerTransferId: transferReference, failureReason: null },
    });
    if (updated.count === 0) throw new ConflictException('Somente saques em processamento podem ser confirmados.');
    await this.audit.log({ action: 'withdrawal.paid', entityType: 'Withdrawal', entityId: id, actorId: actor?.userId ?? null, tenantId: withdrawal.tenantId, after: { transferReference } });
    await this.notifyOwner(withdrawal, 'Saque enviado', `Seu saque de ${formatBRL(withdrawal.amountCents)} foi enviado para ${withdrawal.destination}.`);
    return this.view(await this.prisma.withdrawal.findUniqueOrThrow({ where: { id } }));
  }

  async markFailed(actor: AuthUser | null, id: string, reason: string) {
    const withdrawal = await this.find(actor, id);
    await this.close(withdrawal, 'PROCESSING', 'FAILED', { actorId: actor?.userId ?? null, reason });
    return this.view(await this.prisma.withdrawal.findUniqueOrThrow({ where: { id } }));
  }

  /** Encerra sem pagamento e devolve valor + tarifa ao saldo disponível. */
  private async close(withdrawal: Withdrawal, from: WithdrawalStatus, to: 'REJECTED' | 'CANCELED' | 'FAILED', context: { actorId: string | null; reason: string }) {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.withdrawal.updateMany({
        where: { id: withdrawal.id, status: from },
        data: { status: to, failureReason: context.reason, ...(to === 'REJECTED' ? { reviewedById: context.actorId, reviewedAt: new Date() } : {}) },
      });
      if (updated.count === 0) throw new ConflictException(`O saque não está ${WITHDRAWAL_STATUS_LABELS[from].toLowerCase()}.`);
      await this.reverse(tx, withdrawal);
      await this.audit.log(
        { action: `withdrawal.${to.toLowerCase()}`, entityType: 'Withdrawal', entityId: withdrawal.id, actorId: context.actorId, tenantId: withdrawal.tenantId, after: { status: to, reason: context.reason } },
        tx,
      );
    });
    if (to !== 'CANCELED') {
      await this.notifyOwner(withdrawal, to === 'REJECTED' ? 'Saque recusado' : 'Saque não concluído', `Seu saque de ${formatBRL(withdrawal.amountCents)} não foi concluído: ${context.reason}. O valor voltou ao seu saldo.`);
    }
  }

  private async reverse(tx: Tx, withdrawal: Withdrawal) {
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: withdrawal.walletId } });
    await this.ledger.post(tx, withdrawal.tenantId, [
      {
        owner: this.ledger.ownerOf(wallet),
        type: 'WITHDRAWAL_REVERSAL',
        amountCents: withdrawal.amountCents + withdrawal.feeCents,
        description: 'Saque devolvido ao saldo',
        withdrawalId: withdrawal.id,
        referenceKey: `withdrawal:${withdrawal.id}:reversal`,
      },
      { owner: { type: 'PLATFORM' }, type: 'FEE', amountCents: -withdrawal.feeCents, description: 'Tarifa de saque devolvida', withdrawalId: withdrawal.id, referenceKey: `withdrawal:${withdrawal.id}:platform-fee-reversal` },
    ]);
  }

  private async find(actor: AuthUser | null, id: string): Promise<Withdrawal> {
    const withdrawal = await this.prisma.withdrawal.findFirst({ where: { id, ...(actor ? { tenantId: actor.tenantId } : {}) } });
    if (!withdrawal) throw new NotFoundException('Saque não encontrado.');
    return withdrawal;
  }

  private async notifyOwner(withdrawal: Withdrawal, title: string, body: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { id: withdrawal.walletId } });
    if (!wallet) return;
    let userIds: string[] = [];
    if (wallet.driverId) {
      const driver = await this.prisma.driver.findUnique({ where: { id: wallet.driverId }, select: { userId: true } });
      userIds = driver ? [driver.userId] : [];
    } else if (wallet.companyId) {
      const members = await this.prisma.companyUser.findMany({
        where: { companyId: wallet.companyId, isActive: true, role: { key: { in: ['company_owner', 'company_finance'] } } },
        select: { userId: true },
      });
      userIds = members.map((member) => member.userId);
    }
    if (!userIds.length) return;
    await this.notifications.notifyMany(userIds, {
      type: 'withdrawal.status',
      title,
      body,
      data: { withdrawalId: withdrawal.id },
      channels: ['inapp', 'push', 'email'],
      email: { subject: title, paragraphs: [body] },
      ...(wallet.driverId ? { app: 'DRIVER' as const } : {}),
    });
  }

  view(withdrawal: Withdrawal) {
    return {
      id: withdrawal.id,
      amountCents: withdrawal.amountCents,
      feeCents: withdrawal.feeCents,
      status: withdrawal.status,
      statusLabel: WITHDRAWAL_STATUS_LABELS[withdrawal.status],
      destination: withdrawal.destination,
      failureReason: withdrawal.failureReason,
      providerTransferId: withdrawal.providerTransferId,
      reviewedAt: withdrawal.reviewedAt,
      paidAt: withdrawal.paidAt,
      createdAt: withdrawal.createdAt,
    };
  }

  async listForWallet(tenantId: string, owner: WalletOwner, query: PaginationQueryDto) {
    const wallet = await this.ledger.wallet(tenantId, owner);
    const where = { walletId: wallet.id };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.withdrawal.count({ where }),
      this.prisma.withdrawal.findMany({ where, orderBy: { createdAt: 'desc' }, skip: skipOf(query), take: query.pageSize }),
    ]);
    return paginated(rows.map((row) => this.view(row)), total, query);
  }

  /** Fila do financeiro, com o titular de cada carteira. */
  async listAdmin(tenantId: string, query: PaginationQueryDto & { status?: WithdrawalStatus }) {
    const where: Prisma.WithdrawalWhereInput = { tenantId, status: query.status };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.withdrawal.count({ where }),
      this.prisma.withdrawal.findMany({
        where,
        orderBy: { createdAt: query.status === 'REQUESTED' ? 'asc' : 'desc' },
        skip: skipOf(query),
        take: query.pageSize,
        include: {
          wallet: {
            select: {
              ownerType: true,
              availableCents: true,
              driver: { select: { id: true, user: { select: { name: true } } } },
              company: { select: { id: true, tradeName: true } },
            },
          },
        },
      }),
    ]);
    const page = paginated(
      rows.map((row) => ({
        ...this.view(row),
        owner: {
          type: row.wallet.ownerType,
          id: row.wallet.driver?.id ?? row.wallet.company?.id ?? null,
          name: row.wallet.driver?.user.name ?? row.wallet.company?.tradeName ?? '—',
        },
        walletAvailableCents: row.wallet.availableCents,
      })),
      total,
      query,
    );
    return { ...page, mode: this.mode };
  }
}
