import type { MetadataRoute } from 'next';
import { fetchTenantBranding } from '@levoja/web-kit/brand';

/** Manifesto do PWA (instalar o portal na tela inicial), com a marca do tenant. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const brand = await fetchTenantBranding(process.env.API_URL ?? 'http://localhost:3333', process.env.TENANT_SLUG ?? 'levoja');
  return {
    id: '/',
    name: brand.appName,
    short_name: brand.appName,
    description: 'Pedidos, entregas e gestão da sua empresa — também sem abrir o navegador.',
    lang: 'pt-BR',
    start_url: '/?origem=app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: brand.primaryColor,
    icons: [
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512?maskable=1', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Minhas entregas', url: '/entregas' },
      { name: 'Minha empresa', url: '/empresa' },
      { name: 'Minha conta', url: '/conta' },
    ],
  };
}
