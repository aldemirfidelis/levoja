'use client';

import { createContext, CSSProperties, ReactNode, useContext, useId } from 'react';
import type { TenantBranding } from '@levoja/shared';
import { DEFAULT_BRANDING } from '../brand';
import { cn } from '../utils';

const BrandContext = createContext<TenantBranding>(DEFAULT_BRANDING);

/** Marca do tenant (white label) disponível para os componentes do cliente. */
export function BrandProvider({ value, children }: { value: TenantBranding; children: ReactNode }) {
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): TenantBranding {
  return useContext(BrandContext);
}

/** Onde a marca aparece: fundo claro/tema atual, fundo azul-noite ou fundo laranja. */
export type BrandTone = 'default' | 'inverse' | 'onBrand';

const HAND_GRADIENT = ['#FFC22E', '#FF7A1A', '#F0301A'] as const;

/**
 * Mão em V da marca LevoJá (dois dedos para cima, com traços de velocidade), no viewBox do handoff
 * (-24 0 88 64). `cut` é a cor do traço do polegar: a mesma do fundo onde a mão está.
 */
export function BrandHand({
  tone = 'default',
  cut,
  speed = true,
  className,
  style,
}: {
  tone?: BrandTone | 'white';
  cut?: string;
  speed?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const id = `lj-hand-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const solid = tone === 'white' ? '#FFFFFF' : tone === 'onBrand' ? '#FFC22E' : null;
  const fill = solid ?? `url(#${id})`;
  const lines = solid ?? '#FF8A1F';
  const thumb = cut ?? (tone === 'onBrand' ? '#F04A1A' : tone === 'white' ? 'var(--color-brand-500)' : tone === 'inverse' ? 'var(--color-noite)' : 'var(--lj-surface)');
  return (
    <svg viewBox={speed ? '-24 0 88 64' : '12 0 52 64'} className={className} style={{ overflow: 'visible', ...style }} aria-hidden="true">
      {!solid && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0" stopColor={HAND_GRADIENT[0]} />
            <stop offset=".5" stopColor={HAND_GRADIENT[1]} />
            <stop offset="1" stopColor={HAND_GRADIENT[2]} />
          </linearGradient>
        </defs>
      )}
      {speed && (
        <g stroke={lines} strokeWidth="3.6" strokeLinecap="round">
          <line x1="-0.5" y1="13" x2="20.5" y2="13" />
          <line x1="5.5" y1="19.5" x2="20.5" y2="19.5" />
          <line x1="11.5" y1="26" x2="20.5" y2="26" />
        </g>
      )}
      <g transform="rotate(12 32 36)">
        <line x1="26.5" y1="32" x2="21.5" y2="8" stroke={fill} strokeWidth="10.5" strokeLinecap="round" />
        <line x1="37.5" y1="32" x2="43.5" y2="6.5" stroke={fill} strokeWidth="10.5" strokeLinecap="round" />
        <path d="M17 37C17 31.5 21 28.5 26 28.5H41C46 28.5 49 32 49 37V45C49 54.5 42 61 33 61C24 61 17 54.5 17 45Z" fill={fill} />
        <path d="M17.5 37Q28 35.5 34 46" stroke={thumb} strokeWidth="2.6" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** A marca exibida é a LevoJá (sem logo nem nome próprio de white label)? */
export function useIsDefaultBrand(): boolean {
  const brand = useBrand();
  return !brand.logoUrl && brand.appName === DEFAULT_BRANDING.appName;
}

/**
 * Logotipo da marca. LevoJá: "Levo" + "Ja" em degradê com a mão em V no lugar do acento (o tamanho
 * segue o `font-size` de `className`). White label: a imagem configurada ou o nome do tenant.
 */
export function BrandLogo({ className, suffix, tone = 'default', cut }: { className?: string; suffix?: string; tone?: BrandTone; cut?: string }) {
  const brand = useBrand();
  const isDefault = useIsDefaultBrand();
  const suffixBadge = suffix ? (
    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-bold not-italic tracking-normal text-muted">{suffix}</span>
  ) : null;

  if (brand.logoUrl) {
    return (
      <span className="inline-flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logoUrl} alt={brand.appName} className="h-8 w-auto" />
        {suffixBadge}
      </span>
    );
  }
  if (!isDefault) {
    return (
      <span className={cn('inline-flex items-center gap-2 font-extrabold text-brand-500', className)}>
        {brand.appName}
        {suffixBadge}
      </span>
    );
  }

  const levo = tone === 'default' ? 'text-fg' : 'text-white';
  const ja: CSSProperties =
    tone === 'onBrand'
      ? { backgroundImage: 'linear-gradient(175deg,#FFE08A,#FFC22E 60%,#FF9A1F)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }
      : { backgroundImage: `linear-gradient(175deg,${HAND_GRADIENT[0]} 0%,${HAND_GRADIENT[1]} 48%,${HAND_GRADIENT[2]} 100%)`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' };
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span role="img" aria-label={brand.appName} className="relative inline-flex items-end font-black italic leading-[0.9] tracking-[-0.045em]" style={{ paddingTop: '0.62em', paddingRight: '0.1em' }}>
        <span className={levo} aria-hidden="true">
          Levo
        </span>
        <span aria-hidden="true" style={{ ...ja, padding: '0 .06em 0 .02em' }}>
          Ja
        </span>
        <BrandHand tone={tone} cut={cut} className="absolute top-0" style={{ right: '-0.08em', width: '1.07em', height: '0.78em' }} />
      </span>
      {suffixBadge}
    </span>
  );
}

/** Slogan da marca, em caixa alta e espaçado. */
export function BrandSlogan({ className }: { className?: string }) {
  const isDefault = useIsDefaultBrand();
  if (!isDefault) return null;
  return <span className={cn('tracking-slogan text-[0.7rem] text-muted', className)}>Tudo o que você precisa, mais perto</span>;
}
