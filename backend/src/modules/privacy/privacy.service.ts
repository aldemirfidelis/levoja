import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { StorageService } from '../../infra/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../access/access.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { Prisma } from '../../generated/prisma/client';

/** Evento emitido antes da anonimização — módulos com dados próprios podem vetar ou complementar. */
export const USER_ANONYMIZING = 'privacy.user.anonymizing';

export interface AnonymizationBlockers {
  userId: string;
  reasons: string[];
}

/**
 * Direitos do titular (LGPD art. 18): acesso/portabilidade (exportação) e eliminação.
 *
 * A eliminação é feita por ANONIMIZAÇÃO: registros que a lei obriga a manter
 * (fiscais, financeiros, trilha de auditoria) permanecem, mas desvinculados
 * dos dados pessoais identificáveis.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
    private readonly events: EventEmitter2,
  ) {}

  async exportData(user: AuthUser) {
    const data = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      include: {
        addresses: { where: { deletedAt: null } },
        consents: { orderBy: { createdAt: 'asc' } },
        customer: true,
        driver: {
          include: {
            vehicles: { where: { deletedAt: null } },
            documents: { select: { type: true, fileName: true, status: true, createdAt: true } },
            address: true,
          },
        },
        companyMemberships: { include: { company: { select: { id: true, tradeName: true, cnpj: true } }, role: { select: { key: true, name: true } } } },
        roles: { include: { role: { select: { key: true, name: true } } } },
        refreshTokens: { select: { createdAt: true, lastUsedAt: true, ip: true, userAgent: true, revokedAt: true } },
        notifications: { orderBy: { createdAt: 'desc' }, take: 500 },
        privacyRequests: true,
      },
    });

    await this.prisma.privacyRequest.create({
      data: { tenantId: user.tenantId, userId: user.userId, type: 'EXPORT', status: 'COMPLETED', completedAt: new Date() },
    });
    await this.audit.log({ action: 'privacy.export', entityType: 'User', entityId: user.userId });

    const { passwordHash: _p, mfaSecretEncrypted: _m, cpfEncrypted, cpfHash: _h, driver, ...profile } = data;
    return {
      generatedAt: new Date().toISOString(),
      notice: 'Dados pessoais tratados pela plataforma, conforme art. 18 da LGPD.',
      profile: { ...profile, cpf: this.crypto.decryptNullable(cpfEncrypted) },
      driver: driver
        ? { ...driver, cnhNumberEncrypted: undefined, cnhNumber: this.crypto.decryptNullable(driver.cnhNumberEncrypted) }
        : null,
    };
  }

  async requestDeletion(user: AuthUser, reason?: string) {
    const open = await this.prisma.privacyRequest.findFirst({
      where: { userId: user.userId, type: 'DELETION', status: { in: ['OPEN', 'IN_PROGRESS'] } },
    });
    if (open) throw new ConflictException('Já existe uma solicitação de exclusão em andamento.');
    const request = await this.prisma.privacyRequest.create({
      data: { tenantId: user.tenantId, userId: user.userId, type: 'DELETION', reason },
    });
    await this.audit.log({ action: 'privacy.deletion.request', entityType: 'PrivacyRequest', entityId: request.id });
    await this.notifications.notify({
      userId: user.userId,
      type: 'privacy.deletion.requested',
      title: 'Solicitação de exclusão recebida',
      body: 'Recebemos sua solicitação. Ela será analisada em até 15 dias, conforme a LGPD.',
      channels: ['inapp', 'email'],
    });
    return request;
  }

  listMine(userId: string) {
    return this.prisma.privacyRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async listForAdmin(tenantId: string, status?: string) {
    return this.prisma.privacyRequest.findMany({
      where: { tenantId, ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true, anonymizedAt: true } } },
      take: 200,
    });
  }

  async resolve(actor: AuthUser, requestId: string, approve: boolean, response: string) {
    const request = await this.prisma.privacyRequest.findFirst({ where: { id: requestId, tenantId: actor.tenantId } });
    if (!request) throw new NotFoundException('Solicitação não encontrada.');
    if (request.status === 'COMPLETED' || request.status === 'REJECTED') throw new ConflictException('Solicitação já encerrada.');

    if (approve && request.type === 'DELETION') {
      const blockers: AnonymizationBlockers = { userId: request.userId, reasons: [] };
      await this.events.emitAsync(USER_ANONYMIZING, blockers);
      if (blockers.reasons.length) {
        throw new ConflictException(`Não é possível excluir agora: ${blockers.reasons.join('; ')}`);
      }
      await this.anonymize(request.userId);
    }

    const updated = await this.prisma.privacyRequest.update({
      where: { id: request.id },
      data: { status: approve ? 'COMPLETED' : 'REJECTED', response, handledById: actor.userId, completedAt: new Date() },
    });
    await this.audit.log({
      action: approve ? 'privacy.request.complete' : 'privacy.request.reject',
      entityType: 'PrivacyRequest',
      entityId: request.id,
      metadata: { type: request.type, userId: request.userId },
    });
    return updated;
  }

  private async anonymize(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { driver: { include: { documents: true } } },
    });
    const fileKeys = [user.avatarKey, ...(user.driver?.documents.map((doc) => doc.fileKey) ?? [])];

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          name: 'Titular removido',
          email: `removido+${userId}@anonimo.invalid`,
          phone: null,
          cpfEncrypted: null,
          cpfHash: null,
          birthDate: null,
          avatarKey: null,
          passwordHash: null,
          mfaEnabled: false,
          mfaSecretEncrypted: null,
          preferences: Prisma.DbNull,
          status: 'DEACTIVATED',
          statusReason: 'Conta excluída a pedido do titular (LGPD)',
          anonymizedAt: new Date(),
        },
      });
      await tx.address.updateMany({
        where: { userId },
        data: { deletedAt: new Date(), recipientName: null, street: '-', number: '-', complement: null, reference: null, lat: null, lng: null },
      });
      await tx.deviceToken.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'anonymized' } });
      await tx.companyUser.updateMany({ where: { userId }, data: { isActive: false } });
      if (user.driver) {
        await tx.driverDocument.deleteMany({ where: { driverId: user.driver.id } });
        await tx.driver.update({ where: { id: user.driver.id }, data: { cnhNumberEncrypted: null, status: 'BLOCKED', statusReason: 'Conta excluída' } });
        await tx.bankAccount.deleteMany({ where: { driverId: user.driver.id } });
      }
    });

    await Promise.all(fileKeys.map((key) => this.storage.delete(key)));
    await this.access.invalidate(userId);
    this.logger.log(`Usuário ${userId} anonimizado.`);
  }
}
