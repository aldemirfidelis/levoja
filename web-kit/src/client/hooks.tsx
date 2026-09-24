'use client';

import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient, UseQueryOptions } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';
import { api, ApiError } from './api';

export function ApiProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: (failures, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

type Query = Record<string, string | number | boolean | undefined | null>;

/** GET com cache, estados de carregamento/erro e revalidação. */
export function useApi<T>(path: string | null, query?: Query, options?: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'>) {
  return useQuery<T, ApiError>({
    queryKey: [path, query],
    queryFn: ({ signal }) => api.get<T>(path!, query, signal),
    enabled: !!path && (options?.enabled ?? true),
    ...options,
  });
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
