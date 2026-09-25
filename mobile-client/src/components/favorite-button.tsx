import { Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { api, Icon, useApi, useColors, useInvalidate, useToast } from '@levoja/mobile-kit';
import { useQueryClient } from '@tanstack/react-query';

/** Coração de favoritar loja (atualiza na hora e desfaz se a API recusar). */
export function FavoriteButton({ companyId, size = 22 }: { companyId: string; size?: number }) {
  const colors = useColors();
  const toast = useToast();
  const client = useQueryClient();
  const invalidate = useInvalidate();
  const ids = useApi<string[]>('me/favorites/ids', undefined, { staleTime: 60_000 });
  const favorite = !!ids.data?.includes(companyId);

  const toggle = async () => {
    const key = ['me/favorites/ids', undefined];
    const previous = ids.data ?? [];
    client.setQueryData<string[]>(key, favorite ? previous.filter((id) => id !== companyId) : [companyId, ...previous]);
    void Haptics.selectionAsync().catch(() => undefined);
    try {
      if (favorite) await api.delete(`me/favorites/${companyId}`);
      else await api.put(`me/favorites/${companyId}`);
      void invalidate('me/favorites', 'me/home');
    } catch (error) {
      client.setQueryData(key, previous);
      toast.error(error);
    }
  };

  return (
    <Pressable
      onPress={toggle}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={favorite ? 'Remover das favoritas' : 'Adicionar às favoritas'}
      accessibilityState={{ selected: favorite }}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 2 })}
    >
      <Icon name={favorite ? 'favorite' : 'favoriteOutline'} size={size} color={favorite ? colors.danger : colors.muted} />
    </Pressable>
  );
}
