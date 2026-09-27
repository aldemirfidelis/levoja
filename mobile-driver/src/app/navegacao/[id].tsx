import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { router, Stack as RouterStack, useLocalSearchParams } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, brandColors, Button, Icon, type IconName, LiveMap, radius, Row, space, Text, useColors, useToast } from '@levoja/mobile-kit';
import { ManeuverIcon } from '@/components/maneuver-icon';
import { usePersistentApi } from '@/lib/cache';
import { useDriver } from '@/lib/driver';
import { lastKnownPoint } from '@/lib/location';
import { distanceM, formatDistance, type LatLng, lowerFirst, type NavRoute, prepareRoute, type PreparedRoute, progressOn, spokenDistance } from '@/lib/nav-geometry';
import { openExternalNavigation } from '@/lib/navigation';
import type { DriverDelivery } from '@/lib/types';

/** Aviso antecipado da manobra, aviso na hora, chegada e desvio de rota (metros). */
const FAR_M = 400;
const NEAR_M = 60;
const ARRIVED_M = 40;
const OFF_ROUTE_M = 40;
const REROUTE_GAP_MS = 12_000;

interface Fix {
  point: LatLng;
  heading: number | null;
  accuracy: number | null;
  speed: number | null;
}

function RoundButton({ icon, label, onPress, active }: { icon: IconName; label: string; onPress: () => void; active?: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? colors.brandSoft : colors.surface2, opacity: pressed ? 0.7 : 1 })}
    >
      <Icon name={icon} size={22} color={active ? colors.brand : colors.fg} />
    </Pressable>
  );
}

/**
 * Navegação curva a curva dentro do app (sem abrir Waze/Google Maps): mapa seguindo o entregador,
 * próxima manobra com distância, instruções por voz em português, recálculo automático ao sair da
 * rota e o botão "Cheguei" no final.
 */
