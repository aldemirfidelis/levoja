import type { PermissionKey } from '@levoja/shared';

export interface CompanyMembershipAccess {
  companyId: string;
  roleKey: string;
  permissions: string[];
}

/** Perfil de acesso resolvido (e cacheado) para o usuário autenticado. */
export interface AccessProfile {
  userId: string;
  tenantId: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'BLOCKED' | 'DEACTIVATED';
  roles: string[];
  permissions: string[];
  isStaff: boolean;
  customerId: string | null;
  driverId: string | null;
  companies: CompanyMembershipAccess[];
}

/** Principal anexado a `request.user` pelo JwtAuthGuard. */
export interface AuthUser extends AccessProfile {
  /** Família do refresh token (identifica a sessão). */
  sessionId: string;
  can(permission: PermissionKey | string): boolean;
  canInCompany(companyId: string, permission: PermissionKey | string): boolean;
}

export function toAuthUser(profile: AccessProfile, sessionId: string): AuthUser {
  const permissions = new Set(profile.permissions);
  return {
    ...profile,
    sessionId,
    can: (permission) => permissions.has(permission),
    canInCompany: (companyId, permission) =>
      profile.companies.some((membership) => membership.companyId === companyId && membership.permissions.includes(permission)),
  };
}
