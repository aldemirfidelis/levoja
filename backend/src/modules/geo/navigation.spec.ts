import { instructionFor, toNavigationRoute, type OsrmStep } from './navigation';

const step = (type: string, modifier?: string, name = '', exit?: number): OsrmStep => ({ distance: 100, duration: 20, name, maneuver: { type, modifier, location: [-49.7, -18.2], exit } });

describe('instruções de navegação', () => {
  it('curvas com o nome da via e a preposição certa', () => {
    expect(instructionFor(step('turn', 'right', 'Rua Santa Helena'))).toBe('Vire à direita na Rua Santa Helena');
    expect(instructionFor(step('turn', 'slight left', 'Avenida Goiás'))).toBe('Vire levemente à esquerda na Avenida Goiás');
    expect(instructionFor(step('turn', 'left', 'Viaduto do Chá'))).toBe('Vire à esquerda no Viaduto do Chá');
    expect(instructionFor(step('turn', 'uturn'))).toBe('Faça o retorno');
    expect(instructionFor(step('end of road', 'right', 'Rua 7'))).toBe('No fim da via, vire à direita na Rua 7');
  });

  it('saída, rotatória e chegada', () => {
    expect(instructionFor(step('depart', undefined, 'Rua A'))).toBe('Siga pela Rua A');
    expect(instructionFor(step('depart', undefined, 'Anel Viário'))).toBe('Siga pelo Anel Viário');
    expect(instructionFor(step('roundabout', 'right', 'Avenida B', 2))).toBe('Na rotatória, pegue a 2ª saída na Avenida B');
    expect(instructionFor(step('arrive', 'right'))).toBe('O destino está à direita');
    expect(instructionFor(step('arrive'))).toBe('Você chegou ao destino');
  });

  it('converte a rota do OSRM ([lng, lat] → [lat, lng]) e aplica o fator de velocidade', () => {
    const route = toNavigationRoute(
      { distance: 1234.4, duration: 100, geometry: { coordinates: [[-49.7, -18.2], [-49.71, -18.21]] }, legs: [{ steps: [step('depart', undefined, 'Rua A'), step('arrive')] }] },
      0.85,
    );
    expect(route.geometry[0]).toEqual([-18.2, -49.7]);
    expect(route.distanceM).toBe(1234);
    expect(route.durationS).toBe(85);
    expect(route.steps.map((item) => item.instruction)).toEqual(['Siga pela Rua A', 'Você chegou ao destino']);
    expect(route.steps[0].location).toEqual([-18.2, -49.7]);
  });
});
