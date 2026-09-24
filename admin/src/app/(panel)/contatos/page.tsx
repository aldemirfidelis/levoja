'use client';

import { useState } from 'react';
import { Inbox } from 'lucide-react';
import { api, Paginated, useApi } from '@levoja/web-kit/client';
import { Badge, Button, EmptyState, ErrorState, formatDateTime, PageHeader, Pagination, SkeletonRows, Tabs, useToast } from '@levoja/web-kit/ui';
import { useSession } from '@/lib/session';

interface ContactMessage {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  audience: string;
  subject: string;
  message: string;
  handledAt: string | null;
  createdAt: string;
}

const AUDIENCE: Record<string, string> = { CUSTOMER: 'Cliente', COMPANY: 'Empresa', DRIVER: 'Entregador', PRESS: 'Imprensa', OTHER: 'Outro' };

export default function ContactInboxPage() {
  const { can } = useSession();
  const toast = useToast();
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [page, setPage] = useState(1);
  const { data, error, isLoading, refetch } = useApi<Paginated<ContactMessage>>('admin/contact-messages', {
    pendingOnly: filter === 'pending',
    page,
    pageSize: 20,
  });

  const markHandled = async (id: string) => {
    try {
      await api.post(`admin/contact-messages/${id}/handled`);
      toast.success('Marcada como atendida.');
      await refetch();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <PageHeader title="Mensagens de contato" description="Enviadas pelo formulário do portal. Responda pelo e-mail do remetente." />
      <Tabs
        value={filter}
        onChange={(value) => {
          setFilter(value);
          setPage(1);
        }}
        items={[
          { value: 'pending', label: 'Pendentes' },
          { value: 'all', label: 'Todas' },
        ]}
      />
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.data.length === 0 && <EmptyState icon={<Inbox className="h-8 w-8" />} title="Nenhuma mensagem" />}
      <div className="space-y-4">
        {data?.data.map((message) => (
          <article key={message.id} className="rounded-xl border border-border bg-surface p-5">
            <header className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{message.subject}</p>
                <p className="text-sm text-muted">
                  {message.name} · <a href={`mailto:${message.email}?subject=Re: ${encodeURIComponent(message.subject)}`} className="text-brand-600 hover:underline">{message.email}</a>
                  {message.phone && ` · ${message.phone}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge>{AUDIENCE[message.audience] ?? message.audience}</Badge>
                {message.handledAt ? <Badge tone="success">Atendida</Badge> : <Badge tone="warning">Pendente</Badge>}
              </div>
            </header>
            <p className="mt-3 whitespace-pre-wrap text-sm text-fg">{message.message}</p>
            <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>
                {formatDateTime(message.createdAt)} · protocolo {message.id}
              </span>
              {!message.handledAt && can('support.tickets.manage') && (
                <Button size="sm" variant="secondary" onClick={() => markHandled(message.id)}>
                  Marcar como atendida
                </Button>
              )}
            </footer>
          </article>
        ))}
      </div>
      {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={setPage} />}
    </>
  );
}
