'use client';

import { ApiProvider } from '@levoja/web-kit/client';
import { ToastProvider } from '@levoja/web-kit/ui';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ApiProvider>
      <ToastProvider>{children}</ToastProvider>
    </ApiProvider>
  );
}
