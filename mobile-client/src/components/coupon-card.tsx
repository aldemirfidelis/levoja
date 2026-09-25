import { View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { describeCoupon } from '@levoja/shared';
import { Badge, Card, formatBRL, formatDay, Icon, Row, space, Text, useColors, useToast } from '@levoja/mobile-kit';
import type { AvailableCoupon } from '@/lib/types';

/** Resumo das regras do cupom em uma linha. */
export function couponRules(coupon: AvailableCoupon): string {
  return [
    coupon.minOrderCents ? `pedido mín. ${formatBRL(coupon.minOrderCents)}` : null,
    coupon.firstOrderOnly ? '1ª compra' : null,
    coupon.segment ? coupon.segment.name : null,
    coupon.endsAt ? `até ${formatDay(coupon.endsAt)}` : null,
    coupon.usesLeft > 1 ? `${coupon.usesLeft} usos` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Cupom listado: toque copia o código (e abre a loja, se for de uma loja). */
export function CouponCard({ coupon, compact }: { coupon: AvailableCoupon; compact?: boolean }) {
  const colors = useColors();
  const toast = useToast();
  const locked = !!coupon.locked;
  const onPress = async () => {
    if (locked) {
      router.push('/conta/fidelidade');
      return;
    }
    await Clipboard.setStringAsync(coupon.code);
    toast.success(`Cupom ${coupon.code} copiado. Cole na sacola para usar.`);
    if (coupon.store) router.push(`/loja/${coupon.store.id}`);
  };
  return (
    <Card onPress={onPress} style={compact ? { width: 240 } : undefined}>
      <Row gap={3} align="flex-start" style={{ opacity: locked ? 0.7 : 1 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: locked ? colors.surface2 : colors.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={locked ? 'lock' : coupon.visibility === 'TIER' ? 'trophy' : 'coupon'} size={20} color={locked ? colors.muted : colors.brand} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="700" numberOfLines={1}>
            {describeCoupon(coupon, formatBRL)}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={compact ? 1 : 2}>
            {coupon.store ? coupon.store.tradeName : (coupon.description ?? 'Vale em lojas participantes')}
          </Text>
          {couponRules(coupon) ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {couponRules(coupon)}
            </Text>
          ) : null}
          <Row gap={2} style={{ marginTop: space(1) }}>
            <Badge label={coupon.code} tone={locked ? 'neutral' : 'brand'} />
            {locked ? <Text variant="caption" tone="warning">{coupon.locked}</Text> : null}
          </Row>
        </View>
      </Row>
    </Card>
  );
}
