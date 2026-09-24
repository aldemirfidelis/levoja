'use client';

import { FormEvent, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { api, useApi, useApiMutation } from '@levoja/web-kit/client';
import { Badge, Button, Card, ConfirmDialog, Dialog, errorMessage, ErrorState, Input, Select, SkeletonRows, useToast } from '@levoja/web-kit/ui';
import { useCompany } from '@/lib/company';
import { usePortal } from '@/lib/portal-session';

interface Member {
  id: string;
  isActive: boolean;
  user: { id: string; name: string; email: string; status: string; lastLoginAt: string | null };
  role: { id: string; key: string; name: string };
}

interface CompanyRole {
  key: string;
  name: string;
  description: string | null;
}

export default function CompanyTeamPage() {
  const { company } = useCompany();
  const { me } = usePortal();
  const toast = useToast();
  const base = `companies/${company.id}`;
  const members = useApi<Member[]>(`${base}/members`);
  const roles = useApi<CompanyRole[]>(`${base}/member-roles`);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [form, setForm] = useState({ name: '', email: '', roleKey: 'company_attendant' });
  const [error, setError] = useState<string>();

  const invite = useApiMutation(() => api.post<{ invited: boolean }>(`${base}/members`, form), [`${base}/members`]);
  const changeRole = useApiMutation((input: { id: string; roleKey: string; isActive?: boolean }) => api.patch(`${base}/members/${input.id}`, input), [`${base}/members`]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await invite.mutateAsync(undefined);
      toast.success(result.invited ? 'Convite enviado por e-mail.' : 'Membro adicionado.');
      setInviting(false);
      setForm({ name: '', email: '', roleKey: 'company_attendant' });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (members.isLoading || roles.isLoading) return <SkeletonRows />;
  if (members.error) return <ErrorState error={members.error} onRetry={() => members.refetch()} />;
  const roleOptions = (roles.data ?? []).map((role) => ({ value: role.key, label: role.name }));

  return (
    <>
      <Card
        title="Equipe"
        actions={
          <Button size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviting(true)}>
            Adicionar membro
          </Button>
        }
      >
        <ul className="divide-y divide-border">
          {members.data?.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {member.user.name} {member.user.id === me.user.id && <Badge>Você</Badge>} {!member.isActive && <Badge tone="warning">Inativo</Badge>}
                </p>
                <p className="text-sm text-muted">{member.user.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  aria-label="Papel"
                  className="w-48"
                  value={member.role.key}
                  disabled={member.user.id === me.user.id}
                  options={roleOptions}
                  onChange={(e) =>
                    changeRole
                      .mutateAsync({ id: member.id, roleKey: e.target.value })
                      .then(() => toast.success('Papel atualizado.'))
                      .catch(toast.error)
                  }
                />
                {member.user.id !== me.user.id && (
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(member)}>
                    Remover
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-2">
          {roles.data?.map((role) => (
            <p key={role.key}>
              <strong className="text-fg">{role.name}:</strong> {role.description}
            </p>
          ))}
        </div>
      </Card>

      <Dialog open={inviting} onClose={() => setInviting(false)} title="Adicionar membro" description="Se a pessoa ainda não tiver conta, enviaremos um convite por e-mail.">
        <form onSubmit={submit} className="space-y-4">
          <Input label="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="E-mail" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Select label="Papel" value={form.roleKey} options={roleOptions} onChange={(e) => setForm({ ...form, roleKey: e.target.value })} />
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setInviting(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={invite.isPending}>
              Adicionar
            </Button>
          </div>
        </form>
      </Dialog>

      {removing && (
        <ConfirmDialog
          open
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api.delete(`${base}/members/${removing.id}`);
            toast.success('Membro removido.');
            await members.refetch();
          }}
          title={`Remover ${removing.user.name}?`}
          description="A pessoa perderá o acesso a esta empresa imediatamente."
          confirmLabel="Remover"
          tone="danger"
        />
      )}
    </>
  );
}
