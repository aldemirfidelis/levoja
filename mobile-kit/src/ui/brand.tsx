import { ReactNode, useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText, TSpan } from 'react-native-svg';
import { brandColors, fontFamilies, radius, useColors } from '../theme';
import { Text } from './primitives';

/** Onde a marca aparece: fundo claro/tema atual, fundo azul-noite ou fundo laranja. */
export type BrandTone = 'default' | 'inverse' | 'onBrand';

const HAND = brandColors.handGradient;

function Hand({ id, fill, lines, thumb, speed }: { id: string; fill: string; lines: string; thumb: string; speed: boolean }) {
  return (
    <>
      {fill.startsWith('url(') ? (
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0.3" y2="1">
            <Stop offset="0" stopColor={HAND[0]} />
            <Stop offset="0.5" stopColor={HAND[1]} />
            <Stop offset="1" stopColor={HAND[2]} />
          </LinearGradient>
        </Defs>
      ) : null}
      {speed ? (
        <G stroke={lines} strokeWidth={3.6} strokeLinecap="round">
          <Line x1={-0.5} y1={13} x2={20.5} y2={13} />
          <Line x1={5.5} y1={19.5} x2={20.5} y2={19.5} />
          <Line x1={11.5} y1={26} x2={20.5} y2={26} />
        </G>
      ) : null}
      <G transform="rotate(12 32 36)">
        <Line x1={26.5} y1={32} x2={21.5} y2={8} stroke={fill} strokeWidth={10.5} strokeLinecap="round" />
        <Line x1={37.5} y1={32} x2={43.5} y2={6.5} stroke={fill} strokeWidth={10.5} strokeLinecap="round" />
        <Path d="M17 37C17 31.5 21 28.5 26 28.5H41C46 28.5 49 32 49 37V45C49 54.5 42 61 33 61C24 61 17 54.5 17 45Z" fill={fill} />
        <Path d="M17.5 37Q28 35.5 34 46" stroke={thumb} strokeWidth={2.6} fill="none" strokeLinecap="round" />
      </G>
    </>
  );
}

function handColors(tone: BrandTone | 'white', id: string, cut: string | undefined, bg: string) {
  if (tone === 'white') return { fill: '#FFFFFF', lines: '#FFFFFF', thumb: cut ?? '#FF5A1A' };
  if (tone === 'onBrand') return { fill: brandColors.gema, lines: brandColors.gema, thumb: cut ?? '#F04A1A' };
  return { fill: `url(#${id})`, lines: '#FF8A1F', thumb: cut ?? (tone === 'inverse' ? brandColors.noite : bg) };
}

/**
 * Mão em V da marca (dois dedos para cima, com traços de velocidade), geometria do handoff
 * (viewBox -24 0 88 64). `cut` é a cor do traço do polegar: a do fundo onde a mão está.
 */
export function BrandHand({ size = 48, tone = 'default', cut, speed = true }: { size?: number; tone?: BrandTone | 'white'; cut?: string; speed?: boolean }) {
  const colors = useColors();
  const id = `lj-hand-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const width = speed ? (size * 88) / 64 : (size * 52) / 64;
  return (
    <Svg width={width} height={size} viewBox={speed ? '-24 0 88 64' : '12 0 52 64'} accessible={false}>
      <Hand id={id} speed={speed} {...handColors(tone, id, cut, colors.bg)} />
    </Svg>
  );
}

// Medidas em "em" (tamanho da fonte), a partir dos avanços da Nunito 900 itálico e do handoff:
// "Levo" 2,283 em e "Ja" 0,958 em, espaçamento −0,045 em por letra; "Ja" com 0,02/0,06 de respiro;
// 0,1 em de margem à direita; mão de 1,07 × 0,78 em saindo 0,08 em além da margem, no topo.
const LEVO = 2.283 - 4 * 0.045;
const JA_START = LEVO + 0.02;
const JA = 0.958 - 2 * 0.045;
const HAND_RIGHT = JA_START + JA + 0.06 + 0.1 + 0.08;
const HAND_LEFT = HAND_RIGHT - 1.07;
const WIDTH = HAND_RIGHT;
const HEIGHT = 1.52;
const BASELINE = 1.399;

/**
 * Logotipo LevoJá: "Levo" + "Ja" em degradê, com a mão em V no lugar do acento. `size` é o tamanho
 * da fonte; a largura total é ~3,2× isso.
 */
export function BrandLogo({ size = 40, tone = 'default', cut }: { size?: number; tone?: BrandTone; cut?: string }) {
  const colors = useColors();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const handId = `lj-logo-hand-${uid}`;
  const jaId = `lj-logo-ja-${uid}`;
  const levo = tone === 'default' ? colors.fg : '#FFFFFF';
  const ja = tone === 'onBrand' ? ['#FFE08A', '#FFC22E', '#FF9A1F'] : HAND;
  const scale = (1.07 * size) / 88;
  return (
    <Svg width={WIDTH * size} height={HEIGHT * size} accessible accessibilityLabel="LevoJá" accessibilityRole="image">
      <Defs>
        <LinearGradient id={jaId} gradientUnits="userSpaceOnUse" x1={(JA_START + JA / 2 + 0.06) * size} y1={0.39 * size} x2={(JA_START + JA / 2 - 0.06) * size} y2={1.75 * size}>
          <Stop offset="0" stopColor={ja[0]} />
          <Stop offset={tone === 'onBrand' ? '0.6' : '0.48'} stopColor={ja[1]} />
          <Stop offset="1" stopColor={ja[2]} />
        </LinearGradient>
      </Defs>
      <SvgText fontFamily={fontFamilies['900italic']} fontSize={size} letterSpacing={-0.045 * size} x={0} y={BASELINE * size}>
        <TSpan fill={levo}>Levo</TSpan>
        <TSpan fill={`url(#${jaId})`} dx={0.02 * size}>
          Ja
        </TSpan>
      </SvgText>
      <G transform={`translate(${(HAND_LEFT + (24 * 1.07) / 88) * size} 0) scale(${scale})`}>
        <Hand id={handId} speed {...handColors(tone, handId, cut, colors.bg)} />
      </G>
    </Svg>
  );
}

/** Bloco com fundo em degradê da marca (laranja → pimenta, 135°): banners e chamadas principais. */
export function BrandGradient({ children, style, corner = radius.xl }: { children: ReactNode; style?: StyleProp<ViewStyle>; corner?: number }) {
  const colors = useColors();
  const id = `lj-grad-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <View style={[{ borderRadius: corner, overflow: 'hidden', backgroundColor: colors.ctaTo }, style]}>
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.ctaFrom} />
            <Stop offset="1" stopColor={colors.ctaTo} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      {children}
    </View>
  );
}

/** Slogan da marca, em caixa alta e espaçado. */
export function BrandSlogan({ tone = 'muted', size = 11 }: { tone?: 'muted' | 'onBrand'; size?: number }) {
  return (
    <Text variant="tiny" tone={tone} weight="800" style={{ fontSize: size, lineHeight: size * 1.4, letterSpacing: size * 0.22, textTransform: 'uppercase' }}>
      Tudo o que você precisa, mais perto
    </Text>
  );
}
