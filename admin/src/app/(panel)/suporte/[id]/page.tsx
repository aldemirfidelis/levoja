'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Lock, MessagesSquare, Paperclip, Sparkles, Star, X } from 'lucide-react';
import {
  CONVERSATION_TYPE_LABELS,
  formatBRL,
  TICKET_CATEGORY_LABELS,
  TICKET_EVENT_LABELS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_REQUESTER_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_STAFF_LABELS,
} from '@levoja/shared';
import { api, useApi, useRealtime } from '@levoja/web-kit/client';
import { Badge, Button, Card, Checkbox, DescriptionList, Dialog, ErrorState, formatDateTime, formatPhone, PageHeader, Select, Skeleton, Textarea, useToast } from '@levoja/web-kit/ui';
import { PriorityBadge, SlaIndicator, TicketStatusBadge } from '@/components/support-badges';
import { useSession } from '@/lib/session';
import type { TicketDetail } from '@/lib/types';

interface SupportDraft {
  source: 'ai' | 'template';
  reply: string;
  summary: string;
  suggestedCategory: string | null;
  suggestedPriority: string | null;
  staffActions: string[];
  confidence: 'low' | 'medium' | 'high';
  notice: string;
}

const CONFIDENCE = { low: 'baixa', medium: 'média', high: 'alta' } as const;

interface StaffConversation {
  id: string;
  type: keyof typeof CONVERSATION_TYPE_LABELS;
  messages: { id: string; senderRole: string; body: string; createdAt: string }[];
}

const ROLE_LABELS: Record<string, string> = { CUSTOMER: 'Cliente', COMPANY: 'Loja', DRIVER: 'Entregador', STAFF: 'Equipe', SYSTEM: 'Sistema' };
const bytes = (size: number) => (size >= 1_048_576 ? `${(size / 1_048_576).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`);

function eventText(event: TicketDetail['events'][number], staffNames: Map<string, string>) {
  const label = TICKET_EVENT_LABELS[event.type] ?? event.type;
  const value = (raw: string | null) => {
    if (!raw) return '—';
    if (event.type === 'STATUS' || event.type === 'REOPENED' || event.type === 'AUTO_CLOSED') return TICKET_STATUS_STAFF_LABELS[raw as keyof typeof TICKET_STATUS_STAFF_LABELS] ?? raw;
    if (event.type === 'PRIORITY' || event.type === 'CREATED') return TICKET_PRIORITY_LABELS[raw as keyof typeof TICKET_PRIORITY_LABELS] ?? raw;
    if (event.type === 'ASSIGNED') return staffNames.get(raw) ?? 'atendente';
    if (event.type === 'RATED') return `${raw} ★`;
    return raw;
  };
  if (event.type === 'CREATED') return `${label} · prioridade ${value(event.toValue)}`;
  if (event.fromValue || event.type === 'STATUS' || event.type === 'PRIORITY') return `${label}: ${value(event.fromValue)} → ${value(event.toValue)}`;
  return event.toValue ? `${label}: ${value(event.toValue)}` : label;
}

