/**
 * Cálculos da navegação dentro do app: onde o entregador está sobre a rota, quanto falta para a
 * próxima manobra e para o destino, e se ele saiu da rota (para recalcular).
 */

export type LatLng = [number, number];

export interface NavStep {
  instruction: string;
  type: string;
  modifier: string | null;
  name: string;
  distanceM: number;
  durationS: number;
  location: LatLng;
}

export interface NavRoute {
  distanceM: number;
  durationS: number;
  geometry: LatLng[];
  steps: NavStep[];
  provider: 'osrm' | 'straight';
}

const EARTH_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rota preparada: distâncias acumuladas e a posição de cada manobra ao longo da linha. */
export interface PreparedRoute extends NavRoute {
  cumulative: number[];
  stepAlong: number[];
  lengthM: number;
}

export function prepareRoute(route: NavRoute): PreparedRoute {
  const cumulative = [0];
  for (let i = 1; i < route.geometry.length; i++) cumulative.push(cumulative[i - 1] + distanceM(route.geometry[i - 1], route.geometry[i]));
  const lengthM = cumulative[cumulative.length - 1] ?? 0;
  // Cada manobra fica num vértice da linha: procura o mais próximo, sempre para a frente.
  let from = 0;
  const stepAlong = route.steps.map((step, index) => {
    if (index === 0) return 0;
    if (index === route.steps.length - 1 && step.type === 'arrive') return lengthM;
    let best = from;
    let bestDistance = Infinity;
    for (let i = from; i < route.geometry.length; i++) {
      const d = distanceM(route.geometry[i], step.location);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
      if (bestDistance < 1) break;
    }
    from = best;
    return cumulative[best] ?? lengthM;
  });
  return { ...route, cumulative, stepAlong, lengthM };
}

export interface NavProgress {
  /** Índice do segmento da linha onde o entregador está (use como início da próxima busca). */
  segment: number;
  /** Distância percorrida sobre a rota. */
  alongM: number;
  /** Distância até a linha da rota (saiu da rota se for grande). */
  offRouteM: number;
  /** Próxima manobra (índice em `steps`) e a distância até ela. */
  nextStep: number;
  toNextM: number;
  remainingM: number;
  remainingS: number;
}

/** Projeta a posição na rota (busca a partir do último segmento; se longe, varre a rota toda). */
export function progressOn(route: PreparedRoute, position: LatLng, fromSegment = 0): NavProgress {
  const { geometry, cumulative } = route;
  const project = (start: number, end: number) => {
    let best = { segment: start, alongM: cumulative[start] ?? 0, offRouteM: Infinity };
    const cos = Math.cos(rad(position[0]));
    for (let i = start; i < Math.min(end, geometry.length - 1); i++) {
      const a = geometry[i];
      const b = geometry[i + 1];
      // Plano local em metros (suficiente para trechos curtos).
      const bx = (b[1] - a[1]) * cos * 111_320;
      const by = (b[0] - a[0]) * 110_540;
      const px = (position[1] - a[1]) * cos * 111_320;
      const py = (position[0] - a[0]) * 110_540;
      const len2 = bx * bx + by * by;
      const t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
      const dx = px - t * bx;
      const dy = py - t * by;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < best.offRouteM) best = { segment: i, alongM: cumulative[i] + t * (cumulative[i + 1] - cumulative[i]), offRouteM: d };
    }
    return best;
  };

  let best = geometry.length < 2 ? { segment: 0, alongM: 0, offRouteM: distanceM(position, geometry[0] ?? position) } : project(Math.max(0, fromSegment - 5), fromSegment + 150);
  if (geometry.length >= 2 && best.offRouteM > 60) {
    const everywhere = project(0, geometry.length);
    if (everywhere.offRouteM < best.offRouteM) best = everywhere;
  }

  let nextStep = route.steps.length - 1;
  for (let i = 1; i < route.steps.length; i++) {
    if (route.stepAlong[i] > best.alongM + 3) {
      nextStep = i;
      break;
    }
  }
  const remainingM = Math.max(0, route.lengthM - best.alongM);
  return {
    ...best,
    nextStep,
    toNextM: Math.max(0, (route.stepAlong[nextStep] ?? route.lengthM) - best.alongM),
    remainingM,
    remainingS: route.lengthM > 0 ? Math.round(route.durationS * (remainingM / route.lengthM)) : 0,
  };
}

/** "80 m", "350 m", "1,2 km" — arredondado como nos apps de navegação. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters < 100 ? Math.max(10, Math.round(meters / 10) * 10) : Math.round(meters / 50) * 50} m`;
  return `${(meters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: meters < 10_000 ? 1 : 0 })} km`;
}

/** Distância falada: "300 metros", "1,5 quilômetro". */
export function spokenDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(50, Math.round(meters / 50) * 50)} metros`;
  const km = Math.round(meters / 100) / 10;
  return `${km.toLocaleString('pt-BR')} ${km < 2 ? 'quilômetro' : 'quilômetros'}`;
}

/** Primeira letra minúscula ("Vire à direita" → "vire à direita"), para compor frases. */
export const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
