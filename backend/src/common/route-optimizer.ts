import { haversineKm, type LatLng } from '@levoja/shared';

/** Parada de uma rota com várias entregas: a entrega (DROPOFF) só pode vir depois da coleta (PICKUP) da mesma entrega. */
export interface SequencedStop extends LatLng {
  deliveryId: string;
  type: 'PICKUP' | 'DROPOFF';
}

/** Distância real por ruas ≈ linha reta × 1,35 (mesmo fator da estimativa de mapas). */
const DETOUR = 1.35;
const legKm = (a: LatLng, b: LatLng) => haversineKm(a, b) * DETOUR;

/** Comprimento de um caminho aberto (km por ruas), a partir de `start` quando informado. */
export function routeKm(start: LatLng | null, stops: LatLng[]): number {
  let total = 0;
  let current = start;
  for (const stop of stops) {
    if (current) total += legKm(current, stop);
    current = stop;
  }
  return total;
}

/** Toda entrega aparece depois da sua coleta (entregas já coletadas não têm PICKUP na lista). */
export function respectsPrecedence(stops: SequencedStop[]): boolean {
  const pickedUp = new Set<string>();
  const pending = new Set(stops.filter((stop) => stop.type === 'PICKUP').map((stop) => stop.deliveryId));
  for (const stop of stops) {
    if (stop.type === 'PICKUP') pickedUp.add(stop.deliveryId);
    else if (pending.has(stop.deliveryId) && !pickedUp.has(stop.deliveryId)) return false;
  }
  return true;
}

/** Vizinho mais próximo respeitando a precedência coleta → entrega. */
export function nearestNeighbor<T extends SequencedStop>(start: LatLng | null, stops: T[]): T[] {
  const pending = [...stops];
  const ordered: T[] = [];
  let current = start;
  while (pending.length) {
    const eligible = pending.filter((stop) => stop.type === 'PICKUP' || !pending.some((other) => other.type === 'PICKUP' && other.deliveryId === stop.deliveryId));
    const from = current;
    const next = from ? eligible.reduce((best, stop) => (legKm(from, stop) < legKm(from, best) ? stop : best)) : eligible[0];
    ordered.push(next);
    pending.splice(pending.indexOf(next), 1);
    current = next;
  }
  return ordered;
}

/**
 * Sequência de paradas para o entregador com várias entregas: vizinho mais próximo seguido de
 * melhorias locais (2-opt e or-opt: mover trechos de até 3 paradas) que só são aceitas quando encurtam o
 * percurso E mantêm cada entrega depois da sua coleta. Nunca devolve rota mais longa que a inicial.
 */
export function optimizeRoute<T extends SequencedStop>(start: LatLng | null, stops: T[], maxRounds = 25): T[] {
  let best = nearestNeighbor(start, stops);
  if (best.length < 3) return best;
  let bestKm = routeKm(start, best);
  const accept = (candidate: T[]) => {
    if (!respectsPrecedence(candidate)) return false;
    const km = routeKm(start, candidate);
    if (km + 1e-9 >= bestKm) return false;
    best = candidate;
    bestKm = km;
    return true;
  };

  for (let round = 0; round < maxRounds; round++) {
    let improved = false;
    // 2-opt: inverte o trecho i..k.
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        if (accept(candidate)) improved = true;
      }
    }
    // Or-opt: move um trecho de 1 a 3 paradas (em qualquer sentido) para outra posição.
    for (let size = 1; size <= Math.min(3, best.length - 1); size++) {
      for (let from = 0; from + size <= best.length; from++) {
        for (let to = 0; to <= best.length - size; to++) {
          if (to === from) continue;
          for (const reverse of [false, true]) {
            const rest = [...best];
            const segment = rest.splice(from, size);
            rest.splice(to, 0, ...(reverse ? segment.reverse() : segment));
            if (accept(rest)) improved = true;
          }
        }
      }
    }
    if (!improved) break;
  }
  return best;
}
