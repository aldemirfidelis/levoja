import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { availablePartnerActions, PARTNER_STATUS_LABELS, PartnerAction } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveAdminTransition } from '../../common/partner-workflow';
import { paginated, skipOf } from '../../common/pagination';
import type { AuthUser } from '../../common/auth/auth-user';
import { PartnerActionDto, ReviewDocumentDto } from '../companies/companies.dto';
import { DriversService } from './drivers.service';
import { AdminDriversQueryDto, ReviewVehicleDto } from './drivers.dto';
import { Prisma } from '../../generated/prisma/client';

const PERMISSIONS = { review: 'drivers.review', manage: 'drivers.manage' };

@Injectable()
export class DriverReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly drivers: DriversService,
  ) {}

  async list(tenantId: string, query: AdminDriversQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.DriverWhereInput = {
      tenantId,
      status: query.status,
      ...(query.vehicleType ? { activeVehicle: { type: query.vehicleType } } : {}),
      ...(search
        ? {
            user: {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search.toLowerCase() } },
                { phone: { contains: search.replace(/\D/g, '') || search } },
              ],
            },
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.driver.count({ where }),
      this.prisma.driver.findMany({
        where,
        orderBy: [{ submittedAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: skipOf(query),
        take: query.pageSize,
        select: {
          id: true,
          status: true,
          submittedAt: true,
          approvedAt: true,
          createdAt: true,
          ratingAvg: true,
          fleetType: true,
          user: { select: { id: true, name: true, email: true, phone: true, avatarKey: true } },
          activeVehicle: { select: { type: true, plate: true, model: true } },
          address: { select: { city: true, state: true } },
          _count: { select: { documents: { where: { status: 'PENDING' } } } },
        },
      }),
    ]);
    return paginated(
      rows.map(({ user, _count, ...row }) => ({
        ...row,
        user: { id: user.id, name: user.name, email: user.email, phone: user.phone, avatarUrl: this.storage.publicUrl(user.avatarKey) },
        pendingDocuments: _count.documents,
      })),
      total,
      query,
    );
  }

  async get(actor: AuthUser, driverId: string) {
    const driver = await this.drivers.findDetail(driverId);
    if (driver.tenantId !== actor.tenantId) throw new NotFoundException('Entregador não encontrado.');
    const history = await this.prisma.driverStatusHistory.findMany({ where: { driverId }, orderBy: { createdAt: 'desc' } });
    const actorIds = [...new Set(history.map((entry) => entry.changedById).filter((id): id is string => !!id))];
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
    const names = new Map(actors.map((user) => [user.id, user.name]));
    return {
      ...this.drivers.toView(driver),
      adminActions: [
        ...(actor.can(PERMISSIONS.review) ? availablePartnerActions(driver.status, 'REVIEWER') : []),
        ...(actor.can(PERMISSIONS.manage) ? availablePartnerActions(driver.status, 'MANAGER') : []),
      ],
      history: history.map((entry) => ({ ...entry, changedByName: entry.changedById ? (names.get(entry.changedById) ?? null) : null })),
    };
  }

  async applyAction(actor: AuthUser, driverId: string, dto: PartnerActionDto) {
    const driver = await this.drivers.findDetail(driverId);
    if (driver.tenantId !== actor.tenantId) throw new NotFoundException('Entregador não encontrado.');
    const action = dto.action as PartnerAction;
    const next = resolveAdminTransition(actor, action, driver.status, dto.reason, PERMISSIONS);

    const activeVehicle = this.drivers.activeVehicle(driver);
    if (action === 'APPROVE') {
      const pending = this.drivers
        .requiredDocuments(driver)
        .filter((type) => !driver.documents.some((doc) => doc.type === type && doc.status === 'APPROVED'));
      if (pending.length) throw new ConflictException('Aprove todos os documentos obrigatórios antes de aprovar o entregador.');
      if (!activeVehicle) throw new ConflictException('O entregador não possui veículo ativo.');
      if (activeVehicle.status === 'REJECTED') throw new ConflictException('O veículo ativo foi reprovado.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.driver.update({
        where: { id: driverId },
        data: { status: next, statusReason: dto.reason ?? null, approvedAt: action === 'APPROVE' ? new Date() : undefined },
      });
      // Os documentos do veículo ativo já foram aprovados: o veículo é aprovado junto com o cadastro.
      if (action === 'APPROVE' && activeVehicle && activeVehicle.status === 'PENDING') {
        await tx.vehicle.update({ where: { id: activeVehicle.id }, data: { status: 'APPROVED' } });
      }
      await tx.driverStatusHistory.create({
        data: { driverId, fromStatus: driver.status, toStatus: next, action, reason: dto.reason, changedById: actor.userId },
      });
      await this.audit.log(
        {
          action: `driver.${action.toLowerCase()}`,
          entityType: 'Driver',
          entityId: driverId,
          before: { status: driver.status },
          after: { status: next, reason: dto.reason },
        },
        tx,
      );
    });

    const label = PARTNER_STATUS_LABELS[next];
    const bodies: Partial<Record<typeof next, string>> = {
      APPROVED: 'Seu cadastro foi aprovado! Abra o app e toque em "Ficar online" para começar a receber entregas.',
      REJECTED: `Seu cadastro foi reprovado. Motivo: ${dto.reason}`,
      PENDING_DOCUMENTS: `Precisamos de correções no seu cadastro: ${dto.reason}`,
      SUSPENDED: `Sua conta de entregador foi suspensa. Motivo: ${dto.reason}`,
      BLOCKED: `Sua conta de entregador foi bloqueada. Motivo: ${dto.reason}`,
    };
    const body = bodies[next] ?? `Status do seu cadastro: ${label}.`;
    await this.notifications.notify({
      userId: driver.userId,
      type: `driver.status.${next.toLowerCase()}`,
      title: `Cadastro de entregador: ${label}`,
      body,
      data: { driverId, status: next },
      channels: ['inapp', 'push', 'email'],
      app: 'DRIVER',
      email: { subject: `Cadastro de entregador: ${label}`, paragraphs: [body] },
    });
    return this.get(actor, driverId);
  }

  async reviewDocument(actor: AuthUser, driverId: string, documentId: string, dto: ReviewDocumentDto) {
    const document = await this.prisma.driverDocument.findFirst({
      where: { id: documentId, driverId, driver: { tenantId: actor.tenantId } },
    });
    if (!document) throw new NotFoundException('Documento não encontrado.');
    if (dto.status === 'REJECTED' && !dto.note?.trim()) throw new ConflictException('Informe o motivo da reprovação.');
    const updated = await this.prisma.driverDocument.update({
      where: { id: document.id },
      data: { status: dto.status, reviewNote: dto.note ?? null, reviewedAt: new Date(), reviewedById: actor.userId },
    });
    await this.audit.log({
      action: `driver.document.${dto.status === 'APPROVED' ? 'approve' : 'reject'}`,
      entityType: 'DriverDocument',
      entityId: document.id,
      before: { status: document.status },
      after: { status: dto.status, note: dto.note },
      metadata: { driverId, type: document.type },
    });
    return updated;
  }

  async reviewVehicle(actor: AuthUser, driverId: string, vehicleId: string, dto: ReviewVehicleDto) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, driverId, deletedAt: null, driver: { tenantId: actor.tenantId } },
    });
    if (!vehicle) throw new NotFoundException('Veículo não encontrado.');
    const updated = await this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: { status: dto.status, reviewNote: dto.note ?? null },
    });
    await this.audit.log({
      action: `driver.vehicle.${dto.status === 'APPROVED' ? 'approve' : 'reject'}`,
      entityType: 'Vehicle',
      entityId: vehicleId,
      before: { status: vehicle.status },
      after: { status: dto.status, note: dto.note },
    });
    return updated;
  }
}
