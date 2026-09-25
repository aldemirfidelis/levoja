import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { ApiKeyScope } from '@levoja/shared';
import { ALLOW_API_KEY, IS_PUBLIC_KEY } from '../decorators';
import { toAuthUser } from '../auth/auth-user';
import { AccessService } from '../../modules/access/access.service';
import { CompanyB2bService } from '../../modules/b2b/company-b2b.service';
import { RequestContext } from '../request-context';

export interface AccessTokenPayload {
  sub: string;
  tid: string;
  sid: string;
  typ: 'access';
}

const STATUS_MESSAGES: Record<string, string> = {
  SUSPENDED: 'Conta suspensa. Entre em contato com o suporte.',
  BLOCKED: 'Conta bloqueada. Entre em contato com o suporte.',
  DEACTIVATED: 'Conta desativada.',
};

/**
 * Guard global: valida o access token (JWT) e carrega o perfil de acesso.
 * O status da conta é verificado a cada requisição (via cache curto), de modo
 * que bloqueios e suspensões têm efeito imediato.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly access: AccessService,
    private readonly apiKeys: CompanyB2bService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    const request = context.switchToHttp().getRequest();
    const token = extractBearer(request.headers.authorization);
    const apiKey = request.headers['x-api-key'];

    // API pública: chave de API somente nas rotas marcadas com @AllowApiKey(escopo).
    if (!token && typeof apiKey === 'string' && apiKey) {
      const scope = this.reflector.getAllAndOverride<ApiKeyScope | undefined>(ALLOW_API_KEY, [context.getHandler(), context.getClass()]);
      if (!scope) throw new ForbiddenException('Esta rota não aceita chave de API.');
      const response = context.switchToHttp().getResponse();
      const { user, rate } = await this.apiKeys.authorize(apiKey, scope, (identified) => this.apiKeys.trackUsage(request, response, identified));
      if (rate) {
        response.setHeader('X-RateLimit-Limit', String(rate.limit));
        response.setHeader('X-RateLimit-Remaining', String(rate.remaining));
        response.setHeader('X-RateLimit-Reset', String(rate.resetSeconds));
      }
      request.user = user;
      RequestContext.set({ userId: user.userId, tenantId: user.tenantId });
      return true;
    }

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Autenticação necessária.');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedException('Token inválido ou expirado.');
    }
    if (payload.typ !== 'access') throw new UnauthorizedException('Token inválido.');

    const profile = await this.access.getProfile(payload.sub);
    if (!profile) throw new UnauthorizedException('Usuário não encontrado.');
    if (profile.status !== 'ACTIVE') {
      throw new ForbiddenException(STATUS_MESSAGES[profile.status] ?? 'Acesso negado.');
    }

    request.user = toAuthUser(profile, payload.sid);
    RequestContext.set({ userId: profile.userId, tenantId: profile.tenantId });
    return true;
  }
}

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}
