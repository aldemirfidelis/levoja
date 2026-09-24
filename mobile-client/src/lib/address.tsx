import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApi } from '@levoja/mobile-kit';
import type { Address } from './types';

const KEY = 'levoja.selected-address';

interface AddressContextValue {
  addresses: Address[];
  selected: Address | null;
  isLoading: boolean;
  select(id: string): void;
  refresh(): Promise<unknown>;
}

const AddressContext = createContext<AddressContextValue | null>(null);

/** Endereço de entrega em uso (lojas e fretes são calculados a partir dele). */
export function AddressProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, refetch } = useApi<Address[]>('me/addresses');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((id) => id && setSelectedId(id))
      .catch(() => undefined);
  }, []);

  const addresses = useMemo(() => data ?? [], [data]);
  const selected = useMemo(
    () => addresses.find((address) => address.id === selectedId) ?? addresses.find((address) => address.isDefault) ?? addresses[0] ?? null,
    [addresses, selectedId],
  );

  const select = useCallback((id: string) => {
    setSelectedId(id);
    void AsyncStorage.setItem(KEY, id).catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ addresses, selected, isLoading, select, refresh: refetch }), [addresses, selected, isLoading, select, refetch]);
  return <AddressContext.Provider value={value}>{children}</AddressContext.Provider>;
}

export function useAddress(): AddressContextValue {
  const value = useContext(AddressContext);
  if (!value) throw new Error('AddressProvider ausente');
  return value;
}

export const addressLine = (address: Pick<Address, 'street' | 'number' | 'district' | 'city'>) =>
  `${address.street}, ${address.number}${address.district ? ` · ${address.district}` : ''}`;
