import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { describeCoupon } from '@levoja/shared';
import { formatBRL, Icon, radius, space, Text, useApi, useColors, useToast } from '@levoja/mobile-kit';
import type { AvailableCoupon } from '@/lib/types';

/** Cupons listados no app (públicos/nível liberado) de cada loja, para mostrar junto dos produtos dela. */
export function useStoreCoupons() {
  const coupons = useApi<AvailableCoupon[]>('me/coupons', undefined, { staleTime: 60_000 });
  return useMemo(() => {
    const byStore = new Map<string, AvailableCoupon[]>();
    for (const coupon of coupons.data ?? []) {
      if (!coupon.store || coupon.locked) continue;
      byStore.set(coupon.store.id, [...(byStore.get(coupon.store.id) ?? []), coupon]);
    }
    return byStore;
  }, [coupons.data]);
}

/** Regra principal do cupom, curta (pedido mínimo ou 1ª compra). */
export function couponCondition(coupon: AvailableCoupon): string | null {
  if (coupon.minOrderCents) return `acima de ${formatBRL(coupon.minOrderCents)}`;
  return coupon.firstOrderOnly ? 'na 1ª compra' : null;
}

/** Tom verde dos cupons (o laranja fica para as ações da marca). */
function useCouponColors() {
  const colors = useColors();
  return { fg: colors.success, soft: `${colors.success}1A`, line: `${colors.success}40` };
}

/** Um cupom em uma linha: ícone, desconto (+ condição) e o código à direita. Tocar copia o código. */
function CouponLine({ coupon }: { coupon: AvailableCoupon }) {
  const green = useCouponColors();
  const toast = useToast();
  const condition = couponCondition(coupon);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Cupom ${coupon.code}: ${describeCoupon(coupon, formatBRL)}${condition ? `, ${condition}` : ''}. Toque para copiar o código.`}
      onPress={async () => {
        await Clipboard.setStringAsync(coupon.code);
        toast.success(`Cupom ${coupon.code} copiado. Na sacola ele aparece para aplicar.`);
      }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space(2.5), opacity: pressed ? 0.7 : 1 })}
    >
      <Icon name="coupon" size={18} color={green.fg} />
      <View style={{ flex: 1 }}>
        <Text variant="caption" weight="800" numberOfLines={1} style={{ color: green.fg }}>
          {describeCoupon(coupon, formatBRL)}
        </Text>
        {condition ? (
          <Text variant="tiny" tone="muted" numberOfLines={1}>
            {condition}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1), borderWidth: 1, borderStyle: 'dashed', borderColor: green.fg, borderRadius: radius.sm, paddingHorizontal: space(2), paddingVertical: 3 }}>
        <Text variant="tiny" weight="900" numberOfLines={1} style={{ color: green.fg, letterSpacing: 0.5 }}>
          {coupon.code}
        </Text>
        <Icon name="copy" size={11} color={green.fg} />
      </View>
    </Pressable>
  );
}

/**
 * Cupons da loja em verde.
 * - `footer`: faixa no rodapé de um card (sem borda própria, o card recorta os cantos);
 * - `box`: bloco arredondado (tela do produto e cabeçalho da loja).
 */
export function StoreCoupons({ coupons, max = 1, variant = 'box' }: { coupons: AvailableCoupon[] | undefined; max?: number; variant?: 'footer' | 'box' }) {
  const green = useCouponColors();
  if (!coupons?.length) return null;
  const hidden = coupons.length - max;
  return (
    <View
      style={[
        { gap: space(2.5), backgroundColor: green.soft, paddingHorizontal: space(3.5), paddingVertical: space(2.5) },
        variant === 'footer' ? { borderTopWidth: 1, borderTopColor: green.line } : { borderRadius: radius.md },
      ]}
    >
      {coupons.slice(0, max).map((coupon) => (
        <CouponLine key={coupon.id} coupon={coupon} />
      ))}
      {hidden > 0 ? (
        <Text variant="tiny" weight="800" style={{ color: green.fg }}>
          + {hidden} {hidden === 1 ? 'cupom' : 'cupons'} desta loja
        </Text>
      ) : null}
    </View>
  );
}
