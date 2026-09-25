import { isRunningInExpoGo } from 'expo';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { enqueuePoints, outbox, type LocationPoint } from './outbox';

export const LOCATION_TASK = 'levoja-driver-location';

/**
 * GPS em segundo plano só no build de desenvolvimento/produção. No Expo Go a tarefa chega a ser
 * registrada, mas o Android a dispara sem o app carregado e o Expo Go fecha sozinho (a cada leitura).
 */
export const backgroundTrackingSupported = !isRunningInExpoGo();

let lastPoint: LocationPoint | null = null;
let foregroundWatch: Location.LocationSubscription | null = null;
export type TrackingMode = 'background' | 'foreground' | 'off';
let mode: TrackingMode = 'off';
const modeListeners = new Set<(mode: TrackingMode) => void>();

function setMode(next: TrackingMode) {
  mode = next;
  modeListeners.forEach((listener) => listener(next));
}

export function onTrackingMode(listener: (mode: TrackingMode) => void): () => void {
  modeListeners.add(listener);
  listener(mode);
  return () => modeListeners.delete(listener);
}

export function lastKnownPoint(): LocationPoint | null {
  return lastPoint;
}

/** Converte leituras do GPS em pontos válidos para a API (descarta leituras muito imprecisas). */
export function toPoints(locations: Location.LocationObject[]): LocationPoint[] {
  return locations
    .filter((location) => location.coords.accuracy == null || location.coords.accuracy <= 150)
    .map((location) => ({
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      accuracy: location.coords.accuracy != null ? Math.min(10_000, Math.round(location.coords.accuracy)) : undefined,
      speed: location.coords.speed != null && location.coords.speed >= 0 ? Math.min(100, location.coords.speed) : undefined,
      heading: location.coords.heading != null && location.coords.heading >= 0 ? Math.min(360, location.coords.heading) : undefined,
      recordedAt: new Date(location.timestamp).toISOString(),
      // Android informa leituras de "localização simulada" (apps de GPS falso): a API trata como indício de fraude.
      ...(location.mocked ? { mocked: true } : {}),
    }));
}

export async function recordLocations(locations: Location.LocationObject[]) {
  const points = toPoints(locations);
  if (!points.length) return;
  lastPoint = points[points.length - 1];
  await enqueuePoints(points);
  await outbox.flush().catch(() => undefined);
}

// Registrado no escopo global (index.ts): o sistema pode acordar o app só para entregar posições.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  await recordLocations(data.locations);
});

export type PermissionResult = { ok: true; background: boolean } | { ok: false; reason: string };

/** Permissão de localização em uso (obrigatória) e em segundo plano (recomendada). */
export async function requestLocationPermissions(askBackground: boolean): Promise<PermissionResult> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) return { ok: false, reason: 'Sem acesso à localização não é possível receber entregas. Libere nas configurações do aparelho.' };
  if (!askBackground || !backgroundTrackingSupported) return { ok: true, background: backgroundTrackingSupported && (await Location.getBackgroundPermissionsAsync()).granted };
  const background = await Location.requestBackgroundPermissionsAsync().catch(() => ({ granted: false }));
  return { ok: true, background: background.granted };
}

export async function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  try {
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    await recordLocations([position]);
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch {
    return lastPoint ? { lat: lastPoint.lat, lng: lastPoint.lng } : null;
  }
}

/**
 * Inicia o acompanhamento: em segundo plano (serviço com notificação fixa no Android) quando
 * permitido; caso contrário, somente com o app aberto.
 */
export async function startTracking(): Promise<TrackingMode> {
  const background = backgroundTrackingSupported && (await Location.getBackgroundPermissionsAsync()).granted;
  if (background) {
    try {
      if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) {
        await Location.startLocationUpdatesAsync(LOCATION_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: 10_000,
          distanceInterval: 25,
          deferredUpdatesInterval: 15_000,
          pausesUpdatesAutomatically: false,
          activityType: Location.ActivityType.AutomotiveNavigation,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Você está online',
            notificationBody: 'Sua localização é usada para ofertas e para o acompanhamento das entregas.',
            notificationColor: '#FF5A1F',
            killServiceOnDestroy: false,
          },
        });
      }
      foregroundWatch?.remove();
      foregroundWatch = null;
      setMode('background');
      return 'background';
    } catch {
      // Serviço em segundo plano indisponível no aparelho — segue com o app aberto.
    }
  }
  if (!foregroundWatch) {
    foregroundWatch = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 25 },
      (location) => void recordLocations([location]),
    );
  }
  setMode('foreground');
  return 'foreground';
}

export async function stopTracking(): Promise<void> {
  foregroundWatch?.remove();
  foregroundWatch = null;
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
  }
  setMode('off');
}

// Expo Go: desfaz um registro em segundo plano deixado por versões anteriores do app.
if (!backgroundTrackingSupported) {
  void Promise.resolve()
    .then(() => Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))
    .then((started) => (started ? Location.stopLocationUpdatesAsync(LOCATION_TASK) : undefined))
    .catch(() => undefined);
}
