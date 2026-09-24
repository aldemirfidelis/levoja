import type { Metadata } from 'next';
import { THEME_BOOTSTRAP_SCRIPT } from '@levoja/web-kit/theme-script';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'LevoJá Admin', template: '%s · LevoJá Admin' },
  description: 'Painel administrativo da plataforma LevoJá',
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg' },
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
