'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ForgotPasswordForm, SetPasswordForm } from '@levoja/web-kit/ui';

function Content() {
  const token = useSearchParams().get('token');
  return token ? <SetPasswordForm token={token} title="Crie uma nova senha" loginHref="/entrar" /> : <ForgotPasswordForm portal="web" />;
}

export default function ResetPasswordPage() {
  return (
    <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-surface p-6">
      <Suspense>
        <Content />
      </Suspense>
      <p className="text-center text-sm">
        <Link href="/entrar" className="text-brand-600 hover:underline">
          Voltar ao login
        </Link>
      </p>
    </div>
  );
}
