import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators';
import { toAuthUser } from '../auth/auth-user';
import { AccessService } from '../../modules/access/access.service';
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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    const request = context.switchToHttp().getRequest();
    const token = extractBearer(request.headers.authorization);

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
