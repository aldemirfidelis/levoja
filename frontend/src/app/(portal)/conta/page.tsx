'use client';

import { FormEvent, Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, Paginated, useApi, useApiMutation } from '@levoja/web-kit/client';
import {
  AddressForm,
  AddressValue,
  Badge,
  Button,
  Card,
  ChangePasswordCard,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  errorMessage,
  formatDateTime,
  Input,
  SessionsCard,
  SkeletonRows,
  Tabs,
  Textarea,
  TwoFactorCard,
  useToast,
  WalletStatement,
} from '@levoja/web-kit/ui';
import { formatBRL } from '@levoja/shared';
import { usePortal } from '@/lib/portal-session';
import { maskCpf, maskPhone } from '@/components/signup-fields';

type Tab = 'perfil' | 'enderecos' | 'creditos' | 'notificacoes' | 'privacidade' | 'seguranca';

function Profile() {
  const { me, refresh } = usePortal();
  const toast = useToast();
  const [form, setForm] = useState({ name: me.user.name, phone: maskPhone(me.user.phone?.replace('+55', '') ?? ''), birthDate: me.user.birthDate ?? '', cpf: '' });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState<'email' | 'phone' | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.patch('me', { name: form.name, phone: form.phone, birthDate: form.birthDate || undefined, cpf: form.cpf || undefined });
      toast.success('Perfil atualizado.');
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async (channel: 'email' | 'phone') => {
    try {
      await api.post('auth/verification/send', { channel });
      setVerifying(channel);
      toast.info(channel === 'email' ? 'Enviamos um código para o seu e-mail.' : 'Enviamos um código por SMS.');
    } catch (err) {
      toast.error(err);
    }
  };

  const confirm = async () => {
    try {
      await api.post('auth/verification/confirm', { channel: verifying, code });
      toast.success('Verificado!');
      setVerifying(null);
      setCode('');
      refresh();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <Card title="Dados pessoais">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Input label="Nome" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Celular" value={form.phone} onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })} />
          <Input label="Data de nascimento" type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} />
          {me.user.cpfMasked ? (
            <Input label="CPF" disabled value={me.user.cpfMasked} hint="Para alterar, fale com o suporte." />
          ) : (
            <Input label="CPF" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: maskCpf(e.target.value) })} />
          )}
          {error && <p className="text-sm text-danger sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2">
            <Button type="submit" loading={busy}>
              Salvar
            </Button>
          </div>
        </form>
      </Card>
      <Card title="Verificação de contato">
        <ul className="space-y-3 text-sm">
          <li className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {me.user.email} {me.user.emailVerified ? <Badge tone="success">Verificado</Badge> : <Badge tone="warning">Não verificado</Badge>}
            </span>
            {!me.user.emailVerified && (
              <Button size="sm" variant="secondary" onClick={() => sendCode('email')}>
                Verificar e-mail
              </Button>
            )}
          </li>
          {me.user.phone && (
            <li className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {me.user.phone} {me.user.phoneVerified ? <Badge tone="success">Verificado</Badge> : <Badge tone="warning">Não verificado</Badge>}
              </span>
              {!me.user.phoneVerified && (
                <Button size="sm" variant="secondary" onClick={() => sendCode('phone')}>
                  Verificar celular
                </Button>
              )}
            </li>
          )}
        </ul>
        {verifying && (
          <div className="mt-4 flex max-w-sm gap-2">
            <Input aria-label="Código" placeholder="Código de 6 dígitos" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <Button disabled={code.length !== 6} onClick={confirm}>
              Confirmar
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

interface Address extends AddressValue {
  id: string;
  isDefault: boolean;
}

function Addresses() {
  const toast = useToast();
  const { data, isLoading, refetch } = useApi<Address[]>('me/addresses');
  const [editing, setEditing] = useState<Address | 'new' | null>(null);
  const [removing, setRemoving] = useState<Address | null>(null);

  if (isLoading) return <SkeletonRows rows={3} />;
  if (editing) {
    return (
      <Card title={editing === 'new' ? 'Novo endereço' : 'Editar endereço'}>
        <AddressForm
          withLabel
          initial={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSubmit={async (address) => {
            if (editing === 'new') await api.post('me/addresses', address);
            else await api.put(`me/addresses/${editing.id}`, address);
            toast.success('Endereço salvo.');
            setEditing(null);
            await refetch();
          }}
        />
      </Card>
    );
  }
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
          Novo endereço
        </Button>
      </div>
      {!data?.length ? (
        <EmptyState icon={<MapPin className="h-8 w-8" />} title="Nenhum endereço cadastrado" description="Cadastre onde você quer receber seus pedidos." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((address) => (
            <div key={address.id} className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">
                  {address.label ?? 'Endereço'} {address.isDefault && <Badge tone="brand">Padrão</Badge>}
                </p>
                <div className="flex gap-1">
                  <button onClick={() => setEditing(address)} className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label="Editar">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => setRemoving(address)} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-danger" aria-label="Remover">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm text-muted">
                {address.street}, {address.number}
                {address.complement ? ` - ${address.complement}` : ''}
                <br />
                {address.district}, {address.city}/{address.state} · {address.zipCode}
              </p>
              {!address.isDefault && (
                <button
                  className="mt-3 text-sm font-medium text-brand-600 hover:underline"
                  onClick={() =>
                    api
                      .put(`me/addresses/${address.id}`, { ...stripAddress(address), isDefault: true })
                      .then(() => refetch())
                      .catch(toast.error)
                  }
                >
                  Definir como padrão
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {removing && (
        <ConfirmDialog
          open
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api.delete(`me/addresses/${removing.id}`);
            await refetch();
          }}
          title="Remover endereço?"
          confirmLabel="Remover"
          tone="danger"
        />
      )}
    </>
  );
}

function stripAddress(address: Address) {
  const { id: _id, isDefault: _default, ...rest } = address as Address & Record<string, unknown>;
  const allowed = ['label', 'recipientName', 'zipCode', 'street', 'number', 'complement', 'district', 'city', 'state', 'reference', 'lat', 'lng'];
  return Object.fromEntries(Object.entries(rest).filter(([key, value]) => allowed.includes(key) && value !== null));
}

interface Notification {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

function Notifications() {
  const { data, isLoading, refetch } = useApi<Paginated<Notification> & { unread: number }>('me/notifications', { pageSize: 50 });
  const markAll = useApiMutation(() => api.post('me/notifications/read-all'), ['me/notifications']);
  if (isLoading) return <SkeletonRows />;
  return (
    <Card
      title={`Notificações${data?.unread ? ` (${data.unread} não lidas)` : ''}`}
      actions={
        !!data?.unread && (
          <Button size="sm" variant="secondary" loading={markAll.isPending} onClick={() => markAll.mutate(undefined)}>
            Marcar todas como lidas
          </Button>
        )
      }
    >
      {!data?.data.length ? (
        <p className="text-sm text-muted">Nenhuma notificação.</p>
      ) : (
        <ul className="divide-y divide-border">
          {data.data.map((item) => (
            <li
              key={item.id}
              className="flex gap-3 py-3"
              onClick={() => !item.readAt && api.post(`me/notifications/${item.id}/read`).then(() => refetch())}
            >
              <span className={item.readAt ? 'mt-1.5 h-2 w-2 shrink-0 rounded-full bg-transparent' : 'mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500'} aria-hidden />
              <div>
                <p className="text-sm font-medium">{item.title}</p>
                <p className="text-sm text-muted">{item.body}</p>
                <p className="mt-1 text-xs text-muted">{formatDateTime(item.createdAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface ConsentStatus {
  consents: { type: string; granted: boolean; version: string | null; updatedAt: string }[];
  pendingAcceptance: string[];
}

const MARKETING = [
  { type: 'MARKETING_EMAIL', label: 'Ofertas e novidades por e-mail' },
  { type: 'MARKETING_PUSH', label: 'Ofertas por notificação no celular' },
  { type: 'MARKETING_SMS', label: 'Ofertas por SMS' },
  { type: 'MARKETING_WHATSAPP', label: 'Ofertas por WhatsApp' },
];

function Privacy() {
  const toast = useToast();
  const { data, refetch } = useApi<ConsentStatus>('me/consents');
  const [deleting, setDeleting] = useState(false);
  const [reason, setReason] = useState('');
  const granted = (type: string) => !!data?.consents.find((consent) => consent.type === type)?.granted;

  const toggle = async (type: string, value: boolean) => {
    try {
      await api.post('me/consents', { type, granted: value });
      await refetch();
    } catch (error) {
      toast.error(error);
    }
  };

  const download = async () => {
    try {
      const response = await fetch('/api/proxy/me/data-export', { headers: { 'x-lj-csrf': '1' } });
      if (!response.ok) throw new Error('Não foi possível exportar seus dados.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <div className="space-y-6">
      {!!data?.pendingAcceptance.length && (
        <Card title="Termos atualizados">
          <p className="mb-3 text-sm text-muted">Publicamos novas versões dos nossos documentos. Leia e aceite para continuar usando a plataforma.</p>
          <Button onClick={() => api.post('me/consents/accept-current').then(() => refetch()).catch(toast.error)}>Li e aceito as novas versões</Button>
        </Card>
      )}
      <Card title="Comunicações">
        <div className="space-y-3">
          {MARKETING.map((item) => (
            <Checkbox key={item.type} label={item.label} checked={granted(item.type)} onChange={(e) => toggle(item.type, e.target.checked)} />
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Avisos sobre seus pedidos e sua conta são sempre enviados, independentemente destas opções.</p>
      </Card>
      <Card title="Seus dados (LGPD)">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={download}>
            Baixar meus dados
          </Button>
          <Button variant="danger" onClick={() => setDeleting(true)}>
            Solicitar exclusão da conta
          </Button>
        </div>
        {deleting && (
          <div className="mt-4 space-y-3 rounded-xl border border-danger/30 bg-danger/5 p-4">
            <p className="text-sm">
              Sua solicitação será analisada em até 15 dias. Após a exclusão, seus dados pessoais serão anonimizados e não será possível recuperar a conta.
              Registros com guarda obrigatória por lei serão mantidos sem identificá-lo.
            </p>
            <Textarea label="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={() =>
                  api
                    .post('me/privacy/deletion-request', { reason: reason || undefined })
                    .then(() => {
                      toast.success('Solicitação registrada. Você receberá a confirmação por e-mail.');
                      setDeleting(false);
                    })
                    .catch(toast.error)
                }
              >
                Confirmar solicitação
              </Button>
              <Button variant="secondary" onClick={() => setDeleting(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Créditos na carteira (estornos em crédito), usados como forma de pagamento. */
function Credits() {
  const { data } = useApi<{ availableCents: number }>('customers/me/wallet');
  return (
    <div className="space-y-6">
      <Card>
        <p className="text-sm text-muted">Saldo de créditos</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">{data ? formatBRL(data.availableCents) : '—'}</p>
        <p className="mt-2 text-sm text-muted">Créditos vêm de estornos e compensações. Use-os para pagar pedidos e entregas escolhendo &quot;Carteira digital&quot;.</p>
      </Card>
      <Card title="Movimentações">
        <WalletStatement path="customers/me/wallet/transactions" emptyText="Você ainda não recebeu créditos." />
      </Card>
    </div>
  );
}

function AccountContent() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { me, refresh } = usePortal();
  const tab = (params.get('aba') as Tab) ?? 'perfil';
  const setTab = (next: Tab) => router.replace(`${pathname}?aba=${next}`, { scroll: false });

  return (
    <>
      <h1 className="text-2xl font-extrabold">Olá, {me.user.name.split(' ')[0]}</h1>
      {params.get('bemvindo') && (
        <p className="mt-2 rounded-lg bg-success/10 px-4 py-3 text-sm">Conta criada com sucesso! Em breve você poderá fazer pedidos direto por aqui e pelo app.</p>
      )}
      <div className="mt-6">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'perfil', label: 'Perfil' },
            { value: 'enderecos', label: 'Endereços' },
            ...(me.customerId ? [{ value: 'creditos' as const, label: 'Créditos' }] : []),
            { value: 'notificacoes', label: 'Notificações' },
            { value: 'privacidade', label: 'Privacidade' },
            { value: 'seguranca', label: 'Segurança' },
          ]}
        />
      </div>
      {tab === 'perfil' && <Profile />}
      {tab === 'enderecos' && <Addresses />}
      {tab === 'creditos' && me.customerId && <Credits />}
      {tab === 'notificacoes' && <Notifications />}
      {tab === 'privacidade' && <Privacy />}
      {tab === 'seguranca' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <TwoFactorCard enabled={me.user.mfaEnabled} onChange={refresh} />
          <ChangePasswordCard />
          <div className="lg:col-span-2">
            <SessionsCard />
          </div>
        </div>
      )}
    </>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <AccountContent />
    </Suspense>
  );
}
