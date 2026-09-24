'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { session } from '@levoja/web-kit/client';
import { Button, errorMessage, Input } from '@levoja/web-kit/ui';

type LoginResponse = { mfaRequired?: boolean; mfaToken?: string; authenticated?: boolean };

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const next = params.get('next');
  const destination = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = mfaToken
        ? await session.mfa<LoginResponse>({ mfaToken, code })
        : await session.login<LoginResponse>({ login, password });
      if (result.mfaRequired) {
        setMfaToken(result.mfaToken);
        return;
      }
      router.replace(destination);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {!mfaToken ? (
        <>
          <Input label="E-mail ou telefone" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />
          <Input label="Senha" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </>
      ) : (
        <Input
          label="Código do autenticador"
          hint="Digite o código de 6 dígitos do seu app autenticador."
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          required
          autoFocus
        />
      )}
      {error && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" loading={busy}>
        {mfaToken ? 'Verificar' : 'Entrar'}
      </Button>
      <p className="text-center text-sm">
        <Link href="/redefinir-senha" className="text-brand-600 hover:underline">
          Esqueci minha senha
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-3xl font-extrabold text-brand-500">LevoJá</p>
          <p className="mt-1 text-sm text-muted">Painel administrativo — acesso restrito à equipe</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
