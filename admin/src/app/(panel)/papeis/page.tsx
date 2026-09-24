'use client';

import { FormEvent, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, useApi, useApiMutation } from '@levoja/web-kit/client';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  ErrorState,
  errorMessage,
  Input,
  PageHeader,
  SkeletonRows,
  Tabs,
  useToast,
} from '@levoja/web-kit/ui';
import { useSession } from '@/lib/session';
import type { Permission, Role } from '@/lib/types';

function groupPermissions(permissions: Permission[], scope: Role['scope']) {
  const groups = new Map<string, Permission[]>();
  for (const permission of permissions.filter((item) => item.scope === scope)) {
    groups.set(permission.group, [...(groups.get(permission.group) ?? []), permission]);
  }
  return [...groups.entries()];
}

function RoleEditor({ role, permissions, readOnly }: { role: Role; permissions: Permission[]; readOnly: boolean }) {
  const toast = useToast();
  const [selected, setSelected] = useState(new Set(role.permissionKeys));
  const [name, setName] = useState(role.name);
  const locked = readOnly || role.key === 'super_admin';
  const save = useApiMutation(
    () => api.patch(`admin/roles/${role.id}`, { name, description: role.description ?? undefined, permissionKeys: [...selected] }),
    ['admin/roles'],
  );
  const dirty = name !== role.name || [...selected].sort().join() !== [...role.permissionKeys].sort().join();

  const toggle = (key: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(key);
    else next.delete(key);
    setSelected(next);
  };

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {role.name}
          {role.isSystem && <Badge>Sistema</Badge>}
          {role.isStaff && <Badge tone="info">Acessa o painel</Badge>}
          <span className="text-xs font-normal text-muted">{role.assignedCount} atribuição(ões)</span>
        </span>
      }
      actions={
        !locked &&
        dirty && (
          <Button
            size="sm"
            loading={save.isPending}
            onClick={() => save.mutateAsync(undefined).then(() => toast.success('Papel atualizado.')).catch(toast.error)}
          >
            Salvar alterações
          </Button>
        )
      }
    >
      {role.description && <p className="mb-4 text-sm text-muted">{role.description}</p>}
      {!role.isSystem && !locked && <Input className="mb-4 max-w-sm" label="Nome" value={name} onChange={(e) => setName(e.target.value)} />}
      {role.key === 'super_admin' && <p className="mb-4 text-sm text-muted">O Super Admin possui todas as permissões e não pode ser alterado.</p>}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {groupPermissions(permissions, role.scope).map(([group, items]) => (
          <fieldset key={group}>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{group}</legend>
            <div className="space-y-1.5">
              {items.map((permission) => (
                <Checkbox
                  key={permission.key}
                  disabled={locked || permission.key === 'tenants.manage'}
                  checked={selected.has(permission.key)}
                  onChange={(e) => toggle(permission.key, e.target.checked)}
                  label={
                    <>
                      {permission.description}
                      <code className="block text-[11px] text-muted">{permission.key}</code>
                    </>
                  }
                />
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </Card>
  );
}

function NewRoleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ key: '', name: '', description: '' });
  const [scope, setScope] = useState<Role['scope']>('PLATFORM');
  const [error, setError] = useState<string>();
  const create = useApiMutation(
    () => api.post('admin/roles', { ...form, scope, isStaff: scope === 'PLATFORM', permissionKeys: [] }),
    ['admin/roles'],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await create.mutateAsync(undefined);
      toast.success('Papel criado. Agora defina as permissões.');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Novo papel">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Nome" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input
          label="Identificador"
          hint="Letras minúsculas, números e _ (ex.: atendimento_n2)"
          required
          value={form.key}
          onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase() })}
        />
        <Input label="Descrição" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={scope === 'PLATFORM'} onChange={() => setScope('PLATFORM')} className="accent-brand-500" /> Equipe da plataforma
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={scope === 'COMPANY'} onChange={() => setScope('COMPANY')} className="accent-brand-500" /> Membros de empresa
          </label>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={create.isPending}>
            Criar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function RolesPage() {
  const { can } = useSession();
  const roles = useApi<Role[]>('admin/roles');
  const permissions = useApi<Permission[]>('admin/permissions');
  const [scope, setScope] = useState<Role['scope']>('PLATFORM');
  const [creating, setCreating] = useState(false);
  const visible = useMemo(() => (roles.data ?? []).filter((role) => role.scope === scope), [roles.data, scope]);

  return (
    <>
      <PageHeader
        title="Papéis e permissões"
        description="Controle de acesso granular (RBAC). Alterações valem em até 1 minuto para usuários conectados."
        actions={
          can('roles.manage') && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Novo papel
            </Button>
          )
        }
      />
      <Tabs
        value={scope}
        onChange={setScope}
        items={[
          { value: 'PLATFORM', label: 'Plataforma' },
          { value: 'COMPANY', label: 'Empresas' },
        ]}
      />
      {(roles.isLoading || permissions.isLoading) && <SkeletonRows rows={6} />}
      {(roles.error || permissions.error) && <ErrorState error={roles.error ?? permissions.error} onRetry={() => roles.refetch()} />}
      {roles.data && permissions.data && (
        <div className="space-y-6">
          {visible.map((role) => (
            <RoleEditor key={`${role.id}-${role.permissionKeys.length}`} role={role} permissions={permissions.data} readOnly={!can('roles.manage')} />
          ))}
        </div>
      )}
      <NewRoleDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
