import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { COMPANY_PERMISSION_KEY, CompanyPermissionMeta, PERMISSIONS_KEY } from '../decorators';
import type { AuthUser } from '../auth/auth-user';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CacheService } from '../../infra/cache/cache.service';

/** Verifica permissões de plataforma declaradas com @RequirePermissions. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;
    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('Acesso negado.');
    const missing = required.filter((permission) => !user.can(permission));
    if (missing.length) throw new ForbiddenException('Você não tem permissão para esta ação.');
    return true;
  }
}

/**
 * Verifica acesso a recursos de uma empresa declarados com @CompanyPermission.
 * Membros precisam da permissão no papel da empresa; a equipe interna usa a permissão
 * de plataforma — mas somente para empresas do próprio tenant (isolamento multi-tenant).
 */
@Injectable()
export class CompanyAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<CompanyPermissionMeta>(COMPANY_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return true;
    const request = context.switchToHttp().getRequest();
    const user: AuthUser | undefined = request.user;
    const companyId: string | undefined = request.params?.[meta.param];
    if (!user || !companyId || !UUID.test(companyId)) throw new ForbiddenException('Acesso negado.');
    if (user.canInCompany(companyId, meta.permission)) return true;
    if (meta.staffPermission && user.can(meta.staffPermission)) {
      const tenantId = await this.cache.wrap(`company-tenant:${companyId}`, 3600, async () => {
        const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { tenantId: true } });
        return company?.tenantId ?? null;
      });
      if (tenantId === user.tenantId) return true;
      throw new NotFoundException('Empresa não encontrada.');
    }
    throw new ForbiddenException('Você não tem permissão nesta empresa.');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
