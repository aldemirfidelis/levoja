'use client';

import { FormEvent, useState } from 'react';
import { Globe2, Plus } from 'lucide-react';
import { api, useApi } from '@levoja/web-kit/client';
import { Badge, Button, ConfirmDialog, DataTable, Dialog, EmptyState, ErrorState, formatDate, Input, PageHeader, SkeletonRows, useToast } from '@levoja/web-kit/ui';

interface Branding {
  appName?: string;
  logoUrl?: string;
  primaryColor?: string;
  supportEmail?: string;
  supportPhone?: string;
  webUrl?: string;
  adminUrl?: string;
}

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  domains: string[];
  branding: Branding | null;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  users: number;
  companies: number;
  drivers: number;
}

function TenantDialog({ tenant, onClose, onSaved }: { tenant: TenantRow | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    slug: tenant?.slug ?? '',
    name: tenant?.name ?? '',
    domains: tenant?.domains.join('\n') ?? '',
    appName: tenant?.branding?.appName ?? '',
    primaryColor: tenant?.branding?.primaryColor ?? '#FF5A1F',
    supportEmail: tenant?.branding?.supportEmail ?? '',
    supportPhone: tenant?.branding?.supportPhone ?? '',
    webUrl: tenant?.branding?.webUrl ?? '',
    adminUrl: tenant?.branding?.adminUrl ?? '',
    adminName: '',
    adminEmail: '',
  });
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const branding = {
      appName: form.appName || form.name,
      primaryColor: form.primaryColor,
      supportEmail: form.supportEmail || undefined,
      supportPhone: form.supportPhone || undefined,
      webUrl: form.webUrl || undefined,
      adminUrl: form.adminUrl || undefined,
    };
    const domains = form.domains
      .split(/[\s,]+/)
      .map((domain) => domain.trim())
      .filter(Boolean);
    try {
      if (tenant) await api.patch(`admin/tenants/${tenant.id}`, { name: form.name, domains, branding });
      else await api.post('admin/tenants', { slug: form.slug, name: form.name, domains, branding, admin: { name: form.adminName, email: form.adminEmail } });
      toast.success(tenant ? 'Tenant atualizado.' : 'Tenant criado. O administrador recebeu o convite por e-mail.');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} size="lg" title={tenant ? tenant.name : 'Novo tenant (white label)'} description="Cada tenant tem marca, domínios, regras (preços, comissões, planos, configurações) e usuários próprios.">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Input label="Identificador" required disabled={!!tenant} pattern="[a-z0-9-]{3,40}" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase() })} hint="Usado no cabeçalho X-Tenant dos apps." />
        <Input label="Nome da operação" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <Input label="Nome do app/marca" value={form.appName} onChange={(event) => setForm({ ...form, appName: event.target.value })} placeholder={form.name} />
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-fg">Cor principal</span>
          <span className="flex items-center gap-2">
            <input type="color" aria-label="Cor principal" value={form.primaryColor} onChange={(event) => setForm({ ...form, primaryColor: event.target.value.toUpperCase() })} className="h-10 w-14 rounded border border-border bg-surface" />
            <Input aria-label="Cor em hexadecimal" value={form.primaryColor} onChange={(event) => setForm({ ...form, primaryColor: event.target.value })} />
          </span>
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-fg">Domínios (um por linha)</span>
          <textarea
            className="min-h-20 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            value={form.domains}
            onChange={(event) => setForm({ ...form, domains: event.target.value })}
            placeholder="entregas.empresa.com.br"
          />
          <span className="mt-1 block text-xs text-muted">Aponte o DNS (CNAME) para o portal e a API. Requisições nesses domínios usam este tenant.</span>
        </label>
        <Input label="E-mail de suporte" type="email" value={form.supportEmail} onChange={(event) => setForm({ ...form, supportEmail: event.target.value })} />
        <Input label="Telefone de suporte" value={form.supportPhone} onChange={(event) => setForm({ ...form, supportPhone: event.target.value })} />
        <Input label="Endereço do portal" type="url" value={form.webUrl} onChange={(event) => setForm({ ...form, webUrl: event.target.value })} placeholder="https://entregas.empresa.com.br" />
        <Input label="Endereço do painel" type="url" value={form.adminUrl} onChange={(event) => setForm({ ...form, adminUrl: event.target.value })} placeholder="https://admin.entregas.empresa.com.br" />
        {!tenant && (
          <>
            <Input label="Administrador(a) — nome" required minLength={3} value={form.adminName} onChange={(event) => setForm({ ...form, adminName: event.target.value })} />
            <Input label="Administrador(a) — e-mail" type="email" required value={form.adminEmail} onChange={(event) => setForm({ ...form, adminEmail: event.target.value })} />
          </>
        )}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy}>
            {tenant ? 'Salvar' : 'Criar tenant'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function TenantsPage() {
  const toast = useToast();
  const { data, error, isLoading, refetch } = useApi<TenantRow[]>('admin/tenants');
  const [editing, setEditing] = useState<TenantRow | null | 'new'>(null);
  const [toggling, setToggling] = useState<TenantRow | null>(null);

  return (
    <>
      <PageHeader
        title="Tenants (white label)"
        description="Operações com marca própria na mesma plataforma: domínio, app, cores, regras e base de usuários separadas."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            Novo tenant
          </Button>
        }
      />
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.length === 0 && <EmptyState icon={<Globe2 className="h-8 w-8" />} title="Nenhum tenant" />}
      {data && data.length > 0 && (
        <DataTable
          rows={data}
          rowKey={(row) => row.id}
          onRowClick={(row) => setEditing(row)}
          columns={[
            {
              key: 'name',
              header: 'Tenant',
              cell: (row) => (
                <div className="flex items-center gap-3">
                  <span className="h-6 w-6 shrink-0 rounded-full border border-border" style={{ background: row.branding?.primaryColor ?? '#FF5A1F' }} aria-hidden />
                  <div>
                    <p className="font-medium">{row.branding?.appName ?? row.name}</p>
                    <p className="text-xs text-muted">
                      {row.slug}
                      {row.domains.length ? ` · ${row.domains.join(', ')}` : ''}
                    </p>
                  </div>
                </div>
              ),
            },
            { key: 'status', header: 'Situação', cell: (row) => <Badge tone={row.status === 'ACTIVE' ? 'success' : 'danger'}>{row.status === 'ACTIVE' ? 'Ativo' : 'Suspenso'}</Badge> },
            { key: 'users', header: 'Usuários', className: 'text-right tabular-nums', cell: (row) => row.users, hideOnMobile: true },
            { key: 'companies', header: 'Empresas', className: 'text-right tabular-nums', cell: (row) => row.companies, hideOnMobile: true },
            { key: 'drivers', header: 'Entregadores', className: 'text-right tabular-nums', cell: (row) => row.drivers, hideOnMobile: true },
            { key: 'created', header: 'Desde', cell: (row) => formatDate(row.createdAt), hideOnMobile: true },
            {
              key: 'actions',
              header: '',
              cell: (row) => (
                <Button
                  size="sm"
                  variant="ghost"
                  className={row.status === 'ACTIVE' ? 'text-danger' : ''}
                  onClick={(event) => {
                    event.stopPropagation();
                    setToggling(row);
                  }}
                >
                  {row.status === 'ACTIVE' ? 'Suspender' : 'Reativar'}
                </Button>
              ),
            },
          ]}
        />
      )}
      {editing && (
        <TenantDialog
          tenant={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refetch();
          }}
        />
      )}
      <ConfirmDialog
        open={!!toggling}
        onClose={() => setToggling(null)}
        tone={toggling?.status === 'ACTIVE' ? 'danger' : 'primary'}
        title={toggling?.status === 'ACTIVE' ? `Suspender ${toggling?.name}?` : `Reativar ${toggling?.name}?`}
        description={toggling?.status === 'ACTIVE' ? 'Todos os apps, portais e a API desse tenant ficam indisponíveis até a reativação.' : 'O tenant volta a funcionar normalmente.'}
        confirmLabel={toggling?.status === 'ACTIVE' ? 'Suspender' : 'Reativar'}
        onConfirm={async () => {
          try {
            await api.patch(`admin/tenants/${toggling!.id}`, { status: toggling!.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' });
            toast.success('Situação do tenant alterada.');
            setToggling(null);
            await refetch();
          } catch (err) {
            toast.error(err);
          }
        }}
      />
    </>
  );
}
