import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import type { PartnerStatus } from '@levoja/shared';
import { api, ApiError, session, type TokenPair } from './api';
import { kitConfig } from './config';
import { tokenStore } from './token-store';

export interface UserView {
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
  preferences: Record<string, unknown> | null;
}

export interface Me {
  user: UserView;
  roles: string[];
  permissions: string[];
  customerId: string | null;
  driver: { id: string; status: PartnerStatus } | null;
}

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'unavailable';

type LoginResult = { mfaRequired: true; mfaToken: string } | { mfaRequired?: false };

interface AuthContextValue {
  status: AuthStatus;
  me: Me | null;
  /** Perfil vindo do cache (aparelho sem internet na abertura do app). */
  stale: boolean;
  login(login: string, password: string): Promise<LoginResult>;
  completeMfa(mfaToken: string, code: string): Promise<void>;
  /** Cadastro público que já devolve a sessão (cliente, entregador). */
  register(path: 'auth/register/customer' | 'auth/register/driver', body: Record<string, unknown>): Promise<void>;
  logout(): Promise<void>;
  reload(): Promise<void>;
  retry(): void;
  can(permission: string): boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const cacheKey = () => `levoja.me.${kitConfig().app.toLowerCase()}`;

export function AuthProvider({ children, onSignedIn, onBeforeLogout }: { children: ReactNode; onSignedIn?: (me: Me) => void; onBeforeLogout?: () => Promise<void> }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [stale, setStale] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const signedInRef = useRef(onSignedIn);
  signedInRef.current = onSignedIn;

  const apply = useCallback(async (profile: Me) => {
    setMe(profile);
    setStale(false);
    setStatus('signedIn');
    await AsyncStorage.setItem(cacheKey(), JSON.stringify(profile)).catch(() => undefined);
    signedInRef.current?.(profile);
  }, []);

  const signOutLocally = useCallback(async () => {
    await session.clear();
    await AsyncStorage.removeItem(cacheKey()).catch(() => undefined);
    queryClient.clear();
    setMe(null);
    setStatus('signedOut');
  }, [queryClient]);

  // Restaura a sessão ao abrir o app.
  useEffect(() => {
    let active = true;
    (async () => {
      setStatus('loading');
      if (!(await tokenStore.getRefreshToken())) return active && setStatus('signedOut');
      try {
        const profile = await api.get<Me>('auth/me');
        if (active) await apply(profile);
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.offline) {
          // Sem internet: abre com o perfil em cache (o app do entregador precisa funcionar offline).
          const cached = await AsyncStorage.getItem(cacheKey()).catch(() => null);
          if (cached) {
            setMe(JSON.parse(cached) as Me);
            setStale(true);
            setStatus('signedIn');
          } else {
            setStatus('unavailable');
          }
          return;
        }
        await signOutLocally();
      }
    })();
    return () => {
      active = false;
    };
  }, [apply, signOutLocally, attempt]);

  // Sessão revogada/expirada no servidor.
  useEffect(() => session.onSignedOut(() => void signOutLocally()), [signOutLocally]);

  const finish = useCallback(
    async (pair: TokenPair) => {
      await session.setTokens(pair);
      await apply(await api.get<Me>('auth/me'));
    },
    [apply],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      me,
      stale,
      async login(login, password) {
        const result = await api.public.post<(TokenPair & { mfaRequired?: false }) | { mfaRequired: true; mfaToken: string }>('auth/login', { login, password, app: kitConfig().app });
        if (result.mfaRequired) return { mfaRequired: true, mfaToken: result.mfaToken };
        await finish(result);
        return {};
      },
      async completeMfa(mfaToken, code) {
        await finish(await api.public.post<TokenPair>('auth/mfa/login', { mfaToken, code, app: kitConfig().app }));
      },
      async register(path, body) {
        await finish(await api.public.post<TokenPair>(path, body));
      },
      async logout() {
        try {
          await onBeforeLogout?.();
        } catch {
          // não impede a saída
        }
        const refreshToken = await tokenStore.getRefreshToken();
        if (refreshToken) await api.public.post('auth/logout', { refreshToken }).catch(() => undefined);
        await signOutLocally();
      },
      async reload() {
        await apply(await api.get<Me>('auth/me'));
      },
      retry: () => setAttempt((value) => value + 1),
      can: (permission) => !!me?.permissions.includes(permission),
    }),
    [status, me, stale, finish, apply, signOutLocally, onBeforeLogout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider ausente');
  return value;
}
