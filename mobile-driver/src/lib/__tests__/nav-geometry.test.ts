import { distanceM, formatDistance, prepareRoute, progressOn, spokenDistance, type NavRoute } from '../nav-geometry';

// Rota em "L": ~220 m para o norte e depois ~210 m para o leste.
const route: NavRoute = {
  distanceM: 430,
  durationS: 60,
  provider: 'osrm',
  geometry: [
    [-18.2, -49.7],
    [-18.199, -49.7],
    [-18.198, -49.7],
    [-18.198, -49.699],
    [-18.198, -49.698],
  ],
  steps: [
    { instruction: 'Siga pela Rua A', type: 'depart', modifier: null, name: 'Rua A', distanceM: 220, durationS: 30, location: [-18.2, -49.7] },
    { instruction: 'Vire à direita na Rua B', type: 'turn', modifier: 'right', name: 'Rua B', distanceM: 210, durationS: 30, location: [-18.198, -49.7] },
    { instruction: 'Você chegou ao destino', type: 'arrive', modifier: null, name: '', distanceM: 0, durationS: 0, location: [-18.198, -49.698] },
  ],
};

describe('navegação', () => {
  const prepared = prepareRoute(route);

  it('mede a rota e posiciona as manobras', () => {
    expect(prepared.lengthM).toBeGreaterThan(420);
    expect(prepared.lengthM).toBeLessThan(440);
    expect(Math.round(prepared.stepAlong[1])).toBe(Math.round(distanceM(route.geometry[0], route.geometry[2])));
  });

  it('acompanha o entregador: próxima manobra, distância e restante', () => {
    const start = progressOn(prepared, [-18.1995, -49.70001]);
    expect(start.nextStep).toBe(1);
    expect(start.offRouteM).toBeLessThan(5);
    expect(start.toNextM).toBeGreaterThan(150);
    expect(start.toNextM).toBeLessThan(175);

    const afterTurn = progressOn(prepared, [-18.198, -49.6985], start.segment);
    expect(afterTurn.nextStep).toBe(2);
    expect(afterTurn.remainingM).toBeLessThan(60);
  });

  it('percebe quando sai da rota', () => {
    const lost = progressOn(prepared, [-18.199, -49.702]);
    expect(lost.offRouteM).toBeGreaterThan(150);
  });

  it('formata distâncias como os apps de navegação', () => {
    expect(formatDistance(47)).toBe('50 m');
    expect(formatDistance(372)).toBe('350 m');
    expect(formatDistance(1234)).toBe('1,2 km');
    expect(spokenDistance(310)).toBe('300 metros');
    expect(spokenDistance(1500)).toBe('1,5 quilômetro');
  });
});
