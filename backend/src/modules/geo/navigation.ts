/**
 * Navegação curva a curva do app do entregador: rota completa (linha no mapa) e as manobras com
 * instruções em português, a partir da resposta do OSRM (`steps=true`).
 */

export interface NavigationStep {
  /** Texto falado/mostrado: "Vire à direita na Rua Santa Helena". */
  instruction: string;
  /** Manobra do OSRM (turn, roundabout, arrive...) e direção (left, slight right...) — definem o ícone. */
  type: string;
  modifier: string | null;
  /** Nome da via depois da manobra. */
  name: string;
  /** Distância e tempo do trecho que começa nesta manobra. */
  distanceM: number;
  durationS: number;
  /** Ponto da manobra [lat, lng]. */
  location: [number, number];
}

export interface NavigationRoute {
  distanceM: number;
  durationS: number;
  /** Linha da rota [lat, lng][]. */
  geometry: [number, number][];
  steps: NavigationStep[];
  /** 'osrm' = rota real pelas ruas; 'straight' = linha reta (serviço de rotas indisponível). */
  provider: 'osrm' | 'straight';
}

export interface OsrmStep {
  distance: number;
  duration: number;
  name?: string;
  ref?: string;
  maneuver: { type: string; modifier?: string; location: [number, number]; exit?: number };
}

const SIDE: Record<string, string> = {
  left: 'à esquerda',
  right: 'à direita',
  'slight left': 'levemente à esquerda',
  'slight right': 'levemente à direita',
  'sharp left': 'fortemente à esquerda',
  'sharp right': 'fortemente à direita',
  straight: 'em frente',
  uturn: 'o retorno',
};

/** Vias com nome masculino levam "no/pelo" ("no Viaduto", "pelo Anel Viário"); o resto, "na/pela". */
const MASCULINE = /^(viaduto|largo|beco|acesso|anel|parque|contorno|t[uú]nel|trevo|elevado|caminho|setor|conjunto|jardim|residencial|loteamento|eixo|corredor|ramal|p[aá]tio|n[uú]cleo|bairro|condom[ií]nio|boulevard|bulevar)\b/i;

function preposition(road: string, kind: 'em' | 'por'): string {
  const masculine = MASCULINE.test(road);
  if (kind === 'em') return masculine ? 'no' : 'na';
  return masculine ? 'pelo' : 'pela';
}

/** Instrução em português de uma manobra do OSRM. */
export function instructionFor(step: OsrmStep): string {
  const { type, modifier, exit } = step.maneuver;
  const road = (step.name || step.ref || '').trim();
  const on = road ? ` ${preposition(road, 'em')} ${road}` : '';
  const side = modifier ? SIDE[modifier] : undefined;

  switch (type) {
    case 'depart':
      return road ? `Siga ${preposition(road, 'por')} ${road}` : 'Siga em frente';
    case 'arrive':
      return modifier === 'left' ? 'O destino está à esquerda' : modifier === 'right' ? 'O destino está à direita' : 'Você chegou ao destino';
    case 'turn':
    case 'end of road': {
      const prefix = type === 'end of road' ? 'No fim da via, ' : '';
      if (modifier === 'uturn') return `${prefix}${prefix ? 'faça' : 'Faça'} o retorno${on}`;
      if (!side || modifier === 'straight') return `${prefix}${prefix ? 'siga' : 'Siga'} em frente${on}`;
      return `${prefix}${prefix ? 'vire' : 'Vire'} ${side}${on}`;
    }
    case 'continue':
    case 'new name':
      if (modifier === 'uturn') return `Faça o retorno${on}`;
      if (side && modifier !== 'straight') return `Mantenha-se ${side}${on}`;
      return road ? `Continue ${preposition(road, 'por')} ${road}` : 'Continue em frente';
    case 'merge':
      return road ? `Entre ${preposition(road, 'em')} ${road}` : `Entre ${side ?? 'na via'}`;
    case 'on ramp':
      return `Pegue o acesso${side && modifier !== 'straight' ? ` ${side}` : ''}${on}`;
    case 'off ramp':
      return `Pegue a saída${side && modifier !== 'straight' ? ` ${side}` : ''}${on}`;
    case 'fork':
      return `Na bifurcação, mantenha-se ${side ?? 'em frente'}${on}`;
    case 'roundabout':
    case 'rotary':
      return exit ? `Na rotatória, pegue a ${exit}ª saída${on}` : `Entre na rotatória${on}`;
    case 'roundabout turn':
      return `Na rotatória, vire ${side ?? 'em frente'}${on}`;
    case 'exit roundabout':
    case 'exit rotary':
      return `Saia da rotatória${on}`;
    default:
      return side && modifier !== 'straight' ? `Siga ${side}${on}` : `Continue${on || ' em frente'}`;
  }
}

/** Converte a rota do OSRM (geometries=geojson, steps=true) para o formato do app. */
export function toNavigationRoute(route: { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: { steps: OsrmStep[] }[] }, speedFactor = 1): NavigationRoute {
  const steps = route.legs
    .flatMap((leg) => leg.steps)
    .map((step) => ({
      instruction: instructionFor(step),
      type: step.maneuver.type,
      modifier: step.maneuver.modifier ?? null,
      name: (step.name || step.ref || '').trim(),
      distanceM: Math.round(step.distance),
      durationS: Math.round(step.duration * speedFactor),
      location: [step.maneuver.location[1], step.maneuver.location[0]] as [number, number],
    }));
  return {
    distanceM: Math.round(route.distance),
    durationS: Math.round(route.duration * speedFactor),
    geometry: route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
    steps,
    provider: 'osrm',
  };
}
