'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { SetPasswordForm } from '@levoja/web-kit/ui';

function Content() {
  return <SetPasswordForm token={useSearchParams().get('token')} title="Ative seu acesso" loginHref="/entrar" />;
}

export default function SetPasswordPage() {
  return (
    <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6">
      <Suspense>
        <Content />
      </Suspense>
    </div>
  );
}
