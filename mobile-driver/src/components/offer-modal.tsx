import { useEffect, useMemo, useState } from 'react';
import { Modal, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ITEM_CATEGORY_LABELS, VEHICLE_TYPE_LABELS } from '@levoja/shared';
import { api, Badge, Button, Chip, formatBRL, radius, Row, space, Stack, Text, useCountdown, useColors, useInvalidate, useToast } from '@levoja/mobile-kit';
import type { Offer } from '@/lib/types';

const DECLINE_REASONS = ['Muito longe', 'Valor baixo', 'Vou encerrar o turno', 'Veículo inadequado'];

/** Oferta em tela cheia com contador: aceitar leva direto para a entrega. */
export function OfferModal({ offer }: { offer: Offer | null }) {
  const colors = useColors();
  const toast = useToast();
  const invalidate = useInvalidate();
  const countdown = useCountdown(offer?.expiresAt ?? null);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [declining, setDeclining] = useState(false);
  const initialSeconds = useMemo(() => Math.max(1, offer?.secondsLeft ?? 30), [offer?.id]);

  useEffect(() => {
    setDeclining(false);
    if (offer) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [offer?.id]);

  if (!offer) return null;
  const fraction = countdown ? Math.min(1, countdown.seconds / initialSeconds) : 0;

  const accept = async () => {
    setBusy('accept');
    try {
      const delivery = await api.post<{ id: string }>(`drivers/me/offers/${offer.id}/accept`);
      await invalidate('drivers/me');
      router.push(`/entrega/${delivery.id}`);
    } catch (err) {
      toast.error(err);
      await invalidate('drivers/me/offers');
    } finally {
      setBusy(null);
    }
  };

  const decline = async (reason?: string) => {
    setBusy('decline');
    try {
      await api.post(`drivers/me/offers/${offer.id}/decline`, { reason });
    } catch {
      // oferta já expirou/cancelada: apenas atualiza
    } finally {
      setBusy(null);
      await invalidate('drivers/me/offers');
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => undefined}>
      <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space(5), gap: space(4) }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' }}>
            <View style={{ height: 6, width: `${fraction * 100}%`, backgroundColor: countdown && countdown.seconds <= 10 ? colors.danger : colors.brand }} />
          </View>
          <Row justify="space-between">
            <Text variant="heading">Nova entrega</Text>
            <Badge label={countdown?.expired ? 'Expirada' : `${countdown?.seconds ?? 0}s`} tone={countdown && countdown.seconds <= 10 ? 'danger' : 'brand'} />
          </Row>
          <Text variant="display" tone="success">
            {formatBRL(offer.payoutCents)}
          </Text>
          <Stack gap={1}>
            <Text>
              <Text weight="700">Coleta: </Text>
              {offer.pickupArea} · {offer.distanceToPickupKm.toLocaleString('pt-BR')} km de você
            </Text>
            <Text>
              <Text weight="700">Entrega: </Text>
              {offer.dropoffArea}
            </Text>
            <Text tone="muted">
              {offer.totalDistanceKm.toLocaleString('pt-BR')} km no total · ~{offer.estimatedMinutes} min · {ITEM_CATEGORY_LABELS[offer.itemCategory]}
              {offer.weightKg ? ` · ${offer.weightKg} kg` : ''} · {VEHICLE_TYPE_LABELS[offer.vehicleType]}
            </Text>
            {offer.paymentMethod === 'CASH' ? <Badge label="Cliente paga em dinheiro: receba na entrega" tone="warning" /> : null}
            {offer.notes ? <Text variant="caption" tone="muted">Obs.: {offer.notes}</Text> : null}
          </Stack>
          {declining ? (
            <Stack gap={2}>
              <Text weight="600">Por que recusar?</Text>
              <Row gap={2} style={{ flexWrap: 'wrap' }}>
                {DECLINE_REASONS.map((reason) => (
                  <Chip key={reason} label={reason} onPress={() => decline(reason)} />
                ))}
              </Row>
              <Button title="Voltar" variant="ghost" onPress={() => setDeclining(false)} />
            </Stack>
          ) : (
            <Row gap={3}>
              <Button title="Recusar" variant="secondary" onPress={() => setDeclining(true)} disabled={!!busy} style={{ flex: 1 }} size="lg" />
              <Button title="Aceitar" variant="success" onPress={accept} loading={busy === 'accept'} disabled={countdown?.expired} style={{ flex: 2 }} size="lg" />
            </Row>
          )}
        </View>
      </View>
    </Modal>
  );
}
