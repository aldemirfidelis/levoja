'use client';

import { FormEvent, useState } from 'react';
import { Activity, Check, Copy, KeyRound, Plus, Send, Webhook } from 'lucide-react';
import { API_KEY_SCOPES, WEBHOOK_DELIVERY_STATUS_LABELS, WEBHOOK_EVENT_LABELS, WEBHOOK_EVENTS, type ApiKeyScope, type WebhookEvent } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { Badge, Button, Card, Checkbox, ColumnChart, ConfirmDialog, DataTable, Dialog, EmptyState, formatDateTime, Input, PageHeader, SkeletonRows, useToast } from '@levoja/web-kit/ui';
import { useCompany } from '@/lib/company';
import { PlanAwareError } from '@/components/plan-gate';

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

interface Endpoint {
  id: string;
  url: string;
  description: string | null;
  events: WebhookEvent[];
  isActive: boolean;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  disabledReason: string | null;
}

interface WebhookDelivery {
  id: string;
  event: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  durationMs: number | null;
  nextAttemptAt: string | null;
  createdAt: string;
}

interface Usage {
  daily: { day: string; total: number; errors: number }[];
  byKey: { apiKeyId: string; name: string; calls: number; avgMs: number }[];
  recent: { id: string; method: string; path: string; status: number; durationMs: number; createdAt: string; keyName: string | null }[];
}

const SCOPES = Object.entries(API_KEY_SCOPES) as [ApiKeyScope, (typeof API_KEY_SCOPES)[ApiKeyScope]][];
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333').replace(/\/$/, '');
const DELIVERY_TONE = { PENDING: 'warning', SUCCEEDED: 'success', FAILED: 'danger' } as const;

function SecretDialog({ title, secret, onClose }: { title: string; secret: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open onClose={onClose} title={title} description="Por segurança, o valor não será mostrado novamente. Guarde-o no cofre de segredos do seu sistema.">
      <div className="space-y-4">
        <code className="block break-all rounded-lg bg-surface-2 p-3 text-sm">{secret}</code>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            onClick={() => void navigator.clipboard.writeText(secret).then(() => setCopied(true))}
          >
            {copied ? 'Copiado' : 'Copiar'}
          </Button>
          <Button onClick={onClose}>Já guardei</Button>
        </div>
      </div>
    </Dialog>
  );
}

function CreateKeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (key: string) => void }) {
  const { company, can } = useCompany();
  const toast = useToast();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>(['orders:read']);
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
    <Dialog open onClose={onClose} title="Nova chave de API" description="A chave age em seu nome, somente nesta empresa e com os escopos escolhidos. Escopos de catálogo e pedidos exigem o plano com API completa.">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Nome" required minLength={2} maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: ERP, e-commerce, PDV" />
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-fg">Escopos</legend>
          {SCOPES.map(([scope, definition]) => (
            <Checkbox
              key={scope}
              label={
                <span>
                  <code className="text-xs">{scope}</code> — {definition.label}
                  {can(definition.permission) ? '' : ' (você não tem esta permissão)'}
                </span>
              }
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

function ApiKeysCard() {
  const { company } = useCompany();
  const toast = useToast();
  const { data, error, isLoading, refetch } = useApi<ApiKey[]>(`companies/${company.id}/b2b/api-keys`);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  return (
    <Card title="Chaves de API" actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nova chave</Button>}>
      {isLoading && <SkeletonRows rows={2} />}
      {error && <PlanAwareError error={error} onRetry={() => refetch()} />}
      {data?.length === 0 && <EmptyState icon={<KeyRound className="h-8 w-8" />} title="Nenhuma chave" description="Crie uma chave para o seu sistema consultar pedidos, atualizar o catálogo ou enviar entregas." />}
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
            { key: 'scopes', header: 'Escopos', cell: (row) => <span className="font-mono text-xs">{row.scopes.join(', ')}</span>, hideOnMobile: true },
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
      {secret && <SecretDialog title="Copie a chave agora" secret={secret} onClose={() => setSecret(null)} />}
      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        tone="danger"
        title={`Revogar a chave "${revoking?.name ?? ''}"?`}
        confirmLabel="Revogar"
        description="Os sistemas que usam esta chave deixam de funcionar imediatamente."
        onConfirm={async () => {
          try {
            await api.delete(`companies/${company.id}/b2b/api-keys/${revoking!.id}`);
            toast.success('Chave revogada.');
            setRevoking(null);
            await refetch();
          } catch (err) {
            toast.error(err);
          }
        }}
      />
    </Card>
  );
}

function EndpointDialog({ endpoint, onClose, onSaved }: { endpoint: Endpoint | null; onClose: () => void; onSaved: (secret?: string) => void }) {
  const { company } = useCompany();
  const toast = useToast();
  const [url, setUrl] = useState(endpoint?.url ?? '');
  const [description, setDescription] = useState(endpoint?.description ?? '');
  const [events, setEvents] = useState<WebhookEvent[]>(endpoint?.events ?? ['order.created', 'order.status_changed']);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (endpoint) {
        await api.patch(`companies/${company.id}/webhooks/${endpoint.id}`, { url, description, events });
        onSaved();
      } else {
        const created = await api.post<{ secret: string }>(`companies/${company.id}/webhooks`, { url, description: description || undefined, events });
        onSaved(created.secret);
      }
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={endpoint ? 'Editar endpoint' : 'Novo endpoint de webhook'} description="Endereço HTTPS do seu sistema que recebe os eventos (POST com JSON assinado).">
      <form onSubmit={submit} className="space-y-4">
        <Input label="URL" type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://meusistema.com.br/webhooks/entregas" />
        <Input label="Descrição (opcional)" maxLength={120} value={description} onChange={(event) => setDescription(event.target.value)} />
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-fg">Eventos</legend>
          {WEBHOOK_EVENTS.map((name) => (
            <Checkbox
              key={name}
              label={
                <span>
                  <code className="text-xs">{name}</code> — {WEBHOOK_EVENT_LABELS[name]}
                </span>
              }
              checked={events.includes(name)}
              onChange={(event) => setEvents(event.target.checked ? [...events, name] : events.filter((item) => item !== name))}
            />
          ))}
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} disabled={!events.length}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeliveriesDialog({ endpoint, onClose }: { endpoint: Endpoint; onClose: () => void }) {
  const { company } = useCompany();
  const toast = useToast();
  const { data, refetch } = useApi<WebhookDelivery[]>(`companies/${company.id}/webhooks/${endpoint.id}/deliveries`);
  const retry = async (delivery: WebhookDelivery) => {
    try {
      const result = await api.post<WebhookDelivery>(`companies/${company.id}/webhook-deliveries/${delivery.id}/retry`);
      if (result.status === 'SUCCEEDED') toast.success('Evento entregue.');
      else toast.error(result.error ?? 'O destino não aceitou o evento.');
      await refetch();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Dialog open onClose={onClose} size="lg" title="Entregas recentes" description={endpoint.url}>
      {!data ? (
        <SkeletonRows rows={3} />
      ) : data.length === 0 ? (
        <p className="text-sm text-muted">Nenhum evento enviado ainda.</p>
      ) : (
        <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto text-sm">
          {data.map((delivery) => (
            <li key={delivery.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <p className="font-mono text-xs text-fg">{delivery.event}</p>
                <p className="text-xs text-muted">
                  {formatDateTime(delivery.createdAt)} · {delivery.attempts} tentativa(s)
                  {delivery.responseStatus ? ` · HTTP ${delivery.responseStatus}` : ''}
                  {delivery.durationMs != null ? ` · ${delivery.durationMs} ms` : ''}
                  {delivery.error ? ` · ${delivery.error}` : ''}
                  {delivery.status === 'PENDING' && delivery.nextAttemptAt ? ` · nova tentativa ${formatDateTime(delivery.nextAttemptAt)}` : ''}
                </p>
              </div>
              <span className="flex items-center gap-2">
                <Badge tone={DELIVERY_TONE[delivery.status]}>{WEBHOOK_DELIVERY_STATUS_LABELS[delivery.status]}</Badge>
                {delivery.status !== 'SUCCEEDED' && (
                  <Button size="sm" variant="ghost" onClick={() => void retry(delivery)}>
                    Reenviar
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function WebhooksCard() {
  const { company } = useCompany();
  const toast = useToast();
  const { data, error, isLoading, refetch } = useApi<Endpoint[]>(`companies/${company.id}/webhooks`);
  const [editing, setEditing] = useState<Endpoint | null | 'new'>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Endpoint | null>(null);
  const [removing, setRemoving] = useState<Endpoint | null>(null);

  const act = async (work: () => Promise<unknown>, message: string) => {
    try {
      await work();
      toast.success(message);
      await refetch();
    } catch (err) {
      toast.error(err);
    }
  };

  const test = async (endpoint: Endpoint) => {
    try {
      const result = await api.post<WebhookDelivery>(`companies/${company.id}/webhooks/${endpoint.id}/test`);
      if (result.status === 'SUCCEEDED') toast.success(`Teste entregue (HTTP ${result.responseStatus}, ${result.durationMs} ms).`);
      else toast.error(`Falha no teste: ${result.error ?? `HTTP ${result.responseStatus}`}`);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Card title="Webhooks" actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Novo endpoint</Button>}>
      {isLoading && <SkeletonRows rows={2} />}
      {error && <PlanAwareError error={error} onRetry={() => refetch()} />}
      {data?.length === 0 && <EmptyState icon={<Webhook className="h-8 w-8" />} title="Nenhum endpoint" description="Receba pedidos novos, mudanças de status e faturas no seu sistema, em tempo real." />}
      <ul className="space-y-3">
        {data?.map((endpoint) => (
          <li key={endpoint.id} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-fg">{endpoint.url}</p>
                {endpoint.description && <p className="text-xs text-muted">{endpoint.description}</p>}
                <p className="mt-1 text-xs text-muted">{endpoint.events.join(', ')}</p>
                <p className="mt-1 text-xs text-muted">
                  {endpoint.lastSuccessAt ? `Último sucesso ${formatDateTime(endpoint.lastSuccessAt)}` : 'Sem entregas com sucesso'}
                  {endpoint.consecutiveFailures ? ` · ${endpoint.consecutiveFailures} falha(s) seguida(s)` : ''}
                  {endpoint.disabledReason ? ` · desativado: ${endpoint.disabledReason}` : ''}
                </p>
              </div>
              <Badge tone={endpoint.isActive ? 'success' : 'neutral'}>{endpoint.isActive ? 'Ativo' : 'Inativo'}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Button size="sm" variant="secondary" icon={<Send className="h-3.5 w-3.5" />} onClick={() => void test(endpoint)}>
                Testar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setViewing(endpoint)}>
                Entregas
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(endpoint)}>
                Editar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void act(() => api.patch(`companies/${company.id}/webhooks/${endpoint.id}`, { isActive: !endpoint.isActive }), endpoint.isActive ? 'Endpoint desativado.' : 'Endpoint reativado.')}>
                {endpoint.isActive ? 'Desativar' : 'Reativar'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    const rotated = await api.post<{ secret: string }>(`companies/${company.id}/webhooks/${endpoint.id}/rotate-secret`);
                    setSecret(rotated.secret);
                  } catch (err) {
                    toast.error(err);
                  }
                }}
              >
                Novo segredo
              </Button>
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemoving(endpoint)}>
                Excluir
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {editing && (
        <EndpointDialog
          endpoint={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(created) => {
            setEditing(null);
            if (created) setSecret(created);
            else toast.success('Endpoint atualizado.');
            void refetch();
          }}
        />
      )}
      {secret && <SecretDialog title="Segredo de assinatura" secret={secret} onClose={() => setSecret(null)} />}
      {viewing && <DeliveriesDialog endpoint={viewing} onClose={() => setViewing(null)} />}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        tone="danger"
        title="Excluir o endpoint?"
        confirmLabel="Excluir"
        description="O histórico de entregas deste endpoint também é removido."
        onConfirm={async () => {
          await act(() => api.delete(`companies/${company.id}/webhooks/${removing!.id}`), 'Endpoint excluído.');
          setRemoving(null);
        }}
      />
    </Card>
  );
}

function UsageCard() {
  const { company } = useCompany();
  const { data, error, refetch } = useApi<Usage>(`companies/${company.id}/api-usage`, undefined, { refetchInterval: 60_000 });
  return (
    <Card title="Uso da API (7 dias)">
      {error && <PlanAwareError error={error} onRetry={() => refetch()} />}
      {!data && !error && <SkeletonRows rows={2} />}
      {data && data.recent.length === 0 && <EmptyState icon={<Activity className="h-8 w-8" />} title="Nenhuma chamada ainda" />}
      {data && data.recent.length > 0 && (
        <div className="space-y-4">
          <ColumnChart
            title="Chamadas à API por dia nos últimos 7 dias"
            labels={data.daily.map((row) => row.day.split('-').reverse().slice(0, 2).join('/'))}
            values={data.daily.map((row) => row.total)}
            tooltipLabel={(index) => `${data.daily[index].day.split('-').reverse().join('/')} · ${data.daily[index].errors} com erro`}
            format={(value) => value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
            height={180}
          />
          <ul className="divide-y divide-border text-sm">
            {data.byKey.map((row) => (
              <li key={row.apiKeyId} className="flex justify-between gap-2 py-1.5">
                <span className="text-fg">{row.name}</span>
                <span className="tabular-nums text-muted">
                  {row.calls.toLocaleString('pt-BR')} chamadas · {row.avgMs} ms em média
                </span>
              </li>
            ))}
          </ul>
          <details>
            <summary className="cursor-pointer text-sm font-medium text-brand-600">Chamadas recentes</summary>
            <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto font-mono text-xs">
              {data.recent.map((row) => (
                <li key={row.id} className="flex flex-wrap justify-between gap-2 py-1">
                  <span>
                    {row.method} {row.path}
                  </span>
                  <span className={row.status >= 400 ? 'text-danger' : 'text-muted'}>
                    {row.status} · {row.durationMs} ms · {formatDateTime(row.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </Card>
  );
}

export default function IntegrationsPage() {
  const { company } = useCompany();
  const example = `curl ${API_URL}/v1/companies/${company.id}/orders?status=NEW \\
  -H "X-Api-Key: ljk_..."`;
  return (
    <>
      <PageHeader
        title="Integrações"
        description="Conecte seu ERP, e-commerce ou PDV: chaves de API com escopos, webhooks assinados para receber eventos e o uso da API."
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <ApiKeysCard />
          <WebhooksCard />
        </div>
        <div className="space-y-6">
          <UsageCard />
          <Card title="Documentação">
            <div className="space-y-3 text-sm">
              <p>
                Envie a chave no cabeçalho <code className="rounded bg-surface-2 px-1">X-Api-Key</code>. Cada rota exige um escopo; o limite de chamadas por minuto segue o seu plano (cabeçalhos{' '}
                <code className="rounded bg-surface-2 px-1">X-RateLimit-*</code>).
              </p>
              <p>
                Os webhooks trazem <code className="rounded bg-surface-2 px-1">X-LevoJa-Signature: t=…,v1=…</code> — HMAC-SHA256 do segredo sobre <code>t.corpo</code>. Rejeite assinaturas antigas e use o{' '}
                <code>id</code> do evento para ignorar repetições.
              </p>
              <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs">{example}</pre>
              <a href={`${API_URL}/docs/public`} target="_blank" rel="noreferrer" className="inline-block font-medium text-brand-600 hover:underline">
                Documentação da API pública (OpenAPI)
              </a>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
