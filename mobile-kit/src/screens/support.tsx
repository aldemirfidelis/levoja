import { useState } from 'react';
import { Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { TICKET_CATEGORIES, TICKET_CATEGORY_LABELS, TICKET_STATUS_LABELS, TicketCategory, TicketStatus } from '@levoja/shared';
import { api } from '../api';
import { formatDateTime } from '../format';
import { useApi, useInfiniteApi } from '../query';
import { useRealtimeEvent } from '../realtime';
import type { Tone } from '../theme';
import { radius, space, useColors } from '../theme';
import { upload } from '../upload';
import { EmptyState, ErrorView, Loading, useToast } from '../ui/feedback';
import { Icon } from '../ui/icon';
import { Chip, ListGroup, ListItem, Screen } from '../ui/layout';
import { Badge, Button, Card, Field, Row, Stack, Text } from '../ui/primitives';

export type SupportRequester = 'CUSTOMER' | 'DRIVER';

interface TicketSummary {
  id: string;
  number: number;
  category: TicketCategory;
  status: TicketStatus;
  subject: string;
  updatedAt: string;
}

interface TicketView extends TicketSummary {
  description: string;
  statusLabel: string;
  createdAt: string;
  expectedResponseAt: string | null;
  messages: { id: string; body: string; mine: boolean; authorName: string; createdAt: string }[];
  attachments: { id: string; fileName: string; createdAt: string }[];
  rating: number | null;
  canReply: boolean;
  canRate: boolean;
  canClose: boolean;
}

const STATUS_TONE: Record<TicketStatus, Tone> = { OPEN: 'brand', IN_PROGRESS: 'info', WAITING_REQUESTER: 'warning', RESOLVED: 'success', CLOSED: 'neutral' };

/** Meus chamados. */
export function SupportListScreen({ as, onOpen, onCreate }: { as: SupportRequester; onOpen: (id: string) => void; onCreate: () => void }) {
  const list = useInfiniteApi<TicketSummary>('support/tickets', { as });
  useRealtimeEvent('support.ticket.updated', () => void list.refetch());
  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorView error={list.error} onRetry={() => list.refetch()} />;
  return (
    <Screen refreshing={list.isRefetching} onRefresh={() => list.refetch()} footer={<Button title="Novo chamado" icon="plus" onPress={onCreate} />}>
      {list.items.length === 0 ? <EmptyState icon="help" title="Nenhum chamado" description="Precisa de ajuda com um pedido, pagamento ou sua conta? Abra um chamado." /> : null}
      {list.items.map((ticket) => (
        <Card key={ticket.id} onPress={() => onOpen(ticket.id)}>
          <Row justify="space-between" align="flex-start" gap={3}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text weight="600">
                #{ticket.number} · {ticket.subject}
              </Text>
              <Text variant="caption" tone="muted">
                {TICKET_CATEGORY_LABELS[ticket.category]} · {formatDateTime(ticket.updatedAt)}
              </Text>
            </View>
            <Badge label={TICKET_STATUS_LABELS[ticket.status]} tone={STATUS_TONE[ticket.status]} />
          </Row>
        </Card>
      ))}
      {list.hasNextPage ? <Button title="Carregar mais" variant="ghost" loading={list.isFetchingNextPage} onPress={() => list.fetchNextPage()} /> : null}
    </Screen>
  );
}

/** Abrir chamado (opcionalmente já ligado a um pedido ou entrega). */
export function NewTicketScreen({
  as,
  orderId,
  deliveryId,
  referenceLabel,
  onCreated,
}: {
  as: SupportRequester;
  orderId?: string;
  deliveryId?: string;
  referenceLabel?: string;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [category, setCategory] = useState<TicketCategory>(orderId ? 'ORDER' : deliveryId ? 'DELIVERY' : 'OTHER');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const valid = subject.trim().length >= 3 && description.trim().length >= 10;

  const submit = async () => {
    setSaving(true);
    try {
      const ticket = await api.post<TicketView>('support/tickets', { as, category, subject: subject.trim(), description: description.trim(), orderId, deliveryId });
      toast.success(`Chamado #${ticket.number} aberto.`);
      onCreated(ticket.id);
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen footer={<Button title="Abrir chamado" loading={saving} disabled={!valid} onPress={submit} />}>
      {referenceLabel ? <Badge label={referenceLabel} tone="info" /> : null}
      <Stack gap={2}>
        <Text variant="label">Assunto</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
          {TICKET_CATEGORIES.map((value) => (
            <Chip key={value} label={TICKET_CATEGORY_LABELS[value]} selected={category === value} onPress={() => setCategory(value)} />
          ))}
        </View>
      </Stack>
      <Field label="Resumo" value={subject} onChangeText={setSubject} maxLength={150} placeholder="Ex.: Pedido chegou incompleto" />
      <Field label="Descrição" value={description} onChangeText={setDescription} multiline maxLength={5000} hint="Conte o que aconteceu. Não envie senhas ou dados de cartão." />
    </Screen>
  );
}

/** Chamado: conversa com a equipe, anexos (fotos), avaliação e encerramento. */
export function TicketScreen({ id }: { id: string }) {
  const colors = useColors();
  const toast = useToast();
  const { data, error, isLoading, refetch, isRefetching } = useApi<TicketView>(`support/tickets/${id}`);
  useRealtimeEvent<{ ticketId?: string }>('support.ticket.updated', (payload) => {
    if (payload?.ticketId === id) void refetch();
  });
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [stars, setStars] = useState(0);

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

  const attachPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    await run('upload', () => upload(`support/tickets/${id}/attachments`, 'file', { uri: asset.uri, name: asset.fileName, mimeType: asset.mimeType }), 'Anexo enviado.');
  };

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorView error={error} onRetry={() => refetch()} />;
  return (
    <Screen
      refreshing={isRefetching}
      onRefresh={() => refetch()}
      footer={
        data.canReply ? (
          <Stack gap={2}>
            <Field value={reply} onChangeText={setReply} placeholder={data.status === 'RESOLVED' ? 'Algo não ficou certo? Responda para reabrir' : 'Responder'} multiline maxLength={5000} style={{ minHeight: 60 }} />
            <Row gap={2}>
              <View style={{ flex: 1 }}>
                <Button title="Anexar foto" icon="image" variant="secondary" loading={busy === 'upload'} onPress={attachPhoto} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Enviar"
                  icon="send"
                  loading={busy === 'reply'}
                  disabled={!reply.trim()}
                  onPress={() =>
                    run(
                      'reply',
                      async () => {
                        await api.post(`support/tickets/${id}/messages`, { body: reply.trim() });
                        setReply('');
                      },
                      'Mensagem enviada.',
                    )
                  }
                />
              </View>
            </Row>
          </Stack>
        ) : undefined
      }
    >
      <Stack gap={1}>
        <Text variant="heading">
          #{data.number} · {data.subject}
        </Text>
        <Row gap={2}>
          <Badge label={data.statusLabel} tone={STATUS_TONE[data.status]} />
          <Text variant="caption" tone="muted">
            {TICKET_CATEGORY_LABELS[data.category]}
          </Text>
        </Row>
        {data.expectedResponseAt ? (
          <Text variant="caption" tone="muted">
            Previsão de primeira resposta: até {formatDateTime(data.expectedResponseAt)}
          </Text>
        ) : null}
      </Stack>

      <Card>
        <Text variant="caption" tone="muted">
          Você · {formatDateTime(data.createdAt)}
        </Text>
        <Text>{data.description}</Text>
      </Card>
      {data.messages.map((message) => (
        <View key={message.id} style={{ borderRadius: radius.lg, padding: space(3), backgroundColor: message.mine ? colors.surface : colors.brandSoft, borderWidth: 1, borderColor: colors.border }}>
          <Text variant="caption" tone="muted">
            {message.authorName} · {formatDateTime(message.createdAt)}
          </Text>
          <Text>{message.body}</Text>
        </View>
      ))}

      {data.attachments.length ? (
        <ListGroup title="Anexos">
          {data.attachments.map((attachment) => (
            <ListItem key={attachment.id} icon="document" title={attachment.fileName} subtitle={formatDateTime(attachment.createdAt)} />
          ))}
        </ListGroup>
      ) : null}

      {data.canRate ? (
        <Card>
          <Stack gap={2}>
            <Text weight="600">Como foi o atendimento?</Text>
            <Row gap={1} style={{ justifyContent: 'center' }}>
              {[1, 2, 3, 4, 5].map((value) => (
                <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: stars === value }} accessibilityLabel={`${value} estrela(s)`} onPress={() => setStars(value)} hitSlop={6} style={{ padding: space(1) }}>
                  <Icon name="star" size={32} color={value <= stars ? colors.warning : colors.border} />
                </Pressable>
              ))}
            </Row>
            <Button title="Enviar avaliação" disabled={!stars} loading={busy === 'rate'} onPress={() => run('rate', () => api.post(`support/tickets/${id}/rating`, { rating: stars }), 'Obrigado pela avaliação!')} />
          </Stack>
        </Card>
      ) : null}
      {data.rating ? (
        <Text tone="muted" align="center">
          Você avaliou este atendimento com {data.rating} estrela(s).
        </Text>
      ) : null}
      {data.canClose && data.status !== 'RESOLVED' ? (
        <Button title="Encerrar chamado (problema resolvido)" variant="ghost" loading={busy === 'close'} onPress={() => run('close', () => api.post(`support/tickets/${id}/close`), 'Chamado encerrado.')} />
      ) : null}
    </Screen>
  );
}
