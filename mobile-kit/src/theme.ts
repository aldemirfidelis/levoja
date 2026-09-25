import { useColorScheme } from 'react-native';
import { brandPalette, isHexColor } from '@levoja/shared';
import { kitConfigOrNull } from './config';

/** Mesma paleta do portal web (web-kit/theme.css) para uma identidade única. */
export const brand = {
  50: '#fff4ed',
  100: '#ffe6d5',
  200: '#ffc9aa',
  300: '#ffa274',
  400: '#ff6f3c',
  500: '#ff5a1f',
  600: '#f03d0b',
  700: '#c72b0b',
} as const;

export interface Colors {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  fg: string;
  muted: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  brand: string;
  brandPressed: string;
  brandSoft: string;
  onBrand: string;
  overlay: string;
}

export const lightColors: Colors = {
  bg: '#f6f7f9',
  surface: '#ffffff',
  surface2: '#f1f3f6',
  border: '#e3e6eb',
  fg: '#111827',
  muted: '#6b7280',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
  info: '#2563eb',
  brand: brand[500],
  brandPressed: brand[600],
  brandSoft: brand[50],
  onBrand: '#ffffff',
  overlay: 'rgba(17,24,39,0.45)',
};

export const darkColors: Colors = {
  bg: '#0d1117',
  surface: '#161b22',
  surface2: '#1f2630',
  border: '#2d3440',
  fg: '#e6edf3',
  muted: '#9aa4b2',
  success: '#3fb950',
  warning: '#e3a008',
  danger: '#f85149',
  info: '#58a6ff',
  brand: brand[500],
  brandPressed: brand[400],
  brandSoft: 'rgba(255,90,31,0.16)',
  onBrand: '#ffffff',
  overlay: 'rgba(0,0,0,0.6)',
};

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const branded = new Map<string, Colors>();

/** Paleta com a cor da marca configurada no build (white label); sem configuração, a padrão. */
export function themeColors(dark: boolean): Colors {
  const color = kitConfigOrNull()?.brandColor;
  const base = dark ? darkColors : lightColors;
  if (!color || !isHexColor(color)) return base;
  const key = `${color}:${dark}`;
  let colors = branded.get(key);
  if (!colors) {
    const palette = brandPalette(color);
    const [r, g, b] = [1, 3, 5].map((index) => parseInt(palette[500].slice(index, index + 2), 16));
    colors = { ...base, brand: palette[500], brandPressed: dark ? palette[400] : palette[600], brandSoft: dark ? `rgba(${r},${g},${b},0.16)` : palette[50] };
    branded.set(key, colors);
  }
  return colors;
}

export function useColors(): Colors {
  return themeColors(useColorScheme() === 'dark');
}

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}

/** Cor principal de um tom semântico. */
export function toneColor(colors: Colors, tone: Tone): string {
  if (tone === 'neutral') return colors.muted;
  if (tone === 'brand') return colors.brand;
  return colors[tone];
}

export const space = (n: number) => n * 4;
export const radius = { sm: 6, md: 10, lg: 16, xl: 22, full: 999 } as const;

export const typography = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '800' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '800' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  subheading: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  tiny: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
} as const;

export type TypographyVariant = keyof typeof typography;
