import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApi, type Query } from '@levoja/mobile-kit';

/**
 * Consulta com cópia no aparelho: se o app abrir sem internet, mostra os últimos dados conhecidos
 * (rota ativa, entrega em andamento) em vez de uma tela vazia.
 */
export function usePersistentApi<T>(path: string | null, query?: Query, options?: { refetchInterval?: number | false; enabled?: boolean }) {
  const key = path ? `levoja.cache.${path}${query ? `?${JSON.stringify(query)}` : ''}` : null;
  const [cached, setCached] = useState<T | undefined>(undefined);
  const result = useApi<T>(path, query, { refetchInterval: options?.refetchInterval, enabled: options?.enabled });

  useEffect(() => {
    if (!key) return;
    AsyncStorage.getItem(key)
      .then((raw) => raw && setCached(JSON.parse(raw) as T))
      .catch(() => undefined);
  }, [key]);

  useEffect(() => {
    if (key && result.data !== undefined) void AsyncStorage.setItem(key, JSON.stringify(result.data)).catch(() => undefined);
  }, [key, result.data]);

  return { ...result, data: result.data ?? cached, stale: result.data === undefined && cached !== undefined };
}
