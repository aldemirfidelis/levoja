import { brandPalette, isHexColor, type TenantBranding } from '@levoja/shared';

/** Marca padrão (sem configuração de white label). */
export const DEFAULT_BRANDING: TenantBranding = {
  appName: 'LevoJá',
  logoUrl: null,
  primaryColor: '#FF5A1F',
  supportEmail: null,
  supportPhone: null,
};

/**
 * CSS que troca a paleta da marca (tons 50–900) pela cor do tenant. `html:root` vence a
 * declaração do tema compartilhado independentemente da ordem das folhas de estilo.
 */
export function brandCss(primaryColor: string | null | undefined): string {
  if (!primaryColor || !isHexColor(primaryColor) || primaryColor.toLowerCase() === DEFAULT_BRANDING.primaryColor.toLowerCase()) return '';
  const palette = brandPalette(primaryColor);
  const vars = Object.entries(palette)
    .map(([step, color]) => `--color-brand-${step}:${color}`)
    .join(';');
  return `html:root{${vars}}`;
}

/** Marca do tenant (GET /v1/tenant), com cache curto; falha de rede devolve a marca padrão. */
export async function fetchTenantBranding(apiUrl: string, tenant?: string, revalidateSeconds = 300): Promise<TenantBranding & { webUrl?: string }> {
  try {
    const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/v1/tenant`, {
      headers: { Accept: 'application/json', ...(tenant ? { 'X-Tenant': tenant } : {}) },
      next: { revalidate: revalidateSeconds },
    } as RequestInit);
    if (!response.ok) return DEFAULT_BRANDING;
    const body = (await response.json()) as Partial<TenantBranding> & { webUrl?: string };
    return {
      appName: body.appName || DEFAULT_BRANDING.appName,
      logoUrl: body.logoUrl ?? null,
      primaryColor: body.primaryColor && isHexColor(body.primaryColor) ? body.primaryColor : DEFAULT_BRANDING.primaryColor,
      supportEmail: body.supportEmail ?? null,
      supportPhone: body.supportPhone ?? null,
      webUrl: body.webUrl,
    };
  } catch {
    return DEFAULT_BRANDING;
  }
}
