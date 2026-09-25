import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ROLE_KEYS } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SubscriptionsService } from '../saas/subscriptions.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../access/access.service';
import { UsersService } from '../users/users.service';
import { InvitationsService } from '../users/invitations.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AddMemberDto, UpdateMemberDto } from './companies.dto';

@Injectable()
export class CompanyMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly users: UsersService,
    private readonly invitations: InvitationsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async list(companyId: string) {
    const members = await this.prisma.companyUser.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, status: true, lastLoginAt: true } },
        role: { select: { id: true, key: true, name: true } },
      },
    });
    return members.map(({ id, isActive, createdAt, user, role }) => ({ id, isActive, createdAt, user, role }));
  }

  async listRoles(tenantId: string) {
    return this.prisma.role.findMany({
      where: { tenantId, scope: 'COMPANY' },
      select: { id: true, key: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Adiciona membro. Se o e-mail não tiver conta, cria o usuário e envia convite para definir senha. */
  async add(actor: AuthUser, companyId: string, dto: AddMemberDto) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { tenantId: true, tradeName: true } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    const role = await this.companyRole(company.tenantId, dto.roleKey);
    await this.subscriptions.assertLimit(company.tenantId, companyId, 'maxUsers', await this.prisma.companyUser.count({ where: { companyId, isActive: true } }));
    const email = this.users.normalizeEmail(dto.email);

    let user = await this.prisma.user.findUnique({ where: { tenantId_email: { tenantId: company.tenantId, email } } });
    let invited = false;
    if (!user) {
      if (!dto.name) throw new BadRequestException('Informe o nome do novo membro.');
      user = await this.prisma.$transaction((tx) =>
        this.users.create(tx, company.tenantId, { name: dto.name!, email, roleIds: [] }),
      );
      invited = true;
    } else if (user.status !== 'ACTIVE') {
      throw new ConflictException('Este usuário está inativo.');
    }

    const existing = await this.prisma.companyUser.findUnique({ where: { companyId_userId: { companyId, userId: user.id } } });
    if (existing?.isActive) throw new ConflictException('Usuário já é membro da empresa.');

    const member = existing
      ? await this.prisma.companyUser.update({ where: { id: existing.id }, data: { isActive: true, roleId: role.id } })
      : await this.prisma.companyUser.create({ data: { companyId, userId: user.id, roleId: role.id } });

    if (invited) await this.invitations.sendInvitation(user, `Você foi convidado para a equipe de ${company.tradeName}`, 'web');
    await this.audit.log({
      action: 'company.member.add',
      entityType: 'CompanyUser',
      entityId: member.id,
      after: { companyId, userId: user.id, role: role.key, invited },
    });
    await this.access.invalidate(user.id);
    return { id: member.id, userId: user.id, role: { key: role.key, name: role.name }, invited };
  }

  async update(actor: AuthUser, companyId: string, memberId: string, dto: UpdateMemberDto) {
    const member = await this.findMember(companyId, memberId);
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { tenantId: true } });
    const role = await this.companyRole(company.tenantId, dto.roleKey);
    const deactivating = dto.isActive === false;
    if (member.role.key === ROLE_KEYS.COMPANY_OWNER && (role.key !== ROLE_KEYS.COMPANY_OWNER || deactivating)) {
      await this.assertAnotherOwner(companyId, member.id);
    }
    if (member.userId === actor.userId && deactivating) throw new ForbiddenException('Você não pode desativar a si mesmo.');

    const updated = await this.prisma.companyUser.update({
      where: { id: member.id },
      data: { roleId: role.id, isActive: dto.isActive ?? member.isActive },
    });
    await this.audit.log({
      action: 'company.member.update',
      entityType: 'CompanyUser',
      entityId: member.id,
      before: { role: member.role.key, isActive: member.isActive },
      after: { role: role.key, isActive: updated.isActive },
    });
    await this.access.invalidate(member.userId);
    return updated;
  }

  async remove(actor: AuthUser, companyId: string, memberId: string) {
    const member = await this.findMember(companyId, memberId);
    if (member.userId === actor.userId) throw new ForbiddenException('Você não pode remover a si mesmo.');
    if (member.role.key === ROLE_KEYS.COMPANY_OWNER) await this.assertAnotherOwner(companyId, member.id);
    await this.prisma.companyUser.delete({ where: { id: member.id } });
    await this.audit.log({ action: 'company.member.remove', entityType: 'CompanyUser', entityId: member.id, before: { userId: member.userId, role: member.role.key } });
    await this.access.invalidate(member.userId);
  }

  private async findMember(companyId: string, memberId: string) {
    const member = await this.prisma.companyUser.findFirst({ where: { id: memberId, companyId }, include: { role: true } });
    if (!member) throw new NotFoundException('Membro não encontrado.');
    return member;
  }

  private async companyRole(tenantId: string, key: string) {
    const role = await this.prisma.role.findUnique({ where: { tenantId_key: { tenantId, key } } });
    if (!role || role.scope !== 'COMPANY') throw new BadRequestException('Papel inválido para membros da empresa.');
    return role;
  }

  private async assertAnotherOwner(companyId: string, exceptMemberId: string) {
    const owners = await this.prisma.companyUser.count({
      where: { companyId, isActive: true, role: { key: ROLE_KEYS.COMPANY_OWNER }, NOT: { id: exceptMemberId } },
    });
    if (owners === 0) throw new ConflictException('A empresa precisa de pelo menos um proprietário ativo.');
  }
}
