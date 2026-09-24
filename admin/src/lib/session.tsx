'use client';

import { createContext, ReactNode, useContext, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { onUnauthorized, session as sessionApi, useApi } from '@levoja/web-kit/client';
import { ErrorState, Spinner } from '@levoja/web-kit/ui';
import type { Me } from './types';

interface SessionValue {
  me: Me;
  can: (permission: string) => boolean;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data, error, refetch, isLoading } = useApi<Me>('auth/me');

  useEffect(() => onUnauthorized(() => router.replace('/login')), [router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="mx-auto max-w-md p-8">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }
  if (!data.isStaff) {
    return (
      <div className="mx-auto max-w-md p-8">
        <ErrorState error={new Error('Acesso restrito à equipe da plataforma.')} />
      </div>
    );
  }

  const permissions = new Set(data.permissions);
  const value: SessionValue = {
    me: data,
    can: (permission) => permissions.has(permission),
    logout: async () => {
      await sessionApi.logout().catch(() => undefined);
      router.replace('/login');
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession fora do SessionProvider');
  return value;
}

/** Renderiza o conteúdo apenas se o usuário tiver a permissão. */
export function Can({ permission, children, fallback = null }: { permission: string; children: ReactNode; fallback?: ReactNode }) {
  return useSession().can(permission) ? <>{children}</> : <>{fallback}</>;
}
