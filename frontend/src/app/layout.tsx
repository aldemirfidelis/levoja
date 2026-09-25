import type { Metadata } from 'next';
import { THEME_BOOTSTRAP_SCRIPT } from '@levoja/web-kit/theme-script';
import { brandCss, fetchTenantBranding } from '@levoja/web-kit/brand';
import { Providers } from './providers';
import './globals.css';

/** Marca do tenant deste portal (white label): nome, logo e cor. */
const branding = () => fetchTenantBranding(process.env.API_URL ?? 'http://localhost:3333', process.env.TENANT_SLUG ?? 'levoja');

export async function generateMetadata(): Promise<Metadata> {
  const brand = await branding();
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
    title: { default: `${brand.appName} — Entregas e compras sob demanda`, template: `%s · ${brand.appName}` },
    description:
      'Peça comida, remédios, mercado e produtos de lojas, ou envie documentos e encomendas com entregadores próximos. Para clientes, empresas e entregadores.',
    icons: { icon: brand.logoUrl ?? '/icon.svg' },
    openGraph: { type: 'website', locale: 'pt_BR', siteName: brand.appName },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await branding();
  const css = brandCss(brand.primaryColor);
  return (
    <html lang="pt-BR" suppressHydrationWarning>
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
