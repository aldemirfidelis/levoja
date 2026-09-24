import { nearestNeighbor, optimizeRoute, respectsPrecedence, routeKm, type SequencedStop } from './route-optimizer';

const stop = (deliveryId: string, type: 'PICKUP' | 'DROPOFF', lat: number, lng: number): SequencedStop => ({ deliveryId, type, lat, lng });

describe('otimização de rota com várias entregas', () => {
  it('mantém cada entrega depois da sua coleta', () => {
    const stops = [stop('a', 'DROPOFF', -23.5, -46.6), stop('a', 'PICKUP', -23.51, -46.61), stop('b', 'PICKUP', -23.52, -46.62), stop('b', 'DROPOFF', -23.49, -46.59)];
    const ordered = optimizeRoute({ lat: -23.5, lng: -46.6 }, stops);
    expect(respectsPrecedence(ordered)).toBe(true);
    expect(ordered).toHaveLength(4);
  });

  it('entregas já coletadas (sem PICKUP) podem ir em qualquer posição', () => {
    expect(respectsPrecedence([stop('a', 'DROPOFF', 0, 0), stop('b', 'PICKUP', 0, 0), stop('b', 'DROPOFF', 0, 0)])).toBe(true);
    expect(respectsPrecedence([stop('b', 'DROPOFF', 0, 0), stop('b', 'PICKUP', 0, 0)])).toBe(false);
  });

  it('corrige o vai e volta do vizinho mais próximo', () => {
    // Paradas em linha (longitude crescente); o vizinho mais próximo começa pelo lado errado e volta.
    const start = { lat: 0, lng: 0 };
    const stops = [
      stop('a', 'DROPOFF', 0, -0.011),
      stop('b', 'DROPOFF', 0, 0.01),
      stop('c', 'DROPOFF', 0, 0.02),
      stop('d', 'DROPOFF', 0, 0.03),
      stop('e', 'DROPOFF', 0, -0.015),
    ];
    const greedy = nearestNeighbor(start, stops);
    const optimized = optimizeRoute(start, stops);
    expect(routeKm(start, optimized)).toBeLessThan(routeKm(start, greedy));
  });

  it('nunca produz rota mais longa que a inicial', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let run = 0; run < 20; run++) {
      const stops: SequencedStop[] = [];
      for (let index = 0; index < 4; index++) {
        stops.push(stop(`d${index}`, 'PICKUP', -23.5 + random() * 0.05, -46.6 + random() * 0.05));
        stops.push(stop(`d${index}`, 'DROPOFF', -23.5 + random() * 0.05, -46.6 + random() * 0.05));
      }
      const start = { lat: -23.5, lng: -46.6 };
      const optimized = optimizeRoute(start, stops);
      expect(respectsPrecedence(optimized)).toBe(true);
      expect(routeKm(start, optimized)).toBeLessThanOrEqual(routeKm(start, nearestNeighbor(start, stops)) + 1e-9);
    }
  });
});
