import { haversineKm, VEHICLE_CAPACITY_KG, VEHICLE_RANK, type LatLng, type VehicleType } from '@levoja/shared';

export interface RouteStop extends LatLng {
  id: string;
  weightKg: number;
  vehicleType: VehicleType;
}

export interface PlannedRoute {
  vehicleType: VehicleType;
  /** Paradas na ordem de visita. */
  stopIds: string[];
  /** Distância estimada (coleta → paradas), em km por ruas. */
  distanceKm: number;
  /** Tempo estimado de percurso + atendimento em cada parada. */
  durationMin: number;
  weightKg: number;
}

export interface PlanOptions {
  maxStops: number;
  /** Minutos de atendimento por parada (estacionar, entregar, comprovar). */
  serviceMinutes?: number;
  /** Paradas muito distantes da coleta viram rotas próprias (evita rotas que cruzam a cidade). */
  maxLegKm?: number;
}

/** Distância real por ruas ≈ linha reta × 1,35 (mesmo fator da estimativa de mapas). */
const DETOUR = 1.35;
const SPEED_KMH: Record<VehicleType, number> = { BICYCLE: 14, MOTORCYCLE: 26, CAR: 22, VAN: 20 };

const legKm = (a: LatLng, b: LatLng) => haversineKm(a, b) * DETOUR;

/** Comprimento de um caminho aberto que começa na coleta. */
export function pathKm(start: LatLng, stops: LatLng[]): number {
  let total = 0;
  let current = start;
  for (const stop of stops) {
    total += legKm(current, stop);
    current = stop;
  }
  return total;
}

/** Ordem de visita: vizinho mais próximo a partir da coleta, refinado por 2-opt. */
export function orderStops<T extends LatLng>(start: LatLng, stops: T[]): T[] {
  const remaining = [...stops];
  const ordered: T[] = [];
  let current: LatLng = start;
  while (remaining.length) {
    let best = 0;
    for (let index = 1; index < remaining.length; index++) {
      if (legKm(current, remaining[index]) < legKm(current, remaining[best])) best = index;
    }
    current = remaining[best];
    ordered.push(remaining.splice(best, 1)[0]);
  }
  // 2-opt em caminho aberto: inverte trechos enquanto houver ganho.
  let improved = ordered.length > 3;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < ordered.length - 1; i++) {
      for (let k = i + 1; k < ordered.length; k++) {
        const before = i === 0 ? start : ordered[i - 1];
        const after = ordered[k + 1];
        const current = legKm(before, ordered[i]) + (after ? legKm(ordered[k], after) : 0);
        const swapped = legKm(before, ordered[k]) + (after ? legKm(ordered[i], after) : 0);
        if (swapped + 1e-9 < current) {
          const reversed = ordered.slice(i, k + 1).reverse();
          ordered.splice(i, k - i + 1, ...reversed);
          improved = true;
        }
      }
    }
  }
  return ordered;
}

/**
 * Planeja rotas a partir de uma coleta comum (varredura angular):
 * 1. agrupa por porte de veículo exigido;
 * 2. ordena as paradas pelo ângulo em torno da coleta (vizinhas ficam juntas);
 * 3. corta em rotas respeitando número de paradas, capacidade de carga e trechos longos;
 * 4. ordena cada rota (vizinho mais próximo + 2-opt).
 */
export function planRoutes(pickup: LatLng, stops: RouteStop[], options: PlanOptions): PlannedRoute[] {
  const maxStops = Math.max(1, options.maxStops);
  const service = options.serviceMinutes ?? 4;
  const byVehicle = new Map<VehicleType, RouteStop[]>();
  for (const stop of stops) {
    const list = byVehicle.get(stop.vehicleType) ?? [];
    list.push(stop);
    byVehicle.set(stop.vehicleType, list);
  }

  const routes: PlannedRoute[] = [];
  const vehicles = [...byVehicle.keys()].sort((a, b) => VEHICLE_RANK[a] - VEHICLE_RANK[b]);
  for (const vehicle of vehicles) {
    const angle = (stop: LatLng) => Math.atan2(stop.lat - pickup.lat, (stop.lng - pickup.lng) * Math.cos((pickup.lat * Math.PI) / 180));
    const sorted = [...byVehicle.get(vehicle)!].sort((a, b) => angle(a) - angle(b));
    const capacity = VEHICLE_CAPACITY_KG[vehicle];
    const groups: RouteStop[][] = [];
    let group: RouteStop[] = [];
    let weight = 0;
    for (const stop of sorted) {
      const far = options.maxLegKm != null && group.length > 0 && legKm(group[group.length - 1], stop) > options.maxLegKm;
      if (group.length >= maxStops || weight + stop.weightKg > capacity || far) {
        groups.push(group);
        group = [];
        weight = 0;
      }
      group.push(stop);
      weight += stop.weightKg;
    }
    if (group.length) groups.push(group);

    for (const members of groups) {
      const ordered = orderStops(pickup, members);
      const distanceKm = Math.round(pathKm(pickup, ordered) * 100) / 100;
      routes.push({
        vehicleType: vehicle,
        stopIds: ordered.map((stop) => stop.id),
        distanceKm,
        durationMin: Math.max(1, Math.round((distanceKm / SPEED_KMH[vehicle]) * 60 + service * ordered.length)),
        weightKg: Math.round(members.reduce((sum, stop) => sum + stop.weightKg, 0) * 100) / 100,
      });
    }
  }
  return routes;
}
