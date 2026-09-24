'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Phone, Send } from 'lucide-react';
import { api, ApiError } from '../client/api';
import { useApi } from '../client/hooks';
import { useRealtime } from '../client/realtime';
import { Button, cn } from './primitives';
import { ErrorState, SkeletonRows, useToast } from './feedback';
import { Badge, formatDateTime } from './data';
import { Dialog } from './overlay';

export type ChatSide = 'CUSTOMER' | 'COMPANY' | 'DRIVER';

export interface ConversationView {
  id: string;
  type: 'CUSTOMER_COMPANY' | 'CUSTOMER_DRIVER' | 'COMPANY_DRIVER';
  orderId: string | null;
  deliveryId: string | null;
  me: ChatSide;
  counterpart: { role: ChatSide; name: string } | null;
  canSend: boolean;
  canCall: boolean;
  closesAt: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unread: boolean;
}

interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  senderRole: ChatSide | 'STAFF' | 'SYSTEM';
  senderName: string;
  mine: boolean;
}

interface AvailableConversation {
  type: ConversationView['type'];
  orderId: string | null;
  deliveryId: string | null;
  with: ChatSide;
  name: string;
  conversationId: string | null;
  canSend: boolean;
  unread: boolean;
}

const WITH_LABEL: Record<ChatSide, string> = { CUSTOMER: 'cliente', COMPANY: 'loja', DRIVER: 'entregador' };

/** Conversa (mensagens + envio). Atualiza em tempo real e marca como lida ao abrir. */
export function ChatThread({ conversationId, height = 420 }: { conversationId: string; height?: number }) {
  const toast = useToast();
  const client = useQueryClient();
  const { data, error, isLoading, refetch } = useApi<{ conversation: ConversationView; messages: ChatMessage[] }>(`conversations/${conversationId}/messages`, { limit: 100 });
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [calling, setCalling] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useRealtime({ 'chat.message': (payload: { conversationId?: string }) => payload?.conversationId === conversationId && void refetch() });
  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [data?.messages.length]);
  useEffect(() => {
    if (!data?.conversation.unread) return;
    void api.post(`conversations/${conversationId}/read`).then(() => client.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith('conversations') || String(query.queryKey[0]).includes('/conversations') }));
  }, [conversationId, data?.conversation.unread, data?.messages.length, client]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      await api.post(`conversations/${conversationId}/messages`, { body: text.trim() });
      setText('');
      await refetch();
    } catch (err) {
      toast.error(err);
    } finally {
      setSending(false);
    }
  };

  const call = async () => {
    setCalling(true);
    try {
      const result = await api.post<{ message: string }>(`conversations/${conversationId}/call`);
      toast.success(result.message);
    } catch (err) {
      toast.error(err);
    } finally {
      setCalling(false);
    }
  };

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <SkeletonRows rows={4} />;
  const { conversation, messages } = data;
  return (
    <div className="flex flex-col">
      {conversation.canCall && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" variant="secondary" icon={<Phone className="h-4 w-4" />} loading={calling} onClick={call}>
            Ligar (número protegido)
          </Button>
        </div>
      )}
      <div className="space-y-2 overflow-y-auto rounded-lg bg-surface-2 p-3" style={{ height }} aria-live="polite">
        {messages.length === 0 && <p className="py-8 text-center text-sm text-muted">Nenhuma mensagem ainda. Seus dados de contato não são compartilhados.</p>}
        {messages.map((message) => (
          <div key={message.id} className={cn('flex', message.mine ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[80%] rounded-2xl px-3 py-2 text-sm', message.mine ? 'bg-brand-500 text-white' : 'bg-surface text-fg shadow-sm')}>
              {!message.mine && <p className="text-xs font-semibold text-muted">{message.senderName}</p>}
              <p className="whitespace-pre-wrap break-words">{message.body}</p>
              <p className={cn('mt-0.5 text-right text-[11px]', message.mine ? 'text-white/80' : 'text-muted')}>{formatDateTime(message.createdAt)}</p>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {conversation.canSend ? (
        <form onSubmit={send} className="mt-3 flex gap-2">
          <label className="sr-only" htmlFor={`chat-${conversationId}`}>
            Mensagem
          </label>
          <input
            id={`chat-${conversationId}`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={2000}
            placeholder="Escreva uma mensagem"
            autoComplete="off"
            className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm text-fg placeholder:text-muted focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          <Button type="submit" loading={sending} disabled={!text.trim()} icon={<Send className="h-4 w-4" />} aria-label="Enviar">
            <span className="hidden sm:inline">Enviar</span>
          </Button>
        </form>
      ) : (
        <p className="mt-3 text-center text-sm text-muted">Conversa encerrada — somente leitura.</p>
      )}
    </div>
  );
}

/** Diálogo com a conversa. */
export function ChatDialog({ conversationId, title, onClose }: { conversationId: string; title: string; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title={title} description="Por aqui ninguém vê o seu telefone." size="md">
      <ChatThread conversationId={conversationId} height={380} />
    </Dialog>
  );
}

/**
 * Botões "Conversar com a loja / entregador / cliente" de um pedido ou entrega. Só aparecem as
 * conversas que o usuário pode ter naquele momento (ex.: com o entregador só após a designação).
 */
export function ChatLauncher({ orderId, deliveryId, className }: { orderId?: string; deliveryId?: string; className?: string }) {
  const toast = useToast();
  const { data, refetch } = useApi<AvailableConversation[]>('conversations/available', { orderId, deliveryId });
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null);
  useRealtime({ 'chat.message': (payload: { orderId?: string; deliveryId?: string }) => (payload?.orderId === orderId || payload?.deliveryId === deliveryId) && void refetch() });
  if (!data?.length) return null;

  const start = async (option: AvailableConversation) => {
    try {
      const conversation = option.conversationId
        ? { id: option.conversationId }
        : await api.post<ConversationView>('conversations/open', { type: option.type, orderId: option.orderId ?? undefined, deliveryId: option.deliveryId ?? undefined });
      setOpen({ id: conversation.id, title: `Conversa com ${option.name}` });
    } catch (err) {
      toast.error(err instanceof ApiError ? err : new Error('Não foi possível abrir a conversa.'));
    }
  };

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {data.map((option) => (
        <Button key={option.type} size="sm" variant="secondary" icon={<MessageCircle className="h-4 w-4" />} onClick={() => start(option)}>
          Conversar com {WITH_LABEL[option.with]}
          {option.unread && <Badge tone="brand">nova</Badge>}
        </Button>
      ))}
      {open && (
        <ChatDialog
          conversationId={open.id}
          title={open.title}
          onClose={() => {
            setOpen(null);
            void refetch();
          }}
        />
      )}
    </div>
  );
}
