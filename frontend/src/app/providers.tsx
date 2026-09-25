'use client';

import { ApiProvider } from '@levoja/web-kit/client';
import { BrandProvider, ToastProvider } from '@levoja/web-kit/ui';
import type { TenantBranding } from '@levoja/shared';
import { PwaSupport } from '@/components/pwa';

export function Providers({ brand, children }: { brand: TenantBranding; children: React.ReactNode }) {
  return (
    <BrandProvider value={brand}>
      <ApiProvider>
        <ToastProvider>
          {children}
          <PwaSupport />
        </ToastProvider>
      </ApiProvider>
    </BrandProvider>
  );
}
