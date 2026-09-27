import Svg, { Circle, G, Path } from 'react-native-svg';
import { Icon } from '@levoja/mobile-kit';

/** Ângulo da seta para cada direção do OSRM (0 = em frente, positivo = direita). */
const ANGLE: Record<string, number> = { straight: 0, 'slight right': 40, right: 90, 'sharp right': 135, 'slight left': -40, left: -90, 'sharp left': -135 };

const STRAIGHT = 'M12 2.5 19 10.5h-4.5V21.5h-5V10.5H5z';
/** Seta dobrando à direita (espelhada para a esquerda). */
const TURN = 'M7 21.5V12.5a4.5 4.5 0 0 1 4.5-4.5H15V3.5l6.5 6.75L15 17v-4.5h-3.5v9z';
const UTURN = 'M16.5 21.5V9a4.5 4.5 0 0 0-9 0v5H3l6.25 7 6.25-7H12V9h0.5v12.5z';

/** Ícone da manobra (seta de curva, retorno, rotatória, chegada) para o painel de navegação. */
export function ManeuverIcon({ type, modifier, size = 56, color = '#fff' }: { type: string; modifier: string | null; size?: number; color?: string }) {
  if (type === 'arrive') return <Icon name="flag" size={size * 0.8} color={color} />;
  if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Circle cx={12} cy={13} r={5} stroke={color} strokeWidth={2.5} fill="none" />
        <Path d="M12 18v4.5" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
        <G transform={`rotate(${ANGLE[modifier ?? 'straight'] ?? 0} 12 13)`}>
          <Path d="M12 8V2.5M9 5.5l3-3.5 3 3.5" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </G>
      </Svg>
    );
  }
  if (modifier === 'uturn') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d={UTURN} fill={color} />
      </Svg>
    );
  }
  if (modifier === 'left' || modifier === 'right') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <G transform={modifier === 'left' ? 'translate(24 0) scale(-1 1)' : undefined}>
          <Path d={TURN} fill={color} />
        </G>
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G transform={`rotate(${ANGLE[modifier ?? 'straight'] ?? 0} 12 12)`}>
        <Path d={STRAIGHT} fill={color} />
      </G>
    </Svg>
  );
}