export default function NavigationScreen() {
  useKeepAwake();
  const { id, to } = useLocalSearchParams<{ id: string; to?: string }>();
  const target: 'pickup' | 'dropoff' = to === 'pickup' ? 'pickup' : 'dropoff';
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const driver = useDriver();
  const delivery = usePersistentApi<DriverDelivery>(`drivers/me/deliveries/${id}`, undefined, { refetchInterval: 30_000 });
  const stop = delivery.data?.[target];

  const [fix, setFix] = useState<Fix | null>(() => {
    const last = lastKnownPoint();
    return last ? { point: [last.lat, last.lng], heading: null, accuracy: null, speed: null } : null;
  });
  const [route, setRoute] = useState<PreparedRoute | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [muted, setMuted] = useState(false);
  const [recenterKey, setRecenterKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const segment = useRef(0);
  const announced = useRef(new Set<string>());
  const offRouteCount = useRef(0);
  const lastFetch = useRef(0);
  const started = useRef(false);

  const say = useCallback((text: string | undefined) => {
    if (!text || mutedRef.current) return;
    Speech.stop();
    Speech.speak(text, { language: 'pt-BR', rate: 1.02 });
  }, []);
  useEffect(() => () => void Speech.stop(), []);

  // GPS em alta precisão enquanto a navegação está aberta; bússola quando parado (sem direção do GPS).
  useEffect(() => {
    let cancelled = false;
    const subscriptions: { remove(): void }[] = [];
    void (async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted && !(await Location.requestForegroundPermissionsAsync()).granted) {
        setRouteError('Permita o acesso à localização para navegar.');
        return;
      }
      const position = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 2 }, (location) => {
        if (cancelled) return;
        const moving = (location.coords.speed ?? 0) > 1.5 && location.coords.heading != null && location.coords.heading >= 0;
        setFix((previous) => ({
          point: [location.coords.latitude, location.coords.longitude],
          heading: moving ? location.coords.heading : (previous?.heading ?? null),
          accuracy: location.coords.accuracy,
          speed: location.coords.speed,
        }));
      });
      subscriptions.push(position);
      const heading = await Location.watchHeadingAsync((value) => {
        const degrees = value.trueHeading >= 0 ? value.trueHeading : value.magHeading;
        setFix((previous) => {
          if (!previous || (previous.speed ?? 0) > 1.5) return previous;
          if (previous.heading != null && Math.abs(((degrees - previous.heading + 540) % 360) - 180) < 8) return previous;
          return { ...previous, heading: degrees };
        });
      }).catch(() => null);
      if (heading) subscriptions.push(heading);
      if (cancelled) subscriptions.forEach((subscription) => subscription.remove());
    })();
    return () => {
      cancelled = true;
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, []);

  const fetchRoute = useCallback(
    async (from: LatLng, reason: 'start' | 'reroute') => {
      if (!stop) return;
      lastFetch.current = Date.now();
      setLoadingRoute(true);
      try {
        const data = await api.get<NavRoute>('drivers/me/navigation', { fromLat: from[0], fromLng: from[1], toLat: stop.lat, toLng: stop.lng });
        const prepared = prepareRoute(data);
        segment.current = 0;
        announced.current = new Set();
        offRouteCount.current = 0;
        setRoute(prepared);
        setRouteError(null);
        say(reason === 'start' ? prepared.steps[0]?.instruction : 'Rota recalculada');
      } catch {
        setRouteError('Não foi possível calcular a rota. Confira a internet e tente de novo.');
      } finally {
        setLoadingRoute(false);
      }
    },
    [stop, say],
  );

  // Primeira rota assim que houver GPS e destino.
  useEffect(() => {
    if (started.current || !fix || !stop) return;
    started.current = true;
    void fetchRoute(fix.point, 'start');
  }, [fix, stop, fetchRoute]);

  // Indo para a entrega depois de coletar: a navegação já conta como "iniciar rota".
  const startedRoute = useRef(false);
  useEffect(() => {
    if (startedRoute.current || target !== 'dropoff' || delivery.data?.status !== 'PICKED_UP') return;
    startedRoute.current = true;
    void driver.runAction(delivery.data.id, 'start-route').catch(() => undefined);
  }, [target, delivery.data?.status, delivery.data?.id, driver]);

  const progress = useMemo(() => (route && fix ? progressOn(route, fix.point, segment.current) : null), [route, fix]);
  const toDestination = fix && stop ? distanceM(fix.point, [stop.lat, stop.lng]) : null;
  const arrived = toDestination != null && toDestination <= ARRIVED_M;

  // Voz, chegada e recálculo a cada nova posição.
  useEffect(() => {
    if (!route || !progress || !fix) return;
    segment.current = progress.segment;

    if (arrived) {
      if (!announced.current.has('arrived')) {
        announced.current.add('arrived');
        say(target === 'pickup' ? 'Você chegou ao local de coleta' : 'Você chegou ao destino');
      }
      return;
    }

    const tolerance = Math.max(OFF_ROUTE_M, fix.accuracy ?? 0);
    offRouteCount.current = progress.offRouteM > tolerance ? offRouteCount.current + 1 : 0;
    if (offRouteCount.current >= 3 && Date.now() - lastFetch.current > REROUTE_GAP_MS && !loadingRoute) {
      say('Recalculando rota');
      void fetchRoute(fix.point, 'reroute');
      return;
    }

    const step = route.steps[progress.nextStep];
    if (!step || step.type === 'arrive') return;
    const key = String(progress.nextStep);
    if (progress.toNextM <= NEAR_M && !announced.current.has(`${key}:near`)) {
      announced.current.add(`${key}:near`).add(`${key}:far`);
      say(step.instruction);
    } else if (progress.toNextM <= FAR_M && progress.toNextM > NEAR_M + 60 && !announced.current.has(`${key}:far`)) {
      announced.current.add(`${key}:far`);
      say(`Em ${spokenDistance(progress.toNextM)}, ${lowerFirst(step.instruction)}`);
    }
  }, [route, progress, fix, arrived, target, say, fetchRoute, loadingRoute]);

  const arrive = async () => {
    const status = delivery.data?.status;
    const action = target === 'pickup' ? (status === 'DRIVER_ASSIGNED' ? 'arrived-pickup' : null) : status === 'IN_TRANSIT' ? 'arrived-dropoff' : null;
    if (action && delivery.data) {
      setBusy(true);
      try {
        await driver.runAction(delivery.data.id, action);
      } catch (error) {
        toast.error(error);
      } finally {
        setBusy(false);
      }
    }
    router.back();
  };

  const next = progress && route ? route.steps[progress.nextStep] : null;
  const after = progress && route ? route.steps[progress.nextStep + 1] : null;
  const eta = progress ? new Date(Date.now() + progress.remainingS * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;
  const destinationLabel = stop ? stop.name || `${stop.street}, ${stop.number}` : '';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <RouterStack.Screen options={{ headerShown: false }} />
      <LiveMap
        points={[
          ...(fix ? [{ id: 'me', kind: 'nav' as const, lat: fix.point[0], lng: fix.point[1], heading: fix.heading }] : []),
          ...(stop ? [{ id: 'destino', kind: target, lat: stop.lat, lng: stop.lng }] : []),
        ]}
        path={route?.geometry}
        follow={fix ? 'me' : undefined}
        followZoom={17}
        recenterKey={recenterKey}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, height: '100%', borderRadius: 0 }}
      />

      {/* Próxima manobra */}
      <View style={{ position: 'absolute', top: insets.top + space(2), left: space(3), right: space(3), gap: space(2) }}>
        {arrived ? (
          <View style={{ backgroundColor: colors.success, borderRadius: radius.xl, padding: space(4), flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
            <Icon name="flag" size={40} color="#fff" />
            <Text weight="900" style={{ color: '#fff', fontSize: 22, lineHeight: 28, flex: 1 }}>
              {target === 'pickup' ? 'Você chegou à coleta' : 'Você chegou ao destino'}
            </Text>
          </View>
        ) : next && progress ? (
          <View style={{ backgroundColor: brandColors.noite, borderRadius: radius.xl, padding: space(4), flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
            <ManeuverIcon type={next.type} modifier={next.modifier} size={58} />
            <View style={{ flex: 1 }}>
              <Text weight="900" style={{ color: '#fff', fontSize: 32, lineHeight: 38 }}>
                {formatDistance(progress.toNextM)}
              </Text>
              <Text weight="700" numberOfLines={2} style={{ color: '#fff', fontSize: 17, lineHeight: 22 }}>
                {next.instruction}
              </Text>
            </View>
          </View>
        ) : (
          <View style={{ backgroundColor: brandColors.noite, borderRadius: radius.xl, padding: space(4), flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
            {routeError ? <Icon name="alert" size={28} color="#fff" /> : <ActivityIndicator color="#fff" />}
            <Text weight="700" style={{ color: '#fff', flex: 1 }}>
              {routeError ?? (fix ? 'Calculando a rota...' : 'Procurando o sinal do GPS...')}
            </Text>
            {routeError && fix ? <Button title="Tentar" size="sm" onPress={() => void fetchRoute(fix.point, 'start')} /> : null}
          </View>
        )}
        {!arrived && after && after.type !== 'arrive' && progress && progress.toNextM < 800 ? (
          <View style={{ alignSelf: 'flex-start', backgroundColor: '#0E1320', borderRadius: radius.lg, paddingHorizontal: space(3), paddingVertical: space(2), flexDirection: 'row', alignItems: 'center', gap: space(2), maxWidth: '100%' }}>
            <ManeuverIcon type={after.type} modifier={after.modifier} size={20} />
            <Text weight="700" numberOfLines={1} style={{ color: '#fff', flexShrink: 1 }}>
              Depois: {lowerFirst(after.instruction)}
            </Text>
          </View>
        ) : null}
        {route?.provider === 'straight' ? (
          <View style={{ alignSelf: 'flex-start', backgroundColor: colors.warning, borderRadius: radius.lg, paddingHorizontal: space(3), paddingVertical: space(1.5) }}>
            <Text variant="caption" weight="800" style={{ color: '#fff' }}>
              Rota aproximada: serviço de rotas indisponível
            </Text>
          </View>
        ) : null}
      </View>

      {/* Chegada prevista, destino e ações */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          paddingHorizontal: space(4),
          paddingTop: space(4),
          paddingBottom: insets.bottom + space(3),
          gap: space(3),
          elevation: 12,
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowRadius: 12,
        }}
      >
        <Row justify="space-between">
          <View style={{ flex: 1 }}>
            {progress && eta ? (
              <>
                <Text weight="900" style={{ fontSize: 28, lineHeight: 34, color: colors.success }}>
                  {eta}
                </Text>
                <Text tone="muted" weight="600">
                  {Math.max(1, Math.round(progress.remainingS / 60))} min · {formatDistance(progress.remainingM)}
                </Text>
              </>
            ) : (
              <Text tone="muted">Chegada prevista em instantes...</Text>
            )}
          </View>
          <Row gap={2}>
            <RoundButton
              icon={muted ? 'volumeOff' : 'volume'}
              label={muted ? 'Ativar voz' : 'Silenciar voz'}
              active={!muted}
              onPress={() => {
                if (!muted) Speech.stop();
                setMuted(!muted);
              }}
            />
            <RoundButton icon="myLocation" label="Centralizar no mapa" onPress={() => setRecenterKey((value) => value + 1)} />
          </Row>
        </Row>
        <Text numberOfLines={1}>
          <Text weight="800">{target === 'pickup' ? 'Coleta: ' : 'Entrega: '}</Text>
          {destinationLabel}
        </Text>
        <Row gap={3}>
          <Button title="Sair" variant="secondary" onPress={() => router.back()} style={{ flex: 1 }} />
          <Button title={target === 'pickup' ? 'Cheguei na coleta' : 'Cheguei no destino'} icon="flag" variant={arrived ? 'success' : 'dark'} loading={busy} onPress={() => void arrive()} style={{ flex: 2 }} />
        </Row>
        {stop ? (
          <Text tone="brand" weight="700" align="center" onPress={() => openExternalNavigation(stop)} accessibilityRole="link">
            Abrir em outro app (Waze, Google Maps)
          </Text>
        ) : null}
      </View>
    </View>
  );
}
