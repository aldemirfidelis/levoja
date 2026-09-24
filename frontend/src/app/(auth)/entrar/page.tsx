'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, session } from '@levoja/web-kit/client';
import { Button, errorMessage, Input } from '@levoja/web-kit/ui';
import { homeFor, MeSummary, safeNext } from '@/lib/auth-redirect';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = mfaToken
        ? await session.mfa<{ mfaRequired?: boolean; mfaToken?: string }>({ mfaToken, code })
        : await session.login<{ mfaRequired?: boolean; mfaToken?: string }>({ login, password });
      if (result.mfaRequired) {
        setMfaToken(result.mfaToken);
        return;
      }
      const me = await api.get<MeSummary>('auth/me');
      router.replace(safeNext(params.get('next'), homeFor(me)));
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
          <Input label="E-mail ou celular" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />
          <Input label="Senha" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </>
      ) : (
        <Input
          label="Código de verificação"
          hint="Abra seu app autenticador e digite o código de 6 dígitos."
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
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        {mfaToken ? 'Verificar' : 'Entrar'}
      </Button>
      <div className="flex justify-between text-sm">
        <Link href="/redefinir-senha" className="text-brand-600 hover:underline">
          Esqueci minha senha
        </Link>
        <Link href="/cadastro" className="text-brand-600 hover:underline">
          Criar conta
        </Link>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="w-full max-w-sm">
      <h1 className="mb-1 text-2xl font-extrabold text-fg">Entrar</h1>
      <p className="mb-6 text-sm text-muted">Clientes, empresas e entregadores usam a mesma conta.</p>
      <div className="rounded-2xl border border-border bg-surface p-6">
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
