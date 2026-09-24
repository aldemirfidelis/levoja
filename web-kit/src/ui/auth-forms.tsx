'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { passwordIssues } from '@levoja/shared';
import { api } from '../client/api';
import { Button, Input } from './primitives';
import { errorMessage } from './feedback';

/** Define a senha a partir de um link (convite ou redefinição). */
export function SetPasswordForm({ token, title, loginHref = '/login' }: { token: string | null; title: string; loginHref?: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!token) return <p className="text-sm text-danger">Link inválido. Solicite um novo.</p>;
  if (done) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-fg">Senha definida com sucesso.</p>
        <Link href={loginHref} className="inline-block font-medium text-brand-600 hover:underline">
          Ir para o login
        </Link>
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const issues = passwordIssues(password);
    if (issues.length) return setError(issues.join(' '));
    if (password !== confirm) return setError('As senhas não conferem.');
    setBusy(true);
    setError(undefined);
    try {
      await api.post('auth/password/reset', { token, password });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-lg font-semibold">{title}</h1>
      <Input label="Nova senha" type="password" autoComplete="new-password" hint="Mínimo de 8 caracteres, com letras e números." value={password} onChange={(e) => setPassword(e.target.value)} required />
      <Input label="Confirme a senha" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <Button type="submit" className="w-full" loading={busy}>
        Salvar senha
      </Button>
    </form>
  );
}

/** Solicita o link de redefinição por e-mail. */
export function ForgotPasswordForm({ portal }: { portal: 'web' | 'admin' }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.post('auth/password/forgot', { email, portal });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <p className="text-sm text-fg">
        Se o e-mail estiver cadastrado, você receberá as instruções em instantes. Verifique também a caixa de spam.
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-lg font-semibold">Redefinir senha</h1>
      <Input label="E-mail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" className="w-full" loading={busy}>
        Enviar link
      </Button>
    </form>
  );
}
