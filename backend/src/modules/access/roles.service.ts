import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ROLE_KEYS } from '@levoja/shared';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from './access.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { RoleScope } from '../../generated/prisma/enums';

export interface RoleInput {
  key?: string;
  name: string;
  description?: string;
  scope?: RoleScope;
  isStaff?: boolean;
  permissionKeys: string[];
}

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  async findByKey(tenantId: string, key: string, tx: Tx = this.prisma) {
    const role = await tx.role.findUnique({ where: { tenantId_key: { tenantId, key } } });
    if (!role) throw new NotFoundException(`Papel "${key}" não configurado. Execute o seed do banco.`);
    return role;
  }

  listPermissions() {
    return this.prisma.permission.findMany({ orderBy: [{ scope: 'asc' }, { group: 'asc' }, { key: 'asc' }] });
  }

  async listRoles(tenantId: string) {
    const roles = await this.prisma.role.findMany({
      where: { tenantId },
      orderBy: [{ scope: 'asc' }, { isSystem: 'desc' }, { name: 'asc' }],
      include: {
        permissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { users: true, companyMembers: true } },
      },
    });
    return roles.map(({ permissions, _count, ...role }) => ({
      ...role,
      permissionKeys: permissions.map(({ permission }) => permission.key),
      assignedCount: _count.users + _count.companyMembers,
    }));
  }

  async create(tenantId: string, input: RoleInput) {
    const key = (input.key ?? '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{2,40}$/.test(key)) {
      throw new BadRequestException('Chave do papel deve ter 3-40 caracteres: letras minúsculas, números e "_".');
    }
    const exists = await this.prisma.role.findUnique({ where: { tenantId_key: { tenantId, key } } });
    if (exists) throw new ConflictException('Já existe um papel com esta chave.');
    const scope = input.scope ?? 'PLATFORM';
    const permissionIds = await this.resolvePermissionIds(input.permissionKeys, scope);

    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          tenantId,
          key,
          name: input.name,
          description: input.description,
          scope,
          isStaff: scope === 'PLATFORM' && (input.isStaff ?? true),
          permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
        },
      });
      await this.audit.log(
        { action: 'role.create', entityType: 'Role', entityId: created.id, after: { key, name: input.name, permissions: input.permissionKeys } },
        tx,
      );
      return created;
    });
    return role;
  }

  async update(tenantId: string, roleId: string, input: RoleInput) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, tenantId },
      include: { permissions: { select: { permission: { select: { key: true } } } } },
    });
    if (!role) throw new NotFoundException('Papel não encontrado.');
    if (role.key === ROLE_KEYS.SUPER_ADMIN) throw new ForbiddenException('O papel Super Admin não pode ser alterado.');

    const permissionIds = await this.resolvePermissionIds(input.permissionKeys, role.scope);
    const beforeKeys = role.permissions.map(({ permission }) => permission.key).sort();

    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { id: role.id },
        data: {
          name: input.name,
          description: input.description,
          isStaff: role.isSystem ? role.isStaff : (input.isStaff ?? role.isStaff),
        },
      });
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })) });
      await this.audit.log(
        {
          action: 'role.update',
          entityType: 'Role',
          entityId: role.id,
          before: { name: role.name, permissions: beforeKeys },
          after: { name: input.name, permissions: [...input.permissionKeys].sort() },
        },
        tx,
      );
    });
    await this.access.invalidateAll();
    return (await this.listRoles(tenantId)).find((r) => r.id === role.id);
  }

  async remove(tenantId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, tenantId },
      include: { _count: { select: { users: true, companyMembers: true } } },
    });
    if (!role) throw new NotFoundException('Papel não encontrado.');
    if (role.isSystem) throw new ForbiddenException('Papéis de sistema não podem ser removidos.');
    if (role._count.users + role._count.companyMembers > 0) {
      throw new ConflictException('Remova o papel dos usuários antes de excluí-lo.');
    }
    await this.prisma.role.delete({ where: { id: role.id } });
    await this.audit.log({ action: 'role.delete', entityType: 'Role', entityId: role.id, before: { key: role.key, name: role.name } });
  }

  /** Define os papéis de plataforma de um usuário (substitui os atuais). */
  async setUserRoles(actor: AuthUser, userId: string, roleKeys: string[]) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId: actor.tenantId },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const uniqueKeys = [...new Set(roleKeys)];
    const roles = await this.prisma.role.findMany({ where: { tenantId: actor.tenantId, key: { in: uniqueKeys }, scope: 'PLATFORM' } });
    if (roles.length !== uniqueKeys.length) throw new BadRequestException('Um ou mais papéis são inválidos.');

    const currentKeys = user.roles.map(({ role }) => role.key);
    const touchesSuperAdmin = uniqueKeys.includes(ROLE_KEYS.SUPER_ADMIN) !== currentKeys.includes(ROLE_KEYS.SUPER_ADMIN);
    if (touchesSuperAdmin && !actor.can('tenants.manage')) {
      throw new ForbiddenException('Somente um Super Admin pode conceder ou remover o papel Super Admin.');
    }
    if (userId === actor.userId) {
      const losingStaff = user.roles.some(({ role }) => role.isStaff) && !roles.some((role) => role.isStaff);
      if (losingStaff) throw new ForbiddenException('Você não pode remover o próprio acesso administrativo.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.userRole.createMany({ data: roles.map((role) => ({ userId, roleId: role.id, assignedById: actor.userId })) });
      await this.audit.log(
        { action: 'user.roles.update', entityType: 'User', entityId: userId, before: { roles: currentKeys.sort() }, after: { roles: uniqueKeys.sort() } },
        tx,
      );
    });
    await this.access.invalidate(userId);
    return uniqueKeys;
  }

  private async resolvePermissionIds(keys: string[], scope: RoleScope): Promise<string[]> {
    const unique = [...new Set(keys)];
    const permissions = await this.prisma.permission.findMany({ where: { key: { in: unique } } });
    if (permissions.length !== unique.length) throw new BadRequestException('Uma ou mais permissões são inválidas.');
    if (permissions.some((permission) => permission.scope !== scope)) {
      throw new BadRequestException('Permissões incompatíveis com o escopo do papel.');
    }
    if (permissions.some((permission) => permission.key === 'tenants.manage')) {
      throw new ForbiddenException('A permissão de tenants é exclusiva do Super Admin.');
    }
    return permissions.map((permission) => permission.id);
  }
}
