import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ROLE_KEYS, USER_STATUS_LABELS } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService, diff } from '../audit/audit.service';
import { AccessService } from '../access/access.service';
import { NotificationsService } from '../notifications/notifications.service';
import { paginated, skipOf } from '../../common/pagination';
import type { AuthUser } from '../../common/auth/auth-user';
import { UsersService } from './users.service';
import { InvitationsService } from './invitations.service';
import { AdminCreateUserDto, AdminUpdateUserDto, AdminUsersQueryDto, UserStatusActionDto } from './users.dto';
import { Prisma } from '../../generated/prisma/client';
import type { UserStatus } from '../../generated/prisma/enums';

const ACTION_TO_STATUS: Record<UserStatusActionDto['action'], UserStatus> = {
  SUSPEND: 'SUSPENDED',
  BLOCK: 'BLOCKED',
  DEACTIVATE: 'DEACTIVATED',
  REACTIVATE: 'ACTIVE',
};

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly invitations: InvitationsService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(tenantId: string, query: AdminUsersQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.UserWhereInput = {
      tenantId,
      status: query.status,
      anonymizedAt: null,
      ...(query.role ? { roles: { some: { role: { key: query.role } } } } : {}),
      ...(query.type === 'customer' ? { customer: { isNot: null } } : {}),
      ...(query.type === 'driver' ? { driver: { isNot: null } } : {}),
      ...(query.type === 'company' ? { companyMemberships: { some: {} } } : {}),
      ...(query.type === 'staff' ? { roles: { some: { role: { isStaff: true } } } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search.toLowerCase() } },
              { phone: { contains: search.replace(/\D/g, '') || search } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: skipOf(query),
        take: query.pageSize,
        include: {
          roles: { select: { role: { select: { key: true, name: true } } } },
          customer: { select: { id: true } },
          driver: { select: { id: true, status: true } },
          _count: { select: { companyMemberships: true } },
        },
      }),
    ]);
    return paginated(
      rows.map((user) => ({
        ...this.users.toView(user),
        roles: user.roles.map(({ role }) => role),
        isCustomer: !!user.customer,
        driverStatus: user.driver?.status ?? null,
        companiesCount: user._count.companyMemberships,
      })),
      total,
      query,
    );
  }

  async get(actor: AuthUser, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId: actor.tenantId },
      include: {
        roles: { select: { role: { select: { key: true, name: true, isStaff: true } } } },
        customer: { select: { id: true, createdAt: true } },
        driver: { select: { id: true, status: true, createdAt: true } },
        companyMemberships: {
          select: {
            isActive: true,
            role: { select: { key: true, name: true } },
            company: { select: { id: true, tradeName: true, status: true } },
          },
        },
        refreshTokens: {
          where: { revokedAt: null, expiresAt: { gt: new Date() } },
          select: { familyId: true, createdAt: true, lastUsedAt: true, ip: true, userAgent: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    return {
      ...this.users.toView(user),
      roles: user.roles.map(({ role }) => role),
      customer: user.customer,
      driver: user.driver,
      companies: user.companyMemberships,
      activeSessions: user.refreshTokens,
    };
  }

  /** Cria usuário interno (equipe). O acesso é ativado por convite com definição de senha. */
  async create(actor: AuthUser, dto: AdminCreateUserDto) {
    const roles = await this.prisma.role.findMany({
      where: { tenantId: actor.tenantId, key: { in: dto.roleKeys }, scope: 'PLATFORM' },
    });
    if (roles.length !== new Set(dto.roleKeys).size) throw new BadRequestException('Um ou mais papéis são inválidos.');
    if (roles.some((role) => role.key === ROLE_KEYS.SUPER_ADMIN) && !actor.can('tenants.manage')) {
      throw new ForbiddenException('Somente um Super Admin pode criar outro Super Admin.');
    }
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await this.users.create(tx, actor.tenantId, {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        roleIds: roles.map((role) => role.id),
      });
      await this.audit.log(
        { action: 'user.create', entityType: 'User', entityId: created.id, after: { name: created.name, email: created.email, roles: dto.roleKeys } },
        tx,
      );
      return created;
    });
    const staff = roles.some((role) => role.isStaff);
    await this.invitations.sendInvitation(user, 'Você foi convidado para a equipe da plataforma', staff ? 'admin' : 'web');
    return this.get(actor, user.id);
  }

  async update(actor: AuthUser, userId: string, dto: AdminUpdateUserDto) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId: actor.tenantId } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    const email = dto.email ? this.users.normalizeEmail(dto.email) : undefined;
    const phone = dto.phone ? this.users.normalizePhone(dto.phone) : undefined;
    await this.users.assertAvailable(actor.tenantId, { email, phone }, userId);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name?.trim(),
        email,
        phone,
        // Trocar e-mail/telefone invalida a verificação anterior.
        emailVerifiedAt: email && email !== user.email ? null : undefined,
        phoneVerifiedAt: phone && phone !== user.phone ? null : undefined,
      },
    });
    const changes = diff(
      { name: user.name, email: user.email, phone: user.phone },
      { name: updated.name, email: updated.email, phone: updated.phone },
    );
    await this.audit.log({ action: 'user.update', entityType: 'User', entityId: userId, ...changes });
    return this.get(actor, userId);
  }

  async changeStatus(actor: AuthUser, userId: string, dto: UserStatusActionDto) {
    if (userId === actor.userId) throw new ForbiddenException('Você não pode alterar o status da própria conta.');
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId: actor.tenantId },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    if (user.anonymizedAt) throw new ConflictException('Conta excluída (LGPD) não pode ser reativada.');
    if (user.roles.some(({ role }) => role.key === ROLE_KEYS.SUPER_ADMIN) && !actor.can('tenants.manage')) {
      throw new ForbiddenException('Somente um Super Admin pode alterar outro Super Admin.');
    }
    const status = ACTION_TO_STATUS[dto.action];
    if (user.status === status) throw new ConflictException(`A conta já está ${USER_STATUS_LABELS[status].toLowerCase()}.`);
    if (status !== 'ACTIVE' && !dto.reason?.trim()) throw new BadRequestException('Informe o motivo.');

    await this.prisma.user.update({
      where: { id: userId },
      data: { status, statusReason: status === 'ACTIVE' ? null : dto.reason, failedLoginCount: 0, lockedUntil: null },
    });
    if (status !== 'ACTIVE') {
      // Encerra todas as sessões: o bloqueio vale imediatamente em todos os dispositivos.
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: `status:${status}` },
      });
    }
    await this.access.invalidate(userId);
    await this.audit.log({
      action: `user.${dto.action.toLowerCase()}`,
      entityType: 'User',
      entityId: userId,
      before: { status: user.status },
      after: { status, reason: dto.reason },
    });
    await this.notifications.notify({
      userId,
      type: `user.status.${status.toLowerCase()}`,
      title: `Sua conta está ${USER_STATUS_LABELS[status].toLowerCase()}`,
      body: status === 'ACTIVE' ? 'Seu acesso à plataforma foi restabelecido.' : `Motivo: ${dto.reason}. Em caso de dúvidas, fale com o suporte.`,
      channels: ['email'],
    });
    return this.get(actor, userId);
  }

  async sendPasswordReset(actor: AuthUser, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId: actor.tenantId },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    await this.invitations.sendPasswordReset(user, user.roles.some(({ role }) => role.isStaff) ? 'admin' : 'web');
    await this.audit.log({ action: 'user.password_reset.send', entityType: 'User', entityId: userId });
  }
}
