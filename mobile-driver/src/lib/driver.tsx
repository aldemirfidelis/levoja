import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as Haptics from 'expo-haptics';
import { api, ApiError, confirm, useApi, useInvalidate, useRealtimeEvent, useToast, type OutboxItem } from '@levoja/mobile-kit';
import { onOutboxDrop, outbox, sendDeliver, type DeliverPayload, type DeliveryAction } from './outbox';
import { currentPosition, onTrackingMode, requestLocationPermissions, startTracking, stopTracking, type TrackingMode } from './location';
import { usePersistentApi } from './cache';
import type { Dashboard, Offer } from './types';

const DISCLOSURE_KEY = 'levoja.driver.location-disclosure';

export type ActionResult = 'sent' | 'queued';

interface DriverContextValue {
  dashboard: Dashboard | undefined;
  online: boolean;
  trackingMode: TrackingMode;
  pendingSync: number;
  /** Ações ainda não enviadas (sem internet), por entrega. */
  pendingActions: readonly OutboxItem[];
  offers: Offer[];
  busy: boolean;
  goOnline(): Promise<void>;
  goOffline(): Promise<void>;
  refresh(): void;
  /** Ações da entrega: enviadas na hora ou guardadas para quando a conexão voltar. */
  runAction(deliveryId: string, action: DeliveryAction): Promise<ActionResult>;
  deliver(payload: DeliverPayload): Promise<ActionResult>;
  fail(deliveryId: string, reasonCode: string, details?: string): Promise<ActionResult>;
}

const DriverContext = createContext<DriverContextValue | null>(null);

export function DriverProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const dashboard = usePersistentApi<Dashboard>('drivers/me/dashboard', undefined, { refetchInterval: 30_000 });
  const online = !!dashboard.data && dashboard.data.availability !== 'OFFLINE';
  const offers = useApi<Offer[]>('drivers/me/offers', undefined, { enabled: online, refetchInterval: online ? 10_000 : false });
  const [trackingMode, setTrackingMode] = useState<TrackingMode>('off');
  const [pendingActions, setPendingActions] = useState<readonly OutboxItem[]>([]);
  const [busy, setBusy] = useState(false);
  const knownOffers = useRef(new Set<string>());

  useEffect(() => onTrackingMode(setTrackingMode), []);
  useEffect(() => outbox.subscribe((items) => setPendingActions(items.filter((item) => item.kind !== 'locations'))), []);
  useEffect(() => onOutboxDrop((message) => toast.error(new Error(message))), [toast]);

  // Envia pendências quando a internet volta, ao voltar para o app e periodicamente.
  useEffect(() => {
    const flush = () =>
      void outbox
        .flush()
        .then((result) => {
          if (result.sent) void invalidate('drivers/me');
        })
        .catch(() => undefined);
    const net = NetInfo.addEventListener((state) => state.isConnected && flush());
    const app = AppState.addEventListener('change', (state) => state === 'active' && flush());
    const timer = setInterval(flush, 30_000);
    flush();
    return () => {
      net();
      app.remove();
      clearInterval(timer);
    };
  }, [invalidate]);

  // Após reabrir o app: se estava online ou com entrega em andamento, retoma o GPS.
  useEffect(() => {
    if (!dashboard.data) return;
    const shouldTrack = dashboard.data.availability !== 'OFFLINE' || dashboard.data.activeDeliveries > 0;
    if (shouldTrack && trackingMode === 'off') void startTracking().catch(() => undefined);
    if (!shouldTrack && trackingMode !== 'off') void stopTracking();
  }, [dashboard.data, trackingMode]);

  // Nova oferta: vibra e atualiza (o push cobre o app em segundo plano).
  useRealtimeEvent<{ offerId: string }>('delivery.offer', (payload) => {
    if (!knownOffers.current.has(payload.offerId)) {
      knownOffers.current.add(payload.offerId);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    void offers.refetch();
  });
  useRealtimeEvent('delivery.updated', () => void invalidate('drivers/me'));

  const goOnline = useCallback(async () => {
    setBusy(true);
    try {
      let askBackground = false;
      const seen = await AsyncStorage.getItem(DISCLOSURE_KEY).catch(() => null);
      if (seen !== 'accepted') {
        askBackground = await confirm(
          'Uso da localização',
          'O LevoJá Entregador coleta a localização do aparelho, inclusive com o app fechado ou fora de uso, somente enquanto você estiver online ou com uma entrega em andamento. Ela é usada para oferecer entregas próximas, calcular rotas e mostrar ao cliente onde está o pedido. Ao ficar offline, a coleta para.',
          { confirmLabel: 'Entendi, continuar' },
        );
        if (askBackground) await AsyncStorage.setItem(DISCLOSURE_KEY, 'accepted').catch(() => undefined);
      } else {
        askBackground = true;
      }
      const permission = await requestLocationPermissions(askBackground);
      if (!permission.ok) return toast.error(new Error(permission.reason));
      const position = await currentPosition();
      await api.post('drivers/me/availability', { online: true, ...(position ?? {}) });
      const tracking = await startTracking();
      if (tracking === 'foreground') toast.info('Mantenha o app aberto: sem permissão de localização "o tempo todo", o GPS para em segundo plano.');
      await invalidate('drivers/me');
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }, [invalidate, toast]);

  const goOffline = useCallback(async () => {
    setBusy(true);
    try {
      await api.post('drivers/me/availability', { online: false });
      await stopTracking();
      await invalidate('drivers/me');
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }, [invalidate, toast]);

  const withQueue = useCallback(
    async (send: () => Promise<unknown>, queue: () => Promise<void>): Promise<ActionResult> => {
      try {
        // Pendências anteriores vão primeiro (a ordem importa: coletou → entregou).
        const pending = await outbox.flush();
        if (pending.blocked) throw new ApiError(0, 'offline', undefined, undefined, true);
        await send();
        await invalidate('drivers/me');
        return 'sent';
      } catch (error) {
        if (error instanceof ApiError && error.offline) {
          await queue();
          toast.info('Sem internet: a ação foi salva e será enviada automaticamente.');
          return 'queued';
        }
        throw error;
      }
    },
    [invalidate, toast],
  );

  const value = useMemo<DriverContextValue>(
    () => ({
      dashboard: dashboard.data,
      online,
      trackingMode,
      pendingSync: pendingActions.length,
      pendingActions,
      offers: offers.data ?? [],
      busy,
      goOnline,
      goOffline,
      refresh: () => void invalidate('drivers/me'),
      runAction: (deliveryId, action) =>
        withQueue(
          () => api.post(`drivers/me/deliveries/${deliveryId}/${action}`),
          () => outbox.enqueue('action', { deliveryId, action }),
        ),
      deliver: (payload) =>
        withQueue(
          () => sendDeliver(payload),
          () => outbox.enqueue('deliver', payload),
        ),
      fail: (deliveryId, reasonCode, details) =>
        withQueue(
          () => api.post(`drivers/me/deliveries/${deliveryId}/fail`, { reasonCode, details }),
          () => outbox.enqueue('fail', { deliveryId, reasonCode, details }),
        ),
    }),
    [dashboard.data, online, trackingMode, pendingActions, offers.data, busy, goOnline, goOffline, invalidate, withQueue],
  );

  return <DriverContext.Provider value={value}>{children}</DriverContext.Provider>;
}

export function useDriver(): DriverContextValue {
  const value = useContext(DriverContext);
  if (!value) throw new Error('DriverProvider ausente');
  return value;
}
