import { createParamDecorator, ExecutionContext, InternalServerErrorException } from '@nestjs/common';

/**
 * Id do tenant da requisição. Para usuários autenticados, prevalece o tenant do token;
 * para rotas públicas, o tenant resolvido pelo TenantMiddleware.
 */
export const TenantId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  const tenantId = request.user?.tenantId ?? request.tenant?.id;
  if (!tenantId) throw new InternalServerErrorException('Tenant não resolvido.');
  return tenantId;
});
