'use client';

import { FormEvent, useRef, useState } from 'react';
import { ArrowLeft, LifeBuoy, Paperclip, Plus, Star } from 'lucide-react';
import { TICKET_CATEGORIES, TICKET_CATEGORY_LABELS, TICKET_STATUS_LABELS, TicketCategory, TicketStatus } from '@levoja/shared';
import { api, Paginated } from '../client/api';
import { useApi } from '../client/hooks';
import { useRealtime } from '../client/realtime';
import { Button, Input, Select, Textarea, cn } from './primitives';
import { EmptyState, ErrorState, SkeletonRows, useToast } from './feedback';
import { Badge, formatDateTime, Pagination, Tone } from './data';
import { Dialog } from './overlay';

export type SupportRequester = 'CUSTOMER' | 'DRIVER' | 'COMPANY';

interface TicketSummary {
  id: string;
  number: number;
  category: TicketCategory;
  status: TicketStatus;
  subject: string;
  createdAt: string;
  updatedAt: string;
}

interface TicketView extends TicketSummary {
  description: string;
  statusLabel: string;
  expectedResponseAt: string | null;
  messages: { id: string; body: string; mine: boolean; authorName: string; createdAt: string }[];
  attachments: { id: string; fileName: string; size: number; createdAt: string }[];
  rating: number | null;
  canReply: boolean;
  canRate: boolean;
  canClose: boolean;
}

const STATUS_TONE: Record<TicketStatus, Tone> = { OPEN: 'brand', IN_PROGRESS: 'info', WAITING_REQUESTER: 'warning', RESOLVED: 'success', CLOSED: 'neutral' };

function NewTicketDialog({
  as,
  companyId,
  orderOptions,
  initialOrderId,
  onClose,
  onCreated,
}: {
  as: SupportRequester;
  companyId?: string;
  orderOptions?: { id: string; label: string }[];
  initialOrderId?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ category: (initialOrderId ? 'ORDER' : 'OTHER') as TicketCategory, subject: '', description: '', orderId: initialOrderId ?? '' });
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const ticket = await api.post<TicketView>('support/tickets', { as, companyId, category: form.category, subject: form.subject, description: form.description, orderId: form.orderId || undefined });
      toast.success(`Chamado #${ticket.number} aberto.`);
      onCreated(ticket.id);
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title="Novo chamado" description="Conte o que aconteceu. Nossa equipe responde dentro do prazo informado.">
      <form onSubmit={submit} className="space-y-4">
        <Select label="Assunto" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as TicketCategory })} options={TICKET_CATEGORIES.map((value) => ({ value, label: TICKET_CATEGORY_LABELS[value] }))} />
        {orderOptions && orderOptions.length > 0 && (
          <Select label="Pedido relacionado (opcional)" value={form.orderId} onChange={(event) => setForm({ ...form, orderId: event.target.value })} options={[{ value: '', label: 'Nenhum' }, ...orderOptions.map((option) => ({ value: option.id, label: option.label }))]} />
        )}
        <Input label="Resumo" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} required minLength={3} maxLength={150} />
        <Textarea label="Descrição" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required minLength={10} maxLength={5000} rows={5} hint="Evite enviar senhas ou dados de cartão." />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            Abrir chamado
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function TicketDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const toast = useToast();
  const { data, error, isLoading, refetch } = useApi<TicketView>(`support/tickets/${id}`);
  useRealtime({ 'support.ticket.updated': (payload: { ticketId?: string }) => payload?.ticketId === id && void refetch() });
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const file = useRef<HTMLInputElement>(null);

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
  if (isLoading || !data) return <SkeletonRows rows={4} />;
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Meus chamados
      </button>
      <div>
        <h3 className="text-lg font-semibold text-fg">
          #{data.number} · {data.subject}
        </h3>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <Badge tone={STATUS_TONE[data.status]}>{data.statusLabel}</Badge>
          {TICKET_CATEGORY_LABELS[data.category]} · aberto em {formatDateTime(data.createdAt)}
        </p>
        {data.expectedResponseAt && <p className="mt-2 text-sm text-muted">Previsão de primeira resposta: até {formatDateTime(data.expectedResponseAt)}.</p>}
      </div>

      <ol className="space-y-3">
        <li className="rounded-lg border border-border p-3 text-sm">
          <p className="text-xs text-muted">Você · {formatDateTime(data.createdAt)}</p>
          <p className="mt-1 whitespace-pre-wrap text-fg">{data.description}</p>
        </li>
        {data.messages.map((message) => (
          <li key={message.id} className={cn('rounded-lg p-3 text-sm', message.mine ? 'border border-border' : 'bg-brand-500/5')}>
            <p className="text-xs text-muted">
              {message.authorName} · {formatDateTime(message.createdAt)}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-fg">{message.body}</p>
          </li>
        ))}
      </ol>

      {data.attachments.length > 0 && (
        <ul className="space-y-1 text-sm">
          {data.attachments.map((attachment) => (
            <li key={attachment.id}>
              <a href={api.fileUrl(`support/tickets/${id}/attachments/${attachment.id}/file`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                <Paperclip className="h-3.5 w-3.5" aria-hidden /> {attachment.fileName}
              </a>
            </li>
          ))}
        </ul>
      )}

      {data.canReply && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (reply.trim())
              void run(
                'reply',
                async () => {
                  await api.post(`support/tickets/${id}/messages`, { body: reply });
                  setReply('');
                },
                'Mensagem enviada.',
              );
          }}
        >
          <Textarea label={data.status === 'RESOLVED' ? 'Algo ainda não está certo? Responda para reabrir' : 'Responder'} value={reply} onChange={(event) => setReply(event.target.value)} rows={3} maxLength={5000} />
          <div className="flex flex-wrap justify-end gap-2">
            <input
              ref={file}
              type="file"
              className="hidden"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const selected = event.target.files?.[0];
                if (!selected) return;
                const form = new FormData();
                form.append('file', selected);
                void run('upload', () => api.upload(`support/tickets/${id}/attachments`, form), 'Anexo enviado.').then(() => {
                  if (file.current) file.current.value = '';
                });
              }}
            />
            <Button type="button" variant="secondary" size="sm" icon={<Paperclip className="h-4 w-4" />} loading={busy === 'upload'} onClick={() => file.current?.click()}>
              Anexar
            </Button>
            <Button type="submit" size="sm" loading={busy === 'reply'} disabled={!reply.trim()}>
              Enviar
            </Button>
          </div>
        </form>
      )}

      {data.canRate && (
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm font-medium text-fg">Como foi o atendimento?</p>
          <div className="mt-2 flex gap-1" role="radiogroup" aria-label="Nota de 1 a 5">
            {[1, 2, 3, 4, 5].map((value) => (
              <button key={value} type="button" role="radio" aria-checked={stars === value} aria-label={`${value} estrela(s)`} onClick={() => setStars(value)} className="rounded p-1 hover:bg-surface-2">
                <Star className={cn('h-6 w-6', value <= stars ? 'fill-current text-warning' : 'text-muted')} aria-hidden />
              </button>
            ))}
          </div>
          <Input className="mt-2" aria-label="Comentário (opcional)" placeholder="Comentário (opcional)" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} />
          <Button className="mt-3" size="sm" disabled={!stars} loading={busy === 'rate'} onClick={() => void run('rate', () => api.post(`support/tickets/${id}/rating`, { rating: stars, comment: comment || undefined }), 'Obrigado pela avaliação!')}>
            Enviar avaliação
          </Button>
        </div>
      )}
      {data.rating && <p className="text-sm text-muted">Você avaliou este atendimento com {data.rating} estrela(s).</p>}

      {data.canClose && data.status !== 'RESOLVED' && (
        <Button variant="ghost" size="sm" loading={busy === 'close'} onClick={() => void run('close', () => api.post(`support/tickets/${id}/close`), 'Chamado encerrado.')}>
          Encerrar chamado (problema resolvido)
        </Button>
      )}
    </div>
  );
}

