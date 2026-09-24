import type { Metadata } from 'next';
import { THEME_BOOTSTRAP_SCRIPT } from '@levoja/web-kit/theme-script';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: { default: 'LevoJá — Entregas e compras sob demanda', template: '%s · LevoJá' },
  description:
    'Peça comida, remédios, mercado e produtos de lojas, ou envie documentos e encomendas com entregadores próximos. Para clientes, empresas e entregadores.',
  icons: { icon: '/icon.svg' },
  openGraph: { type: 'website', locale: 'pt_BR', siteName: 'LevoJá' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
