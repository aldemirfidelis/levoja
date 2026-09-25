import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlanFeature } from '@levoja/shared';
import { FEATURE_KEY } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Recurso do plano exigido pela rota da empresa (`@RequireFeature`). Roda depois do acesso à
 * empresa; a equipe da plataforma não é bloqueada (atua em nome da empresa).
 */
@Injectable()
export class PlanFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<PlanFeature | undefined>(FEATURE_KEY, [context.getHandler(), context.getClass()]);
    if (!feature) return true;
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser | undefined;
    const companyId = request.params?.companyId as string | undefined;
    if (!user || !companyId || user.isStaff) return true;
    await this.subscriptions.assertFeature(user.tenantId, companyId, feature);
    return true;
  }
}
