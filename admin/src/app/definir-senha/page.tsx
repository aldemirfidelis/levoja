'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { SetPasswordForm } from '@levoja/web-kit/ui';

function Content() {
  const token = useSearchParams().get('token');
  return <SetPasswordForm token={token} title="Ative seu acesso" />;
}

export default function DefinirSenhaPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6">
        <Suspense>
          <Content />
        </Suspense>
      </div>
    </main>
  );
}
