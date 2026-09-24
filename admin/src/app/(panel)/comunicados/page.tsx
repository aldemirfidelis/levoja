'use client';

import { useState } from 'react';
import { Megaphone, Send } from 'lucide-react';
import { BROADCAST_AUDIENCE_LABELS, BROADCAST_CHANNEL_LABELS, BROADCAST_KIND_LABELS, BROADCAST_STATUS_LABELS } from '@levoja/shared';
import { api, Paginated, useApi } from '@levoja/web-kit/client';
import { Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, EmptyState, ErrorState, formatDateTime, Input, PageHeader, Pagination, Select, SkeletonRows, Textarea, Tone, useToast } from '@levoja/web-kit/ui';

type Audience = keyof typeof BROADCAST_AUDIENCE_LABELS;
type Kind = keyof typeof BROADCAST_KIND_LABELS;
type Channel = keyof typeof BROADCAST_CHANNEL_LABELS;

interface Broadcast {
  id: string;
  audience: Audience;
  kind: Kind;
  title: string;
  body: string;
  channels: Channel[];
  city: string | null;
  status: string;
  recipients: number;
  delivered: number;
  createdBy: string;
  createdAt: string;
  finishedAt: string | null;
}

const STATUS_TONE: Record<string, Tone> = { QUEUED: 'neutral', SENDING: 'info', SENT: 'success', FAILED: 'danger' };
const CHANNELS = Object.keys(BROADCAST_CHANNEL_LABELS) as Channel[];

