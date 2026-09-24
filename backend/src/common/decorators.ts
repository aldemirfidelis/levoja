import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@levoja/shared';
import type { AuthUser } from './auth/auth-user';

export const IS_PUBLIC_KEY = 'isPublic';
/** Rota acessível sem autenticação. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'permissions';
/** Exige TODAS as permissões de plataforma informadas. */
export const RequirePermissions = (...permissions: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, permissions);

export const COMPANY_PERMISSION_KEY = 'companyPermission';
export interface CompanyPermissionMeta {
  permission: PermissionKey;
  /** Permissão de plataforma que também libera o acesso (ex.: equipe interna). */
  staffPermission?: PermissionKey;
  /** Nome do parâmetro de rota com o id da empresa. */
  param: string;
}
/**
 * Exige que o usuário seja membro ativo da empresa (parâmetro de rota) com a permissão informada,
 * ou possua a permissão de plataforma equivalente.
 */
export const CompanyPermission = (permission: PermissionKey, staffPermission?: PermissionKey, param = 'companyId') =>
  SetMetadata(COMPANY_PERMISSION_KEY, { permission, staffPermission, param } satisfies CompanyPermissionMeta);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export const Client = createParamDecorator((_data: unknown, ctx: ExecutionContext): ClientInfo => {
  const request = ctx.switchToHttp().getRequest();
  return { ip: request.ip, userAgent: request.headers['user-agent']?.slice(0, 300) };
});
