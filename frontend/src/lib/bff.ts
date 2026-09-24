import { createBff } from '@levoja/web-kit/server';

export const bff = createBff({
  apiUrl: process.env.API_URL ?? 'http://localhost:3333',
  tenant: process.env.TENANT_SLUG ?? 'levoja',
  // CUSTOMER: quem entra pelo portal ganha perfil de cliente (pode pedir entregas pelo site).
  app: 'CUSTOMER',
  cookiePrefix: 'lj_web',
});

/** Chamada pública à API a partir de Server Components (páginas institucionais). */
export async function publicApi<T>(path: string, revalidateSeconds = 300): Promise<T | null> {
  try {
    const response = await fetch(`${process.env.API_URL ?? 'http://localhost:3333'}/v1/${path}`, {
      headers: { 'X-Tenant': process.env.TENANT_SLUG ?? 'levoja', Accept: 'application/json' },
      next: { revalidate: revalidateSeconds },
    });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}
