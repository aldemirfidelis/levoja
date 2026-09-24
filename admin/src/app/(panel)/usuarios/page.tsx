'use client';

import { FormEvent, Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, Users } from 'lucide-react';
import { USER_STATUS_LABELS, USER_STATUSES } from '@levoja/shared';
import { api, Paginated, useApi } from '@levoja/web-kit/client';
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  errorMessage,
  formatDateTime,
  Input,
  PageHeader,
  Pagination,
  Select,
  SkeletonRows,
  UserStatusBadge,
  useToast,
} from '@levoja/web-kit/ui';
import { SearchInput, useUrlFilters } from '@/components/list-filters';
import { Can } from '@/lib/session';
import type { AdminUserListItem, Role } from '@/lib/types';

const TYPES = [
  { value: 'staff', label: 'Equipe interna' },
  { value: 'customer', label: 'Clientes' },
  { value: 'driver', label: 'Entregadores' },
  { value: 'company', label: 'Empresas' },
];

function InviteDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const { data: roles } = useApi<Role[]>(open ? 'admin/roles' : null);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [roleKeys, setRoleKeys] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const staffRoles = (roles ?? []).filter((role) => role.scope === 'PLATFORM' && role.isStaff);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!roleKeys.length) return setError('Selecione ao menos um papel.');
    setBusy(true);
    setError(undefined);
    try {
      const user = await api.post<{ id: string }>('admin/users', { ...form, phone: form.phone || undefined, roleKeys });
      toast.success('Convite enviado por e-mail.');
      onCreated(user.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Convidar membro da equipe" description="A pessoa receberá um e-mail para definir a senha e ativar o acesso.">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Nome" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="E-mail" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input label="Telefone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Papéis</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {staffRoles.map((role) => (
              <Checkbox
                key={role.key}
                label={
                  <>
                    {role.name}
                    <span className="block text-xs text-muted">{role.description}</span>
                  </>
                }
                checked={roleKeys.includes(role.key)}
                onChange={(e) => setRoleKeys(e.target.checked ? [...roleKeys, role.key] : roleKeys.filter((key) => key !== role.key))}
              />
            ))}
          </div>
        </fieldset>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy}>
            Enviar convite
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function UsersList() {
  const router = useRouter();
  const [inviting, setInviting] = useState(false);
  const [filters, setFilters] = useUrlFilters({ type: '', status: '', search: '', page: '1' });
  const { data, error, isLoading, refetch } = useApi<Paginated<AdminUserListItem>>('admin/users', { ...filters, pageSize: 20 });

  return (
    <>
      <PageHeader
        title="Usuários"
        description="Clientes, entregadores, empresas e equipe interna."
        actions={
          <Can permission="users.create">
            <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviting(true)}>
              Convidar membro da equipe
            </Button>
          </Can>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Buscar por nome, e-mail ou telefone" />
        <Select className="sm:w-48" value={filters.type} onChange={(e) => setFilters({ type: e.target.value })} placeholder="Todos os perfis" options={TYPES} aria-label="Perfil" />
        <Select
          className="sm:w-44"
          value={filters.status}
          onChange={(e) => setFilters({ status: e.target.value })}
          placeholder="Todos os status"
          options={USER_STATUSES.map((status) => ({ value: status, label: USER_STATUS_LABELS[status] }))}
          aria-label="Status"
        />
      </div>

      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && data.data.length === 0 && <EmptyState icon={<Users className="h-8 w-8" />} title="Nenhum usuário encontrado" />}
      {data && data.data.length > 0 && (
        <>
          <DataTable
            rows={data.data}
            rowKey={(row) => row.id}
            onRowClick={(row) => router.push(`/usuarios/${row.id}`)}
            columns={[
              {
                key: 'name',
                header: 'Usuário',
                cell: (row) => (
                  <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{row.name}</p>
                    <p className="truncate text-xs text-muted">{row.email}</p>
                  </div>
                ),
              },
              {
                key: 'profiles',
                header: 'Perfis',
                hideOnMobile: true,
                cell: (row) => (
                  <div className="flex flex-wrap gap-1">
                    {row.roles.map((role) => (
                      <Badge key={role.key} tone="brand">
                        {role.name}
                      </Badge>
                    ))}
                    {row.companiesCount > 0 && <Badge tone="info">Empresa ({row.companiesCount})</Badge>}
                  </div>
                ),
              },
              { key: 'status', header: 'Status', cell: (row) => <UserStatusBadge status={row.status} /> },
              { key: 'lastLogin', header: 'Último acesso', hideOnMobile: true, cell: (row) => formatDateTime(row.lastLoginAt) },
            ]}
          />
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={(page) => setFilters({ page: String(page) })} />
        </>
      )}
      <InviteDialog open={inviting} onClose={() => setInviting(false)} onCreated={(id) => router.push(`/usuarios/${id}`)} />
    </>
  );
}

export default function UsersPage() {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <UsersList />
    </Suspense>
  );
}
