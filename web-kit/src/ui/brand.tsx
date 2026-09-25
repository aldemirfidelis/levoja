'use client';

import { createContext, ReactNode, useContext } from 'react';
import type { TenantBranding } from '@levoja/shared';
import { DEFAULT_BRANDING } from '../brand';

const BrandContext = createContext<TenantBranding>(DEFAULT_BRANDING);

/** Marca do tenant (white label) disponível para os componentes do cliente. */
export function BrandProvider({ value, children }: { value: TenantBranding; children: ReactNode }) {
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): TenantBranding {
  return useContext(BrandContext);
}

/** Logotipo da marca (imagem configurada ou o nome em destaque). */
export function BrandLogo({ className, suffix }: { className?: string; suffix?: string }) {
  const brand = useBrand();
  if (brand.logoUrl) {
    return (
      <span className="inline-flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logoUrl} alt={brand.appName} className="h-8 w-auto" />
        {suffix && <span className={className}>{suffix}</span>}
      </span>
    );
  }
  return (
    <span className={className}>
      {brand.appName}
      {suffix ? ` ${suffix}` : ''}
    </span>
  );
}
