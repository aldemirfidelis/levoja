import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { formatBRL, Icon, radius, space, Text, useApi, useColors } from '@levoja/mobile-kit';
import type { Cart } from '@/lib/types';

/** Barra flutuante com a sacola aberta (uma por loja). Na loja, mostra apenas a sacola dela. */
export function CartBar({ companyId }: { companyId?: string }) {
  const colors = useColors();
  const { data } = useApi<Cart[]>('cart');
  const carts = (data ?? []).filter((cart) => cart.itemsCount > 0 && (!companyId || cart.companyId === companyId));
  if (!carts.length) return null;
  const cart = carts[0];
  return (
    <View style={{ position: 'absolute', left: space(4), right: space(4), bottom: space(4) }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(`/sacola/${cart.companyId}`)}
        style={({ pressed }) => ({ backgroundColor: pressed ? colors.brandPressed : colors.brand, borderRadius: radius.lg, padding: space(4), flexDirection: 'row', alignItems: 'center', gap: space(3), elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } })}
      >
        <Icon name="bag" size={22} color={colors.onBrand} />
        <View style={{ flex: 1 }}>
          <Text tone="onBrand" weight="700">
            Ver sacola · {cart.itemsCount} {cart.itemsCount === 1 ? 'item' : 'itens'}
          </Text>
          {!companyId && cart.company ? (
            <Text tone="onBrand" variant="caption" numberOfLines={1}>
              {cart.company.tradeName}
              {carts.length > 1 ? ` e mais ${carts.length - 1} loja(s)` : ''}
            </Text>
          ) : null}
        </View>
        <Text tone="onBrand" weight="800">
          {formatBRL(cart.subtotalCents)}
        </Text>
      </Pressable>
    </View>
  );
}