export default function BroadcastsPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const { data, error, isLoading, refetch } = useApi<Paginated<Broadcast>>('admin/notifications/broadcasts', { page, pageSize: 20 }, {
    // Enquanto houver envio em andamento, acompanha o progresso.
    refetchInterval: (query) => (query.state.data?.data.some((item) => item.status === 'QUEUED' || item.status === 'SENDING') ? 3_000 : false),
  });
  const [form, setForm] = useState({ audience: 'CUSTOMERS' as Audience, kind: 'MARKETING' as Kind, channels: ['inapp', 'push'] as Channel[], city: '', title: '', body: '' });
  const [reach, setReach] = useState<{ audience: number; reachable: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [checking, setChecking] = useState(false);

  const invalidCombination = form.kind === 'OPERATIONAL' && form.audience === 'CUSTOMERS';
  const target = { audience: form.audience, kind: form.kind, channels: form.channels, city: form.city.trim() || undefined };
  const update = (patch: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...patch }));
    setReach(null);
  };
  const toggleChannel = (channel: Channel, on: boolean) => update({ channels: on ? [...form.channels, channel] : form.channels.filter((item) => item !== channel) });

  const review = async () => {
    setChecking(true);
    try {
      setReach(await api.post<{ audience: number; reachable: number }>('admin/notifications/broadcasts/preview', target));
      setConfirming(true);
    } catch (err) {
      toast.error(err);
    } finally {
      setChecking(false);
    }
  };

  const send = async () => {
    try {
      await api.post('admin/notifications/broadcasts', { ...target, title: form.title, body: form.body });
      toast.success('Comunicado na fila de envio.');
      setForm((current) => ({ ...current, title: '', body: '' }));
      setReach(null);
      setConfirming(false);
      setPage(1);
      await refetch();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <PageHeader title="Comunicados" description="Promoções (somente para quem autorizou) e avisos operacionais para entregadores e empresas." />
      <div className="grid gap-6 xl:grid-cols-5">
        <Card title="Novo comunicado" className="xl:col-span-2">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void review();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Tipo"
                value={form.kind}
                onChange={(event) => update({ kind: event.target.value as Kind })}
                options={Object.entries(BROADCAST_KIND_LABELS).map(([value, label]) => ({ value, label }))}
              />
              <Select
                label="Público"
                value={form.audience}
                onChange={(event) => update({ audience: event.target.value as Audience })}
                options={Object.entries(BROADCAST_AUDIENCE_LABELS).map(([value, label]) => ({ value, label }))}
                error={invalidCombination ? 'Avisos operacionais são só para entregadores e empresas.' : undefined}
              />
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-fg">Canais</legend>
              <div className="flex flex-wrap gap-4">
                {CHANNELS.map((channel) => (
                  <Checkbox key={channel} label={BROADCAST_CHANNEL_LABELS[channel]} checked={form.channels.includes(channel)} onChange={(event) => toggleChannel(channel, event.target.checked)} />
                ))}
              </div>
              {form.kind === 'MARKETING' && <p className="mt-2 text-xs text-muted">Push e e-mail de promoção só chegam a quem deu consentimento para cada canal (LGPD).</p>}
            </fieldset>
            <Input label="Cidade (opcional)" value={form.city} onChange={(event) => update({ city: event.target.value })} placeholder="Todas as cidades" maxLength={80} />
            <Input label="Título" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required minLength={3} maxLength={80} />
            <Textarea label="Mensagem" value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} required minLength={5} maxLength={500} rows={4} hint={`${form.body.length}/500`} />
            <Button type="submit" icon={<Send className="h-4 w-4" />} loading={checking} disabled={invalidCombination || !form.channels.length || form.title.trim().length < 3 || form.body.trim().length < 5}>
              Revisar e enviar
            </Button>
          </form>
        </Card>

        <div className="xl:col-span-3">
          {isLoading && <SkeletonRows />}
          {error && <ErrorState error={error} onRetry={() => refetch()} />}
          {data?.data.length === 0 && <EmptyState icon={<Megaphone className="h-8 w-8" />} title="Nenhum comunicado enviado" />}
          {data && data.data.length > 0 && (
            <>
              <DataTable
                rows={data.data}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: 'title',
                    header: 'Comunicado',
                    cell: (row) => (
                      <div className="min-w-0">
                        <p className="font-medium text-fg">{row.title}</p>
                        <p className="line-clamp-2 text-xs text-muted">{row.body}</p>
                      </div>
                    ),
                  },
                  {
                    key: 'target',
                    header: 'Público',
                    cell: (row) => (
                      <div className="text-sm">
                        <p>{BROADCAST_AUDIENCE_LABELS[row.audience]}</p>
                        <p className="text-xs text-muted">
                          {BROADCAST_KIND_LABELS[row.kind]} · {row.city ?? 'todas as cidades'} · {row.channels.map((channel) => BROADCAST_CHANNEL_LABELS[channel]).join(', ')}
                        </p>
                      </div>
                    ),
                    hideOnMobile: true,
                  },
                  { key: 'status', header: 'Situação', cell: (row) => <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{BROADCAST_STATUS_LABELS[row.status] ?? row.status}</Badge> },
                  {
                    key: 'reach',
                    header: 'Alcance',
                    className: 'text-right tabular-nums',
                    cell: (row) => (
                      <span title="Pessoas notificadas por algum canal / pessoas do público">
                        {row.delivered.toLocaleString('pt-BR')} / {row.recipients.toLocaleString('pt-BR')}
                      </span>
                    ),
                  },
                  { key: 'created', header: 'Enviado', cell: (row) => `${formatDateTime(row.createdAt)} · ${row.createdBy}`, hideOnMobile: true },
                ]}
              />
              <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={setPage} />
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirming && !!reach}
        onClose={() => setConfirming(false)}
        onConfirm={send}
        title="Enviar comunicado?"
        confirmLabel="Enviar agora"
        description={
          reach && (
            <>
              <strong>{BROADCAST_AUDIENCE_LABELS[form.audience]}</strong>
              {form.city.trim() ? ` em ${form.city.trim()}` : ''}: {reach.audience.toLocaleString('pt-BR')} pessoa(s) no público
              {form.kind === 'MARKETING' && !form.channels.includes('inapp') ? `, ${reach.reachable.toLocaleString('pt-BR')} com consentimento para os canais escolhidos` : ''}. O envio não pode ser desfeito.
            </>
          )
        }
      />
    </>
  );
}