/** Central de ajuda do solicitante: chamados, abertura, conversa, anexos e avaliação. */
export function SupportCenter({ as, companyId, orderOptions }: { as: SupportRequester; companyId?: string; orderOptions?: { id: string; label: string }[] }) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { data, error, isLoading, refetch } = useApi<Paginated<TicketSummary>>('support/tickets', { ...(companyId ? { companyId } : { as }), page, pageSize: 10 });
  useRealtime({ 'support.ticket.updated': () => void refetch() });

  if (selected) return <TicketDetail id={selected} onBack={() => { setSelected(null); void refetch(); }} />;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Acompanhe seus chamados ou abra um novo.</p>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
          Novo chamado
        </Button>
      </div>
      {isLoading && <SkeletonRows rows={3} />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.data.length === 0 && <EmptyState icon={<LifeBuoy className="h-8 w-8" />} title="Nenhum chamado" description="Quando precisar de ajuda, abra um chamado por aqui." />}
      {data && data.data.length > 0 && (
        <>
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {data.data.map((ticket) => (
              <li key={ticket.id}>
                <button onClick={() => setSelected(ticket.id)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-fg">
                      #{ticket.number} · {ticket.subject}
                    </span>
                    <span className="text-xs text-muted">
                      {TICKET_CATEGORY_LABELS[ticket.category]} · atualizado em {formatDateTime(ticket.updatedAt)}
                    </span>
                  </span>
                  <Badge tone={STATUS_TONE[ticket.status]}>{TICKET_STATUS_LABELS[ticket.status]}</Badge>
                </button>
              </li>
            ))}
          </ul>
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={setPage} />
        </>
      )}
      {creating && (
        <NewTicketDialog
          as={as}
          companyId={companyId}
          orderOptions={orderOptions}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setSelected(id);
            void refetch();
          }}
        />
      )}
    </div>
  );
}
