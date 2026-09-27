import { Nunito } from 'next/font/google';
import type { Metadata } from 'next';
import { THEME_BOOTSTRAP_SCRIPT } from '@levoja/web-kit/theme-script';
import { brandCss, fetchTenantBranding } from '@levoja/web-kit/brand';
import { Providers } from './providers';
import './globals.css';

/** Fonte da marca: Nunito (texto) e Nunito 900 itálico (logo e destaques). */
const nunito = Nunito({ subsets: ['latin'], style: ['normal', 'italic'], variable: '--font-nunito', display: 'swap' });

const branding = () => fetchTenantBranding(process.env.API_URL ?? 'http://localhost:3333', process.env.TENANT_SLUG ?? 'levoja');

export async function generateMetadata(): Promise<Metadata> {
  const brand = await branding();
  return {
    title: { default: `${brand.appName} Admin`, template: `%s · ${brand.appName} Admin` },
    description: `Painel administrativo da plataforma ${brand.appName}`,
    robots: { index: false, follow: false },
    icons: brand.logoUrl
      ? { icon: brand.logoUrl }
      : {
          icon: [
            { url: '/icon.svg', type: 'image/svg+xml' },
            { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
            { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
          ],
          apple: '/apple-touch-icon.png',
        },
  };
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
