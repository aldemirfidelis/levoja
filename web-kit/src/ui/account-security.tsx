'use client';

import { FormEvent, useState } from 'react';
import QRCode from 'react-qr-code';
import { passwordIssues } from '@levoja/shared';
import { api } from '../client/api';
import { useApi } from '../client/hooks';
import { Button, Card, Input } from './primitives';
import { errorMessage, useToast } from './feedback';
import { Badge, formatDateTime } from './data';

/** Blocos de segurança da conta (senha, verificação em duas etapas, sessões) usados em todos os portais. */
interface SessionItem {
  id: string;
  lastActivityAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

export function ChangePasswordCard() {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const issues = passwordIssues(form.newPassword);
    if (issues.length) return setError(issues.join(' '));
    if (form.newPassword !== form.confirm) return setError('As senhas não conferem.');
    setBusy(true);
    setError(undefined);
    try {
      await api.post('auth/password/change', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      toast.success('Senha alterada. As outras sessões foram encerradas.');
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Alterar senha">
      <form onSubmit={submit} className="max-w-sm space-y-4">
        <Input label="Senha atual" type="password" autoComplete="current-password" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        <Input label="Nova senha" type="password" autoComplete="new-password" required value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        <Input label="Confirme a nova senha" type="password" autoComplete="new-password" required value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" loading={busy}>
          Alterar senha
        </Button>
      </form>
    </Card>
  );
}

export function TwoFactorCard({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(message);
      setSetup(null);
      setCode('');
      setPassword('');
      onChange();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={<span className="flex items-center gap-2">Verificação em duas etapas {enabled ? <Badge tone="success">Ativa</Badge> : <Badge tone="warning">Inativa</Badge>}</span>}>
      {!enabled && !setup && (
        <div className="space-y-3">
          <p className="text-sm text-muted">Recomendado para toda a equipe: além da senha, será pedido um código do app autenticador.</p>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setSetup(await api.post('auth/mfa/setup'));
              } catch (err) {
                toast.error(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            Configurar
          </Button>
        </div>
      )}
      {setup && (
        <div className="grid gap-6 md:grid-cols-[auto_1fr]">
          <div className="rounded-lg bg-white p-3">
            <QRCode value={setup.otpauthUrl} size={168} />
          </div>
          <div className="space-y-3">
            <p className="text-sm">1. Escaneie o QR code no Google Authenticator, Microsoft Authenticator ou similar.</p>
            <p className="text-xs text-muted">
              Ou digite a chave: <code className="break-all">{setup.secret}</code>
            </p>
            <p className="text-sm">2. Informe o código gerado:</p>
            <div className="flex max-w-xs gap-2">
              <Input aria-label="Código" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              <Button loading={busy} disabled={code.length !== 6} onClick={() => run(() => api.post('auth/mfa/enable', { code }), 'Verificação em duas etapas ativada.')}>
                Ativar
              </Button>
            </div>
          </div>
        </div>
      )}
      {enabled && (
        <div className="grid max-w-md gap-3 sm:grid-cols-2">
          <Input label="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Input label="Código atual" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <Button
            variant="danger"
            className="sm:col-span-2 sm:w-fit"
            loading={busy}
            disabled={!password || code.length !== 6}
            onClick={() => run(() => api.post('auth/mfa/disable', { password, code }), 'Verificação em duas etapas desativada.')}
          >
            Desativar
          </Button>
        </div>
      )}
    </Card>
  );
}

export function SessionsCard() {
  const toast = useToast();
  const { data, refetch } = useApi<SessionItem[]>('auth/sessions');
  return (
    <Card title="Sessões ativas">
      <ul className="divide-y divide-border">
        {(data ?? []).map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <div className="min-w-0">
              <p className="truncate">{item.userAgent ?? 'Dispositivo desconhecido'}</p>
              <p className="text-xs text-muted">
                {item.ip ?? '—'} · {formatDateTime(item.lastActivityAt)}
              </p>
            </div>
            {item.current ? (
              <Badge tone="success">Esta sessão</Badge>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  api
                    .delete(`auth/sessions/${item.id}`)
                    .then(() => {
                      toast.success('Sessão encerrada.');
                      return refetch();
                    })
                    .catch(toast.error)
                }
              >
                Encerrar
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
