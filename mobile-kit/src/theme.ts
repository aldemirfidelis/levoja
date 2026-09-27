import { useColorScheme } from 'react-native';
import { brandPalette, isHexColor } from '@levoja/shared';
import { kitConfigOrNull } from './config';

/** Mesma paleta do portal web (web-kit/theme.css) para uma identidade única. */
export const brand = {
  50: '#FFF4EC',
  100: '#FFE3CF',
  200: '#FFC49E',
  300: '#FF9E66',
  400: '#FF7A1A',
  500: '#FF5A1A',
  600: '#E8321A',
  700: '#C2250F',
} as const;

/** Cores fixas da marca LevoJá. */
export const brandColors = {
  gema: '#FFC22E',
  noite: '#131A2B',
  nuvem: '#FAF8F5',
  confirmado: '#1FA36B',
  /** Degradê "Já" (logo e mão): gema → laranja → pimenta. */
  handGradient: ['#FFC22E', '#FF7A1A', '#F0301A'],
} as const;

/**
 * Nunito por peso (cada peso é uma família no React Native). Carregadas por `useBrandFonts`;
 * `Text` e `Button` escolhem a família a partir do peso, sem depender de `fontWeight`.
 */
export const fontFamilies = {
  400: 'Nunito_400Regular',
  600: 'Nunito_600SemiBold',
  700: 'Nunito_700Bold',
  800: 'Nunito_800ExtraBold',
  900: 'Nunito_900Black',
  '900italic': 'Nunito_900Black_Italic',
} as const;

/** Família da Nunito para um peso (e itálico, usado só no 900 da marca). */
export function fontFor(weight?: string | number | null, italic?: boolean): string {
  const value = weight === 'bold' ? 700 : Number(weight) || 400;
  if (italic && value >= 800) return fontFamilies['900italic'];
  if (value >= 900) return fontFamilies[900];
  if (value >= 800) return fontFamilies[800];
  if (value >= 700) return fontFamilies[700];
  if (value >= 500) return fontFamilies[600];
  return fontFamilies[400];
}

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
  /** Degradê do botão principal (laranja → pimenta). */
  ctaFrom: string;
  ctaTo: string;
  /** Azul-noite da marca (botão secundário, app do entregador) e o texto sobre ele. */
  noite: string;
  onNoite: string;
}

export const lightColors: Colors = {
  bg: brandColors.nuvem,
  surface: '#FFFFFF',
  surface2: '#F3F0EB',
  border: '#E8E3DC',
  fg: brandColors.noite,
  muted: '#5E6679',
  success: brandColors.confirmado,
  warning: '#d97706',
  danger: '#dc2626',
  info: '#2563eb',
  brand: brand[500],
  brandPressed: brand[600],
  brandSoft: brand[50],
  onBrand: '#FFFFFF',
  overlay: 'rgba(19,26,43,0.45)',
  ctaFrom: brand[400],
  ctaTo: '#F0301A',
  noite: brandColors.noite,
  onNoite: '#FFFFFF',
};

/** Modo escuro sobre o azul-noite da marca. */
export const darkColors: Colors = {
  bg: '#0E1320',
  surface: '#161D2E',
  surface2: '#1F2739',
  border: '#2C3549',
  fg: '#EEF0F5',
  muted: '#A3AABB',
  success: '#34C285',
  warning: '#e3a008',
  danger: '#f85149',
  info: '#58a6ff',
  brand: brand[500],
  brandPressed: brand[400],
  brandSoft: 'rgba(255,90,26,0.16)',
  onBrand: '#FFFFFF',
  overlay: 'rgba(0,0,0,0.6)',
  ctaFrom: brand[400],
  ctaTo: '#F0301A',
  noite: '#EEF0F5',
  onNoite: brandColors.noite,
};

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const branded = new Map<string, Colors>();

/** Paleta com a cor da marca configurada no build (white label); sem configuração, a padrão. */
export function themeColors(dark: boolean): Colors {
  const color = kitConfigOrNull()?.brandColor;
  const base = dark ? darkColors : lightColors;
  // Sem cor configurada, ou a laranja da marca (atual ou anterior, #FF5A1F): a paleta desenhada.
  if (!color || !isHexColor(color) || ['#ff5a1a', '#ff5a1f'].includes(color.toLowerCase())) return base;
  const key = `${color}:${dark}`;
  let colors = branded.get(key);
  if (!colors) {
    const palette = brandPalette(color);
    const [r, g, b] = [1, 3, 5].map((index) => parseInt(palette[500].slice(index, index + 2), 16));
    colors = {
      ...base,
      brand: palette[500],
      brandPressed: dark ? palette[400] : palette[600],
      brandSoft: dark ? `rgba(${r},${g},${b},0.16)` : palette[50],
      ctaFrom: palette[400],
      ctaTo: palette[600],
    };
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
  /** Destaques da marca (saudações, chamadas): Nunito 900 itálico. */
  brand: { fontSize: 26, lineHeight: 31, fontWeight: '900', fontStyle: 'italic', letterSpacing: -0.6 },
  display: { fontSize: 28, lineHeight: 34, fontWeight: '900' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '800' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  subheading: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  tiny: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
} as const;

export type TypographyVariant = keyof typeof typography;