function ConversationsDialog({ orderId, deliveryId, onClose }: { orderId: string | null; deliveryId: string | null; onClose: () => void }) {
  const { data, error } = useApi<StaffConversation[]>('admin/conversations', { orderId: orderId ?? undefined, deliveryId: orderId ? undefined : (deliveryId ?? undefined) });
  return (
    <Dialog open onClose={onClose} size="lg" title="Conversas do pedido/entrega" description="Somente leitura. O acesso fica registrado na auditoria.">
      {error && <ErrorState error={error} />}
      {data?.length === 0 && <p className="text-sm text-muted">Nenhuma conversa neste pedido/entrega.</p>}
      <div className="space-y-5">
        {data?.map((conversation) => (
          <section key={conversation.id}>
            <h3 className="mb-2 text-sm font-semibold">{CONVERSATION_TYPE_LABELS[conversation.type]}</h3>
            {conversation.messages.length === 0 ? (
              <p className="text-sm text-muted">Sem mensagens.</p>
            ) : (
              <ul className="space-y-2">
                {conversation.messages.map((message) => (
                  <li key={message.id} className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
                    <p className="text-xs text-muted">
                      {ROLE_LABELS[message.senderRole] ?? message.senderRole} · {formatDateTime(message.createdAt)}
                    </p>
                    <p className="whitespace-pre-wrap text-fg">{message.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </Dialog>
  );
}

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = useSession();
  const toast = useToast();
  const canManage = can('support.tickets.manage');
  const { data, error, isLoading, refetch } = useApi<TicketDetail>(`admin/support/tickets/${id}`);
  useRealtime({ 'support.ticket.updated': (payload: { ticketId?: string }) => payload?.ticketId === id && void refetch() });
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [chats, setChats] = useState(false);
  const [draft, setDraft] = useState<SupportDraft | null>(null);
  const file = useRef<HTMLInputElement>(null);

  /** Rascunho sugerido (IA ou modelo de texto): preenche o campo; nada é enviado sem o atendente. */
  const suggest = async () => {
    setBusy('draft');
    try {
      const result = await api.post<SupportDraft>(`admin/intelligence/support/${id}/draft`);
      setDraft(result);
      setInternal(false);
      setBody(result.reply);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await action();
      toast.success(success);
      await refetch();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-96" />;
  const closed = data.status === 'CLOSED';
  const staffNames = new Map<string, string>([[me.user.id, me.user.name], ...(data.assignee ? [[data.assignee.id, data.assignee.name] as [string, string]] : [])]);

  const send = () =>
    run(
      'reply',
      async () => {
        await api.post(`admin/support/tickets/${id}/messages`, { body, internal });
        setBody('');
        setInternal(false);
        setDraft(null);
      },
      internal ? 'Nota interna registrada.' : 'Resposta enviada ao solicitante.',
    );

  const upload = async (selected: File | undefined) => {
    if (!selected) return;
    const form = new FormData();
    form.append('file', selected);
    form.append('internal', String(internal));
    await run('upload', () => api.upload(`admin/support/tickets/${id}/attachments`, form), 'Anexo enviado.');
    if (file.current) file.current.value = '';
  };

  return (
    <>
      <PageHeader
        back={
          <Link href="/suporte" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" /> Central de atendimento
          </Link>
        }
        title={`#${data.number} · ${data.subject}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <TicketStatusBadge status={data.status} />
            <PriorityBadge priority={data.priority} />
            <Badge>{TICKET_CATEGORY_LABELS[data.category as keyof typeof TICKET_CATEGORY_LABELS] ?? data.category}</Badge>
            <SlaIndicator state={data.sla.state} dueAt={data.sla.dueAt} />
          </span>
        }
        actions={
          (data.orderId || data.deliveryId) && (
            <Button variant="secondary" icon={<MessagesSquare className="h-4 w-4" />} onClick={() => setChats(true)}>
              Conversas do pedido
            </Button>
          )
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Conversa">
            <ol className="space-y-3">
              <li className="rounded-lg border border-border p-3 text-sm">
                <p className="text-xs text-muted">
                  {data.requester.name} · {formatDateTime(data.createdAt)}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-fg">{data.description}</p>
              </li>
              {data.messages.map((message) => (
                <li
                  key={message.id}
                  className={`rounded-lg p-3 text-sm ${message.internal ? 'border border-dashed border-warning bg-warning/5' : message.authorRole === 'STAFF' ? 'ml-6 bg-brand-500/5' : 'border border-border'}`}
                >
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    {message.internal && <Lock className="h-3.5 w-3.5 text-warning" aria-hidden />}
                    {message.internal ? 'Nota interna · ' : ''}
                    {message.authorName} · {formatDateTime(message.createdAt)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-fg">{message.body}</p>
                </li>
              ))}
            </ol>

            {canManage && !closed && (
              <form
                className="mt-5 space-y-3 border-t border-border pt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (body.trim()) void send();
                }}
              >
                {draft && (
                  <div className="rounded-lg border border-brand-500/30 bg-brand-500/5 p-3 text-sm" role="status">
                    <div className="flex items-start justify-between gap-2">
                      <p className="flex items-center gap-1.5 font-medium text-fg">
                        <Sparkles className="h-4 w-4 text-brand-600" aria-hidden />
                        {draft.source === 'ai' ? 'Sugestão da IA' : 'Sugestão por modelo de texto'}
                        {draft.source === 'ai' && <Badge tone={draft.confidence === 'high' ? 'success' : draft.confidence === 'medium' ? 'info' : 'warning'}>Confiança {CONFIDENCE[draft.confidence]}</Badge>}
                      </p>
                      <button type="button" className="text-muted hover:text-fg" onClick={() => setDraft(null)} aria-label="Fechar sugestão">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-1 text-muted">{draft.notice}</p>
                    {draft.summary && <p className="mt-2 text-fg">Resumo: {draft.summary}</p>}
                    {(draft.suggestedPriority || draft.suggestedCategory) && (
                      <p className="mt-1 text-fg">
                        {draft.suggestedPriority && <>Prioridade sugerida: {TICKET_PRIORITY_LABELS[draft.suggestedPriority as keyof typeof TICKET_PRIORITY_LABELS]}. </>}
                        {draft.suggestedCategory && <>Categoria sugerida: {TICKET_CATEGORY_LABELS[draft.suggestedCategory as keyof typeof TICKET_CATEGORY_LABELS]}.</>}
                      </p>
                    )}
                    {draft.staffActions.length > 0 && (
                      <div className="mt-2">
                        <p className="font-medium text-fg">Depende da equipe:</p>
                        <ul className="ml-4 list-disc text-fg">
                          {draft.staffActions.map((action) => (
                            <li key={action}>{action}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                <Textarea
                  label={internal ? 'Nota interna (visível só para a equipe)' : 'Responder ao solicitante'}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={4}
                  maxLength={5000}
                  required
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Checkbox label="Nota interna" checked={internal} onChange={(event) => setInternal(event.target.checked)} />
                  <div className="flex gap-2">
                    <input ref={file} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => void upload(event.target.files?.[0])} />
                    <Button type="button" variant="secondary" icon={<Sparkles className="h-4 w-4" />} loading={busy === 'draft'} onClick={() => void suggest()}>
                      Sugerir resposta
                    </Button>
                    <Button type="button" variant="secondary" icon={<Paperclip className="h-4 w-4" />} loading={busy === 'upload'} onClick={() => file.current?.click()}>
                      Anexar
                    </Button>
                    <Button type="submit" loading={busy === 'reply'} disabled={!body.trim()}>
                      {internal ? 'Registrar nota' : 'Enviar resposta'}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </Card>

          <Card title={`Anexos (${data.attachments.length})`}>
            {data.attachments.length === 0 ? (
              <p className="text-sm text-muted">Nenhum anexo.</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.attachments.map((attachment) => (
                  <li key={attachment.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <a href={api.fileUrl(`admin/support/tickets/${id}/attachments/${attachment.id}/file`)} target="_blank" rel="noreferrer" className="min-w-0 truncate text-brand-600 hover:underline">
                      {attachment.fileName}
                    </a>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                      {attachment.internal && <Badge tone="warning">Interno</Badge>}
                      {bytes(attachment.size)} · {formatDateTime(attachment.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Histórico">
            <ol className="space-y-2 text-sm">
              {data.events.map((event) => (
                <li key={event.id} className="flex flex-wrap justify-between gap-2">
                  <span className="text-fg">{eventText(event, staffNames)}</span>
                  <span className="text-xs text-muted">
                    {event.actorName} · {formatDateTime(event.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          {canManage && !closed && (
            <Card title="Atendimento">
              <div className="space-y-4">
                <Select
                  label="Situação"
                  value={data.status}
                  disabled={busy === 'status'}
                  onChange={(event) => void run('status', () => api.post(`admin/support/tickets/${id}/status`, { status: event.target.value }), 'Situação atualizada.')}
                  options={TICKET_STATUSES.map((status) => ({ value: status, label: TICKET_STATUS_STAFF_LABELS[status] }))}
                />
                <Select
                  label="Prioridade"
                  hint="Os prazos de SLA são recalculados a partir da abertura."
                  value={data.priority}
                  disabled={busy === 'priority'}
                  onChange={(event) => void run('priority', () => api.post(`admin/support/tickets/${id}/priority`, { priority: event.target.value }), 'Prioridade atualizada.')}
                  options={TICKET_PRIORITIES.map((priority) => ({ value: priority, label: TICKET_PRIORITY_LABELS[priority] }))}
                />
                <div>
                  <p className="text-sm font-medium text-fg">Responsável</p>
                  <p className="mb-2 text-sm text-muted">{data.assignee?.name ?? 'Ninguém ainda'}</p>
                  <div className="flex gap-2">
                    {data.assignee?.id !== me.user.id && (
                      <Button size="sm" variant="secondary" loading={busy === 'assign'} onClick={() => void run('assign', () => api.post(`admin/support/tickets/${id}/assign`, { assigneeId: me.user.id }), 'Chamado assumido.')}>
                        Assumir
                      </Button>
                    )}
                    {data.assignee && (
                      <Button size="sm" variant="ghost" loading={busy === 'unassign'} onClick={() => void run('unassign', () => api.post(`admin/support/tickets/${id}/assign`, { assigneeId: null }), 'Responsável removido.')}>
                        Liberar
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          )}

          <Card title="Solicitante">
            <DescriptionList
              items={[
                { label: 'Nome', value: data.requester.name },
                { label: 'Perfil', value: TICKET_REQUESTER_LABELS[data.requesterRole] },
                { label: 'E-mail', value: data.requester.email },
                { label: 'Telefone', value: formatPhone(data.requester.phone) },
              ]}
            />
          </Card>

          <Card title="Prazos">
            <DescriptionList
              items={[
                { label: 'Aberto em', value: formatDateTime(data.createdAt) },
                { label: 'Primeira resposta até', value: formatDateTime(data.firstResponseDueAt) },
                { label: 'Respondido em', value: formatDateTime(data.firstRespondedAt) },
                { label: 'Resolução até', value: formatDateTime(data.resolutionDueAt) },
                { label: 'Resolvido em', value: formatDateTime(data.resolvedAt) },
                {
                  label: 'Avaliação',
                  value: data.rating ? (
                    <span className="inline-flex items-center gap-1">
                      <Star className="h-4 w-4 fill-current text-warning" aria-hidden /> {data.rating}/5 {data.ratingComment ? `· “${data.ratingComment}”` : ''}
                    </span>
                  ) : (
                    '—'
                  ),
                },
              ]}
            />
          </Card>

          {(data.order || data.delivery || data.payment) && (
            <Card title="Vinculado a">
              <DescriptionList
                items={[
                  ...(data.order
                    ? [{ label: 'Pedido', value: <Link href={`/pedidos?search=${data.order.number}`} className="text-brand-600 hover:underline">#{data.order.number} · {data.order.company.tradeName} · {formatBRL(data.order.totalCents)}</Link> }]
                    : []),
                  ...(data.delivery ? [{ label: 'Entrega', value: <Link href={`/entregas?search=${data.delivery.code}`} className="text-brand-600 hover:underline">{data.delivery.code}</Link> }] : []),
                  ...(data.payment ? [{ label: 'Pagamento', value: `${formatBRL(data.payment.amountCents)} · ${data.payment.method} · ${data.payment.status}` }] : []),
                ]}
              />
            </Card>
          )}
        </div>
      </div>
      {chats && <ConversationsDialog orderId={data.orderId} deliveryId={data.deliveryId} onClose={() => setChats(false)} />}
    </>
  );
}
