'use client';

import { ApiProvider } from '@levoja/web-kit/client';
import { BrandProvider, ToastProvider } from '@levoja/web-kit/ui';
import type { TenantBranding } from '@levoja/shared';

export function Providers({ brand, children }: { brand: TenantBranding; children: React.ReactNode }) {
  return (
    <BrandProvider value={brand}>
      <ApiProvider>
        <ToastProvider>{children}</ToastProvider>
      </ApiProvider>
    </BrandProvider>
  );
}
