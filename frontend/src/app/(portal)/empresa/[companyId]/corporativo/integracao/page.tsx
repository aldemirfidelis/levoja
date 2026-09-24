'use client';

import { FormEvent, useState } from 'react';
import { Check, Copy, KeyRound, Plus } from 'lucide-react';
import { API_KEY_SCOPES, type ApiKeyScope } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, Dialog, EmptyState, ErrorState, formatDateTime, Input, SkeletonRows, useToast } from '@levoja/web-kit/ui';
import { useCompany } from '@/lib/company';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  active: boolean;
}

const SCOPES = Object.entries(API_KEY_SCOPES) as [ApiKeyScope, (typeof API_KEY_SCOPES)[ApiKeyScope]][];
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333').replace(/\/$/, '');

function CreateKeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (key: string) => void }) {
  const { company, can } = useCompany();
  const toast = useToast();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>(['deliveries:read']);
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await api.post<{ key: string }>(`companies/${company.id}/b2b/api-keys`, { name, scopes, expiresInDays: days ? Number(days) : undefined });
      onCreated(created.key);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title="Nova chave de API" description="A chave age em seu nome, somente nesta empresa e com os escopos escolhidos.">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Nome" required minLength={2} maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: ERP, e-commerce" />
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-fg">Escopos</legend>
          {SCOPES.map(([scope, definition]) => (
            <Checkbox
              key={scope}
              label={`${definition.label}${can(definition.permission) ? '' : ' (você não tem esta permissão)'}`}
              disabled={!can(definition.permission)}
              checked={scopes.includes(scope)}
              onChange={(event) => setScopes(event.target.checked ? [...scopes, scope] : scopes.filter((item) => item !== scope))}
            />
          ))}
        </fieldset>
        <Input label="Validade em dias (opcional)" type="number" min={1} max={730} value={days} onChange={(event) => setDays(event.target.value)} hint="Vazio = sem expiração. Revogue a chave quando não for mais usada." />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} disabled={!scopes.length}>
            Criar chave
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function SecretDialog({ secret, onClose }: { secret: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open onClose={onClose} title="Copie a chave agora" description="Por segurança, ela não será mostrada novamente. Guarde-a no cofre de segredos do seu sistema.">
      <div className="space-y-4">
        <code className="block break-all rounded-lg bg-surface-2 p-3 text-sm">{secret}</code>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            onClick={() => void navigator.clipboard.writeText(secret).then(() => setCopied(true))}
          >
            {copied ? 'Copiada' : 'Copiar'}
          </Button>
          <Button onClick={onClose}>Já guardei</Button>
        </div>
      </div>
    </Dialog>
  );
}

export default function IntegrationPage() {
  const { company } = useCompany();
  const toast = useToast();
  const { data, error, isLoading, refetch } = useApi<ApiKey[]>(`companies/${company.id}/b2b/api-keys`);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  const revoke = async () => {
    if (!revoking) return;
    try {
      await api.delete(`companies/${company.id}/b2b/api-keys/${revoking.id}`);
      toast.success('Chave revogada.');
      setRevoking(null);
      await refetch();
    } catch (err) {
      toast.error(err);
    }
  };

  const example = `curl -X POST ${API_URL}/v1/companies/${company.id}/delivery-batches \\
  -H "X-Api-Key: ljk_..." -H "Content-Type: application/json" \\
  -d '{"paymentMethod":"INVOICE","items":[{"externalRef":"NF-1","recipientName":"Maria","recipientPhone":"11987654321","street":"Av. Paulista","number":"1000","city":"São Paulo","state":"SP"}]}'`;

  return (
    <div className="space-y-6">
      <Card title="Chaves de API" actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nova chave</Button>}>
        {isLoading && <SkeletonRows rows={2} />}
        {error && <ErrorState error={error} onRetry={() => refetch()} />}
        {data?.length === 0 && <EmptyState icon={<KeyRound className="h-8 w-8" />} title="Nenhuma chave" description="Crie uma chave para o seu sistema enviar entregas e lotes automaticamente." />}
        {data && data.length > 0 && (
          <DataTable
            rows={data}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'name',
                header: 'Chave',
                cell: (row) => (
                  <div>
                    <p className="font-medium">{row.name}</p>
                    <p className="font-mono text-xs text-muted">{row.prefix}…</p>
                  </div>
                ),
              },
              { key: 'scopes', header: 'Escopos', cell: (row) => row.scopes.map((scope) => API_KEY_SCOPES[scope]?.label ?? scope).join(', '), hideOnMobile: true },
              { key: 'used', header: 'Último uso', cell: (row) => (row.lastUsedAt ? formatDateTime(row.lastUsedAt) : 'Nunca'), hideOnMobile: true },
              {
                key: 'status',
                header: 'Situação',
                cell: (row) => <Badge tone={row.active ? 'success' : 'neutral'}>{row.revokedAt ? 'Revogada' : row.active ? `Ativa${row.expiresAt ? ` até ${formatDateTime(row.expiresAt).slice(0, 10)}` : ''}` : 'Expirada'}</Badge>,
              },
              {
                key: 'actions',
                header: '',
                className: 'text-right',
                cell: (row) =>
                  !row.revokedAt && (
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRevoking(row)}>
                      Revogar
                    </Button>
                  ),
              },
            ]}
          />
        )}
      </Card>

      <Card title="Como integrar">
        <div className="space-y-3 text-sm">
          <p>
            Envie a chave no cabeçalho <code className="rounded bg-surface-2 px-1">X-Api-Key</code>. Ela vale apenas nas rotas de entregas e lotes desta empresa — nunca como login de pessoa.
          </p>
          <ul className="list-inside list-disc space-y-1 text-muted">
            <li>
              <code>POST /v1/companies/{company.id}/deliveries</code> — entrega avulsa (cotação em <code>/deliveries/quote</code>)
            </li>
            <li>
              <code>POST /v1/companies/{company.id}/delivery-batches</code> — lote em JSON (ou <code>/upload</code> com planilha)
            </li>
            <li>
              <code>POST …/delivery-batches/:id/confirm</code> — confirma o lote validado; <code>GET …/:id/items</code> acompanha cada entrega
            </li>
          </ul>
          <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs">{example}</pre>
          <a href={`${API_URL}/docs`} target="_blank" rel="noreferrer" className="inline-block font-medium text-brand-600 hover:underline">
            Documentação completa da API (OpenAPI)
          </a>
        </div>
      </Card>

      {creating && (
        <CreateKeyDialog
          onClose={() => setCreating(false)}
          onCreated={(key) => {
            setCreating(false);
            setSecret(key);
            void refetch();
          }}
        />
      )}
      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        onConfirm={revoke}
        tone="danger"
        title={`Revogar a chave "${revoking?.name ?? ''}"?`}
        confirmLabel="Revogar"
        description="Os sistemas que usam esta chave deixam de funcionar imediatamente."
      />
    </div>
  );
}
