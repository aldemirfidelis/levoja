import { EmptyState, ErrorView, Loading, Screen, Stack, Text, useApi } from '@levoja/mobile-kit';
import { CouponCard } from '@/components/coupon-card';
import type { AvailableCoupon } from '@/lib/types';

export default function CouponsScreen() {
  const coupons = useApi<AvailableCoupon[]>('me/coupons');
  if (coupons.isLoading) return <Loading />;
  if (coupons.error) return <ErrorView error={coupons.error} onRetry={() => coupons.refetch()} />;
  const list = coupons.data ?? [];
  return (
    <Screen refreshing={coupons.isRefetching} onRefresh={() => void coupons.refetch()}>
      {list.length === 0 ? (
        <EmptyState icon="coupon" title="Nenhum cupom disponível agora" description="Fique de olho: novas promoções aparecem aqui e nas notificações." />
      ) : (
        <Stack gap={3}>
          <Text tone="muted">Toque no cupom para copiar o código e cole na sacola na hora de pagar.</Text>
          {list.map((coupon) => (
            <CouponCard key={coupon.id} coupon={coupon} />
          ))}
        </Stack>
      )}
    </Screen>
  );
}
