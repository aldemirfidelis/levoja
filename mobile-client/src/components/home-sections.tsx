import { useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { describeCoupon, ORDER_STATUS_LABELS } from '@levoja/shared';
import { api, Button, Card, formatBRL, formatDay, Icon, radius, Row, space, Text, useApi, useColors, useInvalidate, useToast } from '@levoja/mobile-kit';
import { CouponCard } from '@/components/coupon-card';
import type { HomeData, RecentOrder, StoreCard } from '@/lib/types';

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <Row justify="space-between">
      <Text variant="heading">{title}</Text>
      {action && onAction ? (
        <Text tone="brand" weight="600" onPress={onAction} accessibilityRole="link">
          {action}
        </Text>
      ) : null}
    </Row>
  );
}

function Logo({ uri, size = 48 }: { uri: string | null; size?: number }) {
  const colors = useColors();
  return uri ? (
    <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius.md }} accessibilityIgnoresInvertColors />
  ) : (
    <View style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="store" size={size / 2} color={colors.brand} />
    </View>
  );
}

function StoreTile({ store, badge }: { store: StoreCard; badge?: string }) {
  const colors = useColors();
  const outside = store.covered === false;
  return (
    <Pressable
      onPress={() => router.push(`/loja/${store.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => ({ width: 132, gap: 6, opacity: pressed ? 0.7 : store.isOpenNow && !outside ? 1 : 0.55 })}
    >
      <Logo uri={store.logoUrl} size={132} />
      {badge ? (
        <View style={{ position: 'absolute', top: 8, left: 8, backgroundColor: colors.brand, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text variant="caption" weight="700" style={{ color: colors.onBrand }}>
            {badge}
          </Text>
        </View>
      ) : null}
      <Text weight="600" numberOfLines={1}>
        {store.tradeName}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {outside ? 'Fora da sua região' : !store.isOpenNow ? 'Fechada' : store.estimatedMinutes ? `${store.estimatedMinutes.min}-${store.estimatedMinutes.max} min` : store.segment.name}
      </Text>
    </Pressable>
  );
}

function RecentOrderCard({ order }: { order: RecentOrder }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const reorder = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ companyId: string; added: number; skipped: string[] }>(`me/orders/${order.id}/reorder`);
      await invalidate('cart');
      if (!result.added) {
        toast.info('Os itens deste pedido não estão mais disponíveis.');
        return;
      }
      if (result.skipped.length) toast.info(`Indisponíveis agora: ${result.skipped.join(', ')}.`);
      router.push(`/sacola/${result.companyId}`);
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ width: 280 }} onPress={() => router.push(`/pedido/${order.id}`)}>
      <Row gap={3} align="flex-start">
        <Logo uri={order.store.logoUrl} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="700" numberOfLines={1}>
            {order.store.tradeName}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {order.summary}
          </Text>
          <Text variant="caption" tone="muted">
            #{order.number} · {formatDay(order.createdAt)} · {ORDER_STATUS_LABELS[order.status]}
          </Text>
        </View>
      </Row>
      <Button title="Pedir de novo" icon="refresh" size="sm" variant="secondary" loading={busy} onPress={reorder} style={{ marginTop: space(3) }} />
    </Card>
  );
}

/** Seções personalizadas do início: fidelidade/indicação, pedir de novo, favoritas, promoções e cupons. */
export function HomeSections({ addressId }: { addressId: string }) {
  const colors = useColors();
  const home = useApi<HomeData>('me/home', { addressId });
  const data = home.data;
  if (!data) return null;
  const hasAny = data.loyalty || data.referral || data.recentOrders.length || data.favorites.length || data.promotions.length || data.coupons.length;
  if (!hasAny) return null;
  const horizontal = { gap: space(3), paddingRight: space(4) };

  return (
    <View style={{ gap: space(5) }}>
      {data.loyalty || data.referral ? (
        <Row gap={3} align="stretch">
          {data.loyalty ? (
            <Card style={{ flex: 1 }} onPress={() => router.push('/conta/fidelidade')}>
              <Row gap={2}>
                <Icon name="trophy" size={20} color={colors.warning} />
                <Text weight="700">{data.loyalty.tier.name}</Text>
              </Row>
              <Text variant="caption" tone="muted">
                {data.loyalty.points.toLocaleString('pt-BR')} pontos{data.loyalty.redeemableCents ? ` · vale ${formatBRL(data.loyalty.redeemableCents)}` : ''}
              </Text>
            </Card>
          ) : null}
          {data.referral ? (
            <Card style={{ flex: 1 }} onPress={() => router.push('/conta/indique')}>
              <Row gap={2}>
                <Icon name="gift" size={20} color={colors.brand} />
                <Text weight="700">Indique e ganhe</Text>
              </Row>
              <Text variant="caption" tone="muted">
                {formatBRL(data.referral.referrerRewardCents)} por amigo
              </Text>
            </Card>
          ) : null}
        </Row>
      ) : null}

      {data.recentOrders.length ? (
        <View style={{ gap: space(3) }}>
          <SectionHeader title="Pedir de novo" action="Ver pedidos" onAction={() => router.push('/pedidos')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={horizontal}>
            {data.recentOrders.map((order) => (
              <RecentOrderCard key={order.id} order={order} />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {data.favorites.length ? (
        <View style={{ gap: space(3) }}>
          <SectionHeader title="Suas favoritas" action="Ver todas" onAction={() => router.push('/conta/favoritas')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={horizontal}>
            {data.favorites.map((store) => (
              <StoreTile key={store.id} store={store} />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {data.promotions.length ? (
        <View style={{ gap: space(3) }}>
          <SectionHeader title="Promoções perto de você" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={horizontal}>
            {data.promotions.map(({ store, coupons }) => (
              <StoreTile key={store.id} store={store} badge={describeCoupon(coupons[0], formatBRL)} />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {data.coupons.length ? (
        <View style={{ gap: space(3) }}>
          <SectionHeader title="Cupons para você" action="Ver todos" onAction={() => router.push('/conta/cupons')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={horizontal}>
            {data.coupons.map((coupon) => (
              <CouponCard key={coupon.id} coupon={coupon} compact />
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
