'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { api, useApi } from '@levoja/web-kit/client';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DescriptionList,
  ErrorState,
  formatDate,
  formatDateTime,
  formatPhone,
  PageHeader,
  PartnerStatusBadge,
  SkeletonRows,
  UserStatusBadge,
  useToast,
} from '@levoja/web-kit/ui';
import { useSession } from '@/lib/session';
import type { AdminUserDetail, Role } from '@/lib/types';

type StatusAction = 'SUSPEND' | 'BLOCK' | 'DEACTIVATE' | 'REACTIVATE';
const STATUS_ACTIONS: Record<StatusAction, { label: string; tone: 'danger' | 'success' }> = {
  SUSPEND: { label: 'Suspender', tone: 'danger' },
  BLOCK: { label: 'Bloquear', tone: 'danger' },
  DEACTIVATE: { label: 'Desativar', tone: 'danger' },
  REACTIVATE: { label: 'Reativar', tone: 'success' },
};

function RolesEditor({ user, onSaved }: { user: AdminUserDetail; onSaved: () => void }) {
  const toast = useToast();
  const { data: roles } = useApi<Role[]>('admin/roles');
  const [selected, setSelected] = useState<string[]>(user.roles.map((role) => role.key));
  const [busy, setBusy] = useState(false);
  useEffect(() => setSelected(user.roles.map((role) => role.key)), [user.roles]);

  const platformRoles = (roles ?? []).filter((role) => role.scope === 'PLATFORM');
  const dirty = [...selected].sort().join() !== user.roles.map((role) => role.key).sort().join();

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`admin/users/${user.id}/roles`, { roleKeys: selected });
      toast.success('Papéis atualizados.');
      onSaved();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Papéis na plataforma" actions={dirty && <Button size="sm" loading={busy} onClick={save}>Salvar</Button>}>
      <div className="grid gap-2 sm:grid-cols-2">
        {platformRoles.map((role) => (
          <Checkbox
            key={role.key}
            label={
              <>
                {role.name} {role.isStaff && <Badge tone="info">Equipe</Badge>}
              </>
            }
            checked={selected.includes(role.key)}
            onChange={(e) => setSelected(e.target.checked ? [...selected, role.key] : selected.filter((key) => key !== role.key))}
          />
        ))}
      </div>
    </Card>
  );
}

export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, can } = useSession();
  const toast = useToast();
  const { data, error, isLoading, refetch } = useApi<AdminUserDetail>(`admin/users/${id}`);
  const [pending, setPending] = useState<StatusAction | null>(null);

  if (isLoading) return <SkeletonRows rows={6} />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  const isSelf = data.id === me.user.id;
  const actions: StatusAction[] = data.status === 'ACTIVE' ? ['SUSPEND', 'BLOCK', 'DEACTIVATE'] : ['REACTIVATE'];

  const changeStatus = async (action: StatusAction, reason: string) => {
    await api.post(`admin/users/${id}/status`, { action, reason: reason || undefined });
    toast.success('Status atualizado.');
    await refetch();
  };

  const sendReset = async () => {
    try {
      await api.post(`admin/users/${id}/password-reset`);
      toast.success('Link de redefinição enviado por e-mail.');
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <PageHeader
        back={
          <Link href="/usuarios" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" /> Usuários
          </Link>
        }
        title={data.name}
        description={<UserStatusBadge status={data.status} />}
        actions={
          <>
            {can('users.update') && (
              <Button variant="secondary" size="sm" onClick={sendReset}>
                Enviar redefinição de senha
              </Button>
            )}
            {can('users.status.manage') &&
              !isSelf &&
              actions.map((action) => (
                <Button key={action} size="sm" variant={STATUS_ACTIONS[action].tone} onClick={() => setPending(action)}>
                  {STATUS_ACTIONS[action].label}
                </Button>
              ))}
          </>
        }
      />
      {data.statusReason && (
        <p className="mb-6 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <strong>Motivo:</strong> {data.statusReason}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Dados">
            <DescriptionList
              items={[
                { label: 'E-mail', value: <>{data.email} {data.emailVerified && <Badge tone="success">verificado</Badge>}</> },
                { label: 'Telefone', value: <>{formatPhone(data.phone)} {data.phoneVerified && <Badge tone="success">verificado</Badge>}</> },
                { label: 'CPF', value: data.cpfMasked },
                { label: 'Nascimento', value: formatDate(data.birthDate) },
                { label: 'Verificação em duas etapas', value: data.mfaEnabled ? 'Ativa' : 'Inativa' },
                { label: 'Último acesso', value: formatDateTime(data.lastLoginAt) },
                { label: 'Cadastro', value: formatDateTime(data.createdAt) },
              ]}
            />
          </Card>
          {can('roles.manage') && <RolesEditor user={data} onSaved={() => refetch()} />}
          <Card title={`Sessões ativas (${data.activeSessions.length})`}>
            {data.activeSessions.length === 0 ? (
              <p className="text-sm text-muted">Nenhuma sessão ativa.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {data.activeSessions.map((sessionItem) => (
                  <li key={sessionItem.familyId} className="py-2">
                    <p className="truncate text-fg">{sessionItem.userAgent ?? 'Dispositivo desconhecido'}</p>
                    <p className="text-xs text-muted">
                      {sessionItem.ip ?? '—'} · {formatDateTime(sessionItem.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Perfis">
            <ul className="space-y-3 text-sm">
              {data.customer && <li>Cliente desde {formatDate(data.customer.createdAt)}</li>}
              {data.driver && (
                <li className="flex items-center justify-between gap-2">
                  <Link href={`/entregadores/${data.driver.id}`} className="text-brand-600 hover:underline">
                    Entregador
                  </Link>
                  <PartnerStatusBadge status={data.driver.status} />
                </li>
              )}
              {data.companies.map((membership) => (
                <li key={membership.company.id} className="flex items-center justify-between gap-2">
                  <Link href={`/empresas/${membership.company.id}`} className="truncate text-brand-600 hover:underline">
                    {membership.company.tradeName}
                  </Link>
                  <Badge>{membership.role.name}</Badge>
                </li>
              ))}
              {!data.customer && !data.driver && data.companies.length === 0 && <li className="text-muted">Somente equipe interna.</li>}
            </ul>
          </Card>
          {can('audit.read') && (
            <Link href={`/auditoria?actorId=${data.id}`} className="block text-center text-sm text-brand-600 hover:underline">
              Ações realizadas por este usuário
            </Link>
          )}
        </div>
      </div>

      {pending && (
        <ConfirmDialog
          open
          onClose={() => setPending(null)}
          onConfirm={(reason) => changeStatus(pending, reason)}
          title={`${STATUS_ACTIONS[pending].label} ${data.name}`}
          description={pending === 'REACTIVATE' ? 'O acesso será restabelecido.' : 'Todas as sessões do usuário serão encerradas imediatamente.'}
          confirmLabel={STATUS_ACTIONS[pending].label}
          tone={STATUS_ACTIONS[pending].tone}
          reason={{ label: 'Motivo', required: pending !== 'REACTIVATE' }}
        />
      )}
    </>
  );
}
