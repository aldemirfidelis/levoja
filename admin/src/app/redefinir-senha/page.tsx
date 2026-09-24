'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ForgotPasswordForm, SetPasswordForm } from '@levoja/web-kit/ui';

function Content() {
  const token = useSearchParams().get('token');
  return token ? <SetPasswordForm token={token} title="Crie uma nova senha" /> : <ForgotPasswordForm portal="admin" />;
}

export default function RedefinirSenhaPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-surface p-6">
        <Suspense>
          <Content />
        </Suspense>
        <p className="text-center text-sm">
          <Link href="/login" className="text-brand-600 hover:underline">
            Voltar ao login
          </Link>
        </p>
      </div>
    </main>
  );
}
