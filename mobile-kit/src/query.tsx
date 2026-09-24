import { ReactNode, useEffect, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { api, ApiError, type Paginated, type Query } from './api';

// Conectividade real do aparelho controla pausas/retomadas das consultas.
onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)));

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      },
      mutations: { retry: false },
    },
  });
}

/** Provider de dados: revalida ao voltar para o app (foco). */
export function QueryProvider({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [queryClient] = useState(() => client ?? createQueryClient());
  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      if (Platform.OS !== 'web') focusManager.setFocused(status === 'active');
    };
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, []);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function useApi<T>(path: string | null, query?: Query, options?: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'>) {
  return useQuery<T, ApiError>({
    queryKey: [path, query],
    queryFn: ({ signal }) => api.get<T>(path!, query, signal),
    enabled: !!path && (options?.enabled ?? true),
    ...options,
  });
}

/** Lista paginada com rolagem infinita. */
export function useInfiniteApi<T>(path: string | null, query?: Query, pageSize = 20) {
  const result = useInfiniteQuery<Paginated<T>, ApiError>({
    queryKey: [path, query, 'infinite'],
    queryFn: ({ pageParam, signal }) => api.get<Paginated<T>>(path!, { ...query, page: pageParam as number, pageSize }, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
    enabled: !!path,
  });
  const items = result.data?.pages.flatMap((page) => page.data) ?? [];
  return { ...result, items, total: result.data?.pages[0]?.meta.total ?? 0 };
}

/** Mutação que invalida as consultas cujo caminho começa com algum dos prefixos informados. */
export function useApiMutation<TInput, TOutput = unknown>(fn: (input: TInput) => Promise<TOutput>, invalidate: string[] = []) {
  const client = useQueryClient();
  return useMutation<TOutput, ApiError, TInput>({
    mutationFn: fn,
    onSuccess: async () => {
      await client.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && invalidate.some((prefix) => key.startsWith(prefix));
        },
      });
    },
  });
}

/** Invalida consultas por prefixo de caminho (eventos em tempo real, notificações). */
export function useInvalidate() {
  const client = useQueryClient();
  return (...prefixes: string[]) =>
    client.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && prefixes.some((prefix) => key.startsWith(prefix));
      },
    });
}
