import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { formatDateTime } from '../format';
import { useApi } from '../query';
import { useRealtimeEvent } from '../realtime';
import { radius, space, useColors } from '../theme';
import { EmptyState, ErrorView, Loading, useToast } from '../ui/feedback';
import { Screen } from '../ui/layout';
import { Badge, Button, Field, IconButton, Row, Stack, Text } from '../ui/primitives';

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
  senderRole: string;
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

/** Conversa de um pedido/entrega: mensagens em tempo real, envio e ligação com número protegido. */
export function ChatScreen({ conversationId }: { conversationId: string }) {
  const colors = useColors();
  const toast = useToast();
  const client = useQueryClient();
  const { data, error, isLoading, refetch } = useApi<{ conversation: ConversationView; messages: ChatMessage[] }>(`conversations/${conversationId}/messages`, { limit: 100 });
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [calling, setCalling] = useState(false);

  useRealtimeEvent<{ conversationId?: string }>('chat.message', (payload) => {
    if (payload?.conversationId === conversationId) void refetch();
  });
  useEffect(() => {
    if (!data?.conversation.unread) return;
    void api.post(`conversations/${conversationId}/read`).then(() => client.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith('conversations') }));
  }, [conversationId, data?.conversation.unread, data?.messages.length, client]);

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorView error={error} onRetry={() => refetch()} />;
  const { conversation, messages } = data;

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      await api.post(`conversations/${conversationId}/messages`, { body });
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

  return (
    <Screen
      scroll={false}
      padded={false}
      footer={
        conversation.canSend ? (
          <Row gap={2}>
            <View style={{ flex: 1 }}>
              <Field value={text} onChangeText={setText} placeholder="Escreva uma mensagem" maxLength={2000} accessibilityLabel="Mensagem" returnKeyType="send" onSubmitEditing={send} />
            </View>
            <IconButton icon="send" label="Enviar" onPress={send} disabled={sending || !text.trim()} color={colors.brand} />
          </Row>
        ) : (
          <Text tone="muted" align="center">
            Conversa encerrada — somente leitura.
          </Text>
        )
      }
    >
      {conversation.canCall ? (
        <View style={{ padding: space(3), borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Button title="Ligar (número protegido)" icon="phone" variant="secondary" size="sm" loading={calling} onPress={call} />
        </View>
      ) : null}
      <FlatList
        inverted
        data={[...messages].reverse()}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: space(4), gap: space(2), flexGrow: 1 }}
        ListEmptyComponent={
          <View style={{ transform: [{ scaleY: -1 }] }}>
            <EmptyState icon="chat" title="Nenhuma mensagem ainda" description="Seu telefone não é compartilhado com a outra pessoa." />
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ alignItems: item.mine ? 'flex-end' : 'flex-start' }}>
            <View
              style={{
                maxWidth: '82%',
                borderRadius: radius.lg,
                paddingHorizontal: space(3),
                paddingVertical: space(2),
                backgroundColor: item.mine ? colors.brand : colors.surface,
                borderWidth: item.mine ? 0 : 1,
                borderColor: colors.border,
              }}
            >
              {!item.mine ? (
                <Text variant="caption" tone="muted" weight="600">
                  {item.senderName}
                </Text>
              ) : null}
              <Text style={{ color: item.mine ? colors.onBrand : colors.fg }}>{item.body}</Text>
              <Text variant="caption" style={{ color: item.mine ? colors.onBrand : colors.muted, opacity: 0.8, textAlign: 'right' }}>
                {formatDateTime(item.createdAt)}
              </Text>
            </View>
          </View>
        )}
      />
    </Screen>
  );
}

/**
 * Botões "Conversar com a loja / entregador / cliente" de um pedido ou entrega. Mostra só as conversas
 * possíveis naquele momento (ex.: com o entregador apenas depois que ele aceitar).
 */
export function ConversationButtons({ orderId, deliveryId, onOpen }: { orderId?: string; deliveryId?: string; onOpen: (conversationId: string, title: string) => void }) {
  const toast = useToast();
  const { data, refetch } = useApi<AvailableConversation[]>('conversations/available', { orderId, deliveryId });
  const [opening, setOpening] = useState<string | null>(null);
  useRealtimeEvent<{ orderId?: string; deliveryId?: string }>('chat.message', (payload) => {
    if ((orderId && payload?.orderId === orderId) || (deliveryId && payload?.deliveryId === deliveryId)) void refetch();
  });
  useRealtimeEvent('delivery.updated', () => void refetch());
  if (!data?.length) return null;

  const open = async (option: AvailableConversation) => {
    setOpening(option.type);
    try {
      const id =
        option.conversationId ??
        (await api.post<ConversationView>('conversations/open', { type: option.type, orderId: option.orderId ?? undefined, deliveryId: option.deliveryId ?? undefined })).id;
      onOpen(id, `Conversa com ${option.name}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setOpening(null);
    }
  };

  return (
    <Stack gap={2}>
      {data.map((option) => (
        <Row key={option.type} gap={2}>
          <View style={{ flex: 1 }}>
            <Button title={`Conversar com ${WITH_LABEL[option.with]}`} icon="chat" variant="secondary" loading={opening === option.type} onPress={() => open(option)} />
          </View>
          {option.unread ? <Badge label="nova" tone="brand" /> : null}
        </Row>
      ))}
    </Stack>
  );
}
