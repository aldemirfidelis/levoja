import { haversineKm } from '@levoja/shared';
import { orderStops, pathKm, planRoutes, type RouteStop } from './routing';

const PICKUP = { lat: -23.55, lng: -46.63 };
const at = (dLatKm: number, dLngKm: number) => ({ lat: PICKUP.lat + dLatKm / 111, lng: PICKUP.lng + dLngKm / 111 });

describe('Planejamento de rotas (lotes)', () => {
  it('ordena as paradas sem cruzar o caminho (vizinho mais próximo + 2-opt)', () => {
    const stops = [at(3, 0), at(1, 0), at(4, 0), at(2, 0)].map((point, index) => ({ ...point, id: String(index) }));
    const ordered = orderStops(PICKUP, stops);
    expect(ordered.map((stop) => stop.id)).toEqual(['1', '3', '0', '2']);
    // Caminho em linha reta: ~4 km × 1,35 de sinuosidade.
    expect(pathKm(PICKUP, ordered)).toBeCloseTo(4 * 1.35, 0);
  });

  it('corta por número de paradas, capacidade de carga e porte do veículo', () => {
    const stops: RouteStop[] = [];
    for (let index = 0; index < 10; index++) stops.push({ id: `m${index}`, ...at(Math.cos(index) * 2, Math.sin(index) * 2), weightKg: 1, vehicleType: 'MOTORCYCLE' });
    stops.push({ id: 'heavy', ...at(1, 1), weightKg: 80, vehicleType: 'CAR' });
    const routes = planRoutes(PICKUP, stops, { maxStops: 4 });
    const moto = routes.filter((route) => route.vehicleType === 'MOTORCYCLE');
    expect(moto.map((route) => route.stopIds.length).sort()).toEqual([2, 4, 4]);
    expect(routes.find((route) => route.vehicleType === 'CAR')).toMatchObject({ stopIds: ['heavy'], weightKg: 80 });
    // Todas as paradas aparecem exatamente uma vez.
    expect(routes.flatMap((route) => route.stopIds).sort()).toEqual(stops.map((stop) => stop.id).sort());
    // Capacidade: moto leva até 20 kg.
    const heavyMoto = planRoutes(PICKUP, [0, 1, 2].map((index) => ({ id: `h${index}`, ...at(index + 1, 0), weightKg: 12, vehicleType: 'MOTORCYCLE' as const })), { maxStops: 8 });
    expect(heavyMoto).toHaveLength(3);
  });

  it('agrupa vizinhos pelo ângulo e separa trechos longos', () => {
    const north = [at(3, 0.1), at(3.2, -0.1), at(2.9, 0)].map((point, index) => ({ ...point, id: `n${index}`, weightKg: 0, vehicleType: 'MOTORCYCLE' as const }));
    const south = [at(-3, 0.1), at(-3.1, -0.1)].map((point, index) => ({ ...point, id: `s${index}`, weightKg: 0, vehicleType: 'MOTORCYCLE' as const }));
    const routes = planRoutes(PICKUP, [...north, ...south], { maxStops: 8, maxLegKm: 4 });
    const groups = routes.map((route) => route.stopIds.map((id) => id[0]).join(''));
    expect(groups.sort()).toEqual(['nnn', 'ss']);
    for (const route of routes) {
      expect(route.durationMin).toBeGreaterThan(0);
      expect(route.distanceKm).toBeGreaterThanOrEqual(haversineKm(PICKUP, north[0]));
    }
  });
});
