'use client';

import { createContext, ReactNode, useContext, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { onUnauthorized, session, useApi } from '@levoja/web-kit/client';
import { ErrorState, Spinner } from '@levoja/web-kit/ui';
import type { PartnerStatus } from '@levoja/shared';

export interface PortalMe {
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    cpfMasked: string | null;
    birthDate: string | null;
    avatarUrl: string | null;
    emailVerified: boolean;
    phoneVerified: boolean;
    mfaEnabled: boolean;
    preferences: { theme?: string } | null;
  };
  roles: string[];
  permissions: string[];
  customerId: string | null;
  driver: { id: string; status: PartnerStatus } | null;
  companies: { id: string; tradeName: string; status: PartnerStatus; role: { key: string; name: string }; permissions: string[] }[];
}

interface Value {
  me: PortalMe;
  refresh: () => void;
  logout: () => Promise<void>;
  canInCompany: (companyId: string, permission: string) => boolean;
}

const Ctx = createContext<Value | null>(null);

export function PortalSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data, error, isLoading, refetch } = useApi<PortalMe>('auth/me');
  useEffect(() => onUnauthorized(() => router.replace(`/entrar?next=${encodeURIComponent(window.location.pathname)}`)), [router]);

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-muted">
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

  const value: Value = {
    me: data,
    refresh: () => void refetch(),
    logout: async () => {
      await session.logout().catch(() => undefined);
      router.replace('/');
      router.refresh();
    },
    canInCompany: (companyId, permission) => !!data.companies.find((c) => c.id === companyId)?.permissions.includes(permission),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePortal(): Value {
  const value = useContext(Ctx);
  if (!value) throw new Error('usePortal fora do PortalSessionProvider');
  return value;
}
