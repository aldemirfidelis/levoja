'use client';

import { useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { CONVERSATION_TYPE_LABELS } from '@levoja/shared';
import { Paginated, useApi, useRealtime } from '@levoja/web-kit/client';
import { Badge, Card, ChatThread, ConversationView, EmptyState, ErrorState, formatDateTime, Pagination, SkeletonRows, cn } from '@levoja/web-kit/ui';
import { useCompany } from '@/lib/company';

const ROLE: Record<string, string> = { CUSTOMER: 'Cliente', DRIVER: 'Entregador', COMPANY: 'Loja' };

/** Caixa de entrada da loja: conversas com clientes e entregadores dos pedidos. */
export default function CompanyMessagesPage() {
  const { company } = useCompany();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error, isLoading, refetch } = useApi<Paginated<ConversationView>>(`companies/${company.id}/conversations`, { page, pageSize: 20 });
  useRealtime({ 'chat.message': () => void refetch() });

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <div>
        {isLoading && <SkeletonRows rows={5} />}
        {error && <ErrorState error={error} onRetry={() => refetch()} />}
        {data?.data.length === 0 && <EmptyState icon={<MessagesSquare className="h-8 w-8" />} title="Nenhuma conversa" description="Mensagens de clientes e entregadores sobre os pedidos aparecem aqui." />}
        {data && data.data.length > 0 && (
          <>
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
              {data.data.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    onClick={() => setSelected(conversation.id)}
                    aria-current={selected === conversation.id ? 'true' : undefined}
                    className={cn('w-full px-4 py-3 text-left hover:bg-surface-2', selected === conversation.id && 'bg-surface-2')}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-fg">
                        {conversation.counterpart ? `${ROLE[conversation.counterpart.role]} · ${conversation.counterpart.name}` : CONVERSATION_TYPE_LABELS[conversation.type]}
                      </span>
                      {conversation.unread && <Badge tone="brand">nova</Badge>}
                    </span>
                    <span className="block truncate text-sm text-muted">{conversation.lastMessagePreview}</span>
                    <span className="text-xs text-muted">{formatDateTime(conversation.lastMessageAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={setPage} />
          </>
        )}
      </div>
      <Card title="Conversa">
        {selected ? <ChatThread key={selected} conversationId={selected} /> : <p className="py-12 text-center text-sm text-muted">Selecione uma conversa.</p>}
      </Card>
    </div>
  );
}
