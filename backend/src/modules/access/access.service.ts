import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CacheService } from '../../infra/cache/cache.service';
import type { AccessProfile } from '../../common/auth/auth-user';

const PROFILE_TTL_SECONDS = 60;
const cacheKey = (userId: string) => `access:${userId}`;

/**
 * Resolve papéis e permissões do usuário (RBAC) com cache curto.
 * Qualquer alteração de papéis, status ou vínculo com empresa deve chamar `invalidate`.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async getProfile(userId: string): Promise<AccessProfile | null> {
    const cached = await this.cache.get<AccessProfile>(cacheKey(userId));
    if (cached) return cached;
    const profile = await this.loadProfile(userId);
    if (profile) await this.cache.set(cacheKey(userId), profile, PROFILE_TTL_SECONDS);
    return profile;
  }

  async invalidate(...userIds: string[]): Promise<void> {
    await this.cache.del(...userIds.map(cacheKey));
  }

  /** Invalida todos os perfis (ex.: permissões de um papel foram alteradas). */
  async invalidateAll(): Promise<void> {
    await this.cache.delByPrefix('access:');
  }

  private async loadProfile(userId: string): Promise<AccessProfile | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        tenantId: true,
        status: true,
        roles: {
          select: {
            role: {
              select: { key: true, isStaff: true, permissions: { select: { permission: { select: { key: true } } } } },
            },
          },
        },
        customer: { select: { id: true } },
        driver: { select: { id: true } },
        companyMemberships: {
          where: { isActive: true },
          select: {
            companyId: true,
            role: { select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } },
          },
        },
      },
    });
    if (!user) return null;

    const permissions = new Set<string>();
    for (const { role } of user.roles) role.permissions.forEach(({ permission }) => permissions.add(permission.key));

    return {
      userId: user.id,
      tenantId: user.tenantId,
      status: user.status,
      roles: user.roles.map(({ role }) => role.key),
      permissions: [...permissions],
      isStaff: user.roles.some(({ role }) => role.isStaff),
      customerId: user.customer?.id ?? null,
      driverId: user.driver?.id ?? null,
      companies: user.companyMemberships.map((membership) => ({
        companyId: membership.companyId,
        roleKey: membership.role.key,
        permissions: membership.role.permissions.map(({ permission }) => permission.key),
      })),
    };
  }
}
