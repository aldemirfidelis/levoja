import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { BrandGradient, formatBRL, Icon, radius, space, Text, useApi } from '@levoja/mobile-kit';
import type { Cart } from '@/lib/types';

/**
 * Barra flutuante da sacola aberta (uma por loja), no degradê da marca: sacola, "Ver sacola · N itens",
 * a loja embaixo e o total à direita. Na loja, mostra apenas a sacola dela.
 */
export function CartBar({ companyId }: { companyId?: string }) {
  const { data } = useApi<Cart[]>('cart');
  const carts = (data ?? []).filter((cart) => cart.itemsCount > 0 && (!companyId || cart.companyId === companyId));
  if (!carts.length) return null;
  const cart = carts[0];
  const items = `${cart.itemsCount} ${cart.itemsCount === 1 ? 'item' : 'itens'}`;
  return (
    <View style={{ position: 'absolute', left: space(4), right: space(4), bottom: space(4) }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Ver sacola, ${items}, ${formatBRL(cart.subtotalCents)}`}
        onPress={() => router.push(`/sacola/${cart.companyId}`)}
        style={({ pressed }) => ({
          borderRadius: radius.xl,
          opacity: pressed ? 0.92 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
          elevation: 8,
          shadowColor: '#E8321A',
          shadowOpacity: 0.35,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        })}
      >
        <BrandGradient corner={radius.xl} style={{ flexDirection: 'row', alignItems: 'center', gap: space(3.5), paddingHorizontal: space(5), paddingVertical: space(4) }}>
          <Icon name="bag" size={26} color="#fff" />
          <View style={{ flex: 1 }}>
            <Text weight="800" numberOfLines={1} style={{ color: '#fff', fontSize: 17, lineHeight: 22 }}>
              Ver sacola · <Text weight="900" style={{ color: '#fff', fontSize: 17, lineHeight: 22 }}>{items}</Text>
            </Text>
            {!companyId && cart.company ? (
              <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.88)', fontSize: 14, lineHeight: 19 }}>
                {cart.company.tradeName}
                {carts.length > 1 ? ` e mais ${carts.length - 1} loja(s)` : ''}
              </Text>
            ) : null}
          </View>
          <Text weight="900" style={{ color: '#fff', fontSize: 19, lineHeight: 24 }}>
            {formatBRL(cart.subtotalCents)}
          </Text>
          <Icon name="chevronRight" size={20} color="#fff" />
        </BrandGradient>
      </Pressable>
    </View>
  );
}
