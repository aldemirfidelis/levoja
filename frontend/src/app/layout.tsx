import { Nunito } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import { THEME_BOOTSTRAP_SCRIPT } from '@levoja/web-kit/theme-script';
import { brandCss, fetchTenantBranding } from '@levoja/web-kit/brand';
import { Providers } from './providers';
import './globals.css';

/** Fonte da marca: Nunito (texto) e Nunito 900 itálico (logo e destaques). */
const nunito = Nunito({ subsets: ['latin'], style: ['normal', 'italic'], variable: '--font-nunito', display: 'swap' });

/** Ícones da marca LevoJá (a mão em V): SVG, PNGs para navegadores antigos e ícone do iOS. */
const BRAND_ICONS: Metadata['icons'] = {
  icon: [
    { url: '/icon.svg', type: 'image/svg+xml' },
    { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
  ],
  apple: '/apple-touch-icon.png',
};

/** Marca do tenant deste portal (white label): nome, logo e cor. */
const branding = () => fetchTenantBranding(process.env.API_URL ?? 'http://localhost:3333', process.env.TENANT_SLUG ?? 'levoja');

export async function generateMetadata(): Promise<Metadata> {
  const brand = await branding();
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
    title: { default: `${brand.appName} — Entregas e compras sob demanda`, template: `%s · ${brand.appName}` },
    description:
      'Peça comida, remédios, mercado e produtos de lojas, ou envie documentos e encomendas com entregadores próximos. Para clientes, empresas e entregadores.',
    icons: brand.logoUrl ? { icon: brand.logoUrl, apple: '/pwa-icon/192' } : BRAND_ICONS,
    appleWebApp: { capable: true, title: brand.appName, statusBarStyle: 'default' },
    openGraph: { type: 'website', locale: 'pt_BR', siteName: brand.appName },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const brand = await branding();
  return { themeColor: brand.primaryColor, width: 'device-width', initialScale: 1 };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await branding();
  const css = brandCss(brand.primaryColor);
  return (
    <html lang="pt-BR" className={nunito.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      </head>
      <body>
        <Providers brand={brand}>{children}</Providers>
      </body>
    </html>
  );
}
