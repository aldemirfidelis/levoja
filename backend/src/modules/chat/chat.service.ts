import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { paginated, PaginationQueryDto, skipOf } from '../../common/pagination';
import type { AuthUser } from '../../common/auth/auth-user';
import { VoiceProvider } from './voice.provider';
import { USER_ANONYMIZED, USER_EXPORTING, UserAnonymizedEvent, UserExportCollector } from '../privacy/privacy.events';
import type { ChatRole, ConversationType } from '../../generated/prisma/enums';
import type { Conversation } from '../../generated/prisma/client';

export type ChatSide = 'CUSTOMER' | 'COMPANY' | 'DRIVER';
type Viewer = ChatSide | 'STAFF';

const ACTIVE_DELIVERY = ['DRIVER_ASSIGNED', 'AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'AT_DROPOFF'];
const FINAL_ORDER = ['DELIVERED', 'CANCELED'];
const FINAL_DELIVERY = ['DELIVERED', 'CANCELED', 'FAILED'];
const SIDES: Record<ConversationType, [ChatSide, ChatSide]> = {
  CUSTOMER_COMPANY: ['CUSTOMER', 'COMPANY'],
  CUSTOMER_DRIVER: ['CUSTOMER', 'DRIVER'],
  COMPANY_DRIVER: ['COMPANY', 'DRIVER'],
};

/** Participantes e janela de uma conversa, sempre derivados do estado atual do pedido/entrega. */
interface Context {
  tenantId: string;
  type: ConversationType;
  orderId: string | null;
  deliveryId: string | null;
  customerUserId: string | null;
  companyId: string | null;
  driverId: string | null;
  driverUserId: string | null;
  names: Record<ChatSide, string>;
  phones: Record<ChatSide, string | null>;
  /** Pedido/entrega em andamento (ligações só nesse período). */
  active: boolean;
  closesAt: Date | null;
}

const firstName = (name?: string | null) => (name ?? '').trim().split(/\s+/)[0] || '—';

/**
 * Chat entre cliente, loja e entregador, sempre ligado a um pedido ou entrega. O acesso é recalculado
 * a cada chamada (ex.: se o entregador desistir, ele perde o acesso). Telefones nunca são expostos.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly voice: VoiceProvider,
  ) {}

  // ---------------------------------------------------------------------------
  // Contexto e permissões
  // ---------------------------------------------------------------------------

  private async orderContext(orderId: string): Promise<Omit<Context, 'type'> | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: { select: { user: { select: { id: true, name: true, phone: true } } } },
        company: { select: { id: true, tradeName: true, phone: true } },
        delivery: { select: { id: true } },
      },
    });
    if (!order) return null;
    const { withStoreAfterMinutes } = await this.settings.get(order.tenantId, 'chat');
    const finishedAt = FINAL_ORDER.includes(order.status) ? (order.deliveredAt ?? order.canceledAt ?? order.updatedAt) : null;
    return {
      tenantId: order.tenantId,
      orderId: order.id,
      deliveryId: order.delivery?.id ?? null,
      customerUserId: order.customer.user.id,
      companyId: order.companyId,
      driverId: null,
      driverUserId: null,
      names: { CUSTOMER: firstName(order.customer.user.name), COMPANY: order.company.tradeName, DRIVER: 'Entregador' },
      phones: { CUSTOMER: order.customer.user.phone, COMPANY: order.company.phone, DRIVER: null },
      active: !finishedAt,
      closesAt: finishedAt ? new Date(finishedAt.getTime() + withStoreAfterMinutes * 60_000) : null,
    };
  }

  private async deliveryContext(deliveryId: string): Promise<Omit<Context, 'type'> | null> {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: {
        company: { select: { tradeName: true, phone: true } },
        driver: { select: { id: true, userId: true, user: { select: { name: true, phone: true } } } },
        order: { select: { customer: { select: { user: { select: { id: true, name: true, phone: true } } } } } },
      },
    });
    if (!delivery) return null;
    const { withDriverAfterMinutes } = await this.settings.get(delivery.tenantId, 'chat');
    // Cliente: dono do pedido ou quem pediu a entrega avulsa (entregas pedidas por empresas não têm cliente).
    const requester =
      delivery.order?.customer.user ??
      (!delivery.companyId || delivery.kind === 'ORDER'
        ? await this.prisma.user.findUnique({ where: { id: delivery.requesterUserId }, select: { id: true, name: true, phone: true } })
        : null);
    const finishedAt = FINAL_DELIVERY.includes(delivery.status) ? (delivery.deliveredAt ?? delivery.failedAt ?? delivery.canceledAt ?? delivery.updatedAt) : null;
    return {
      tenantId: delivery.tenantId,
      orderId: delivery.orderId,
      deliveryId: delivery.id,
      customerUserId: requester?.id ?? null,
      companyId: delivery.companyId,
      driverId: delivery.driverId,
      driverUserId: delivery.driver?.userId ?? null,
      names: {
        CUSTOMER: firstName(requester?.name),
        COMPANY: delivery.company?.tradeName ?? 'Loja',
        DRIVER: firstName(delivery.driver?.user.name),
      },
      phones: { CUSTOMER: requester?.phone ?? null, COMPANY: delivery.company?.phone ?? null, DRIVER: delivery.driver?.user.phone ?? null },
      active: ACTIVE_DELIVERY.includes(delivery.status),
      closesAt: finishedAt ? new Date(finishedAt.getTime() + withDriverAfterMinutes * 60_000) : null,
    };
  }

  private async context(type: ConversationType, ref: { orderId?: string | null; deliveryId?: string | null }): Promise<Context | null> {
    let base: Omit<Context, 'type'> | null = null;
    if (type === 'CUSTOMER_COMPANY') {
      if (!ref.orderId) return null;
      base = await this.orderContext(ref.orderId);
    } else {
      if (!ref.deliveryId) return null;
      base = await this.deliveryContext(ref.deliveryId);
      // Conversas com o entregador só existem enquanto houver entregador na entrega.
      if (base && !base.driverId) return null;
    }
    if (!base) return null;
    const [a, b] = SIDES[type];
    const present = (side: ChatSide) => (side === 'CUSTOMER' ? !!base!.customerUserId : side === 'COMPANY' ? !!base!.companyId : !!base!.driverId);
    if (!present(a) || !present(b)) return null;
    return { ...base, type };
  }

  /** Qual lado o usuário ocupa na conversa (ou STAFF, somente leitura). */
  private viewerOf(user: AuthUser, context: Context, intent: 'read' | 'send'): Viewer | null {
    const [a, b] = SIDES[context.type];
    for (const side of [a, b]) {
      if (side === 'CUSTOMER' && context.customerUserId === user.userId) return side;
      if (side === 'DRIVER' && context.driverId && user.driverId === context.driverId) return side;
      if (side === 'COMPANY' && context.companyId) {
        const permissions = intent === 'send' ? ['company.orders.manage', 'company.deliveries.request'] : ['company.orders.read', 'company.deliveries.request'];
        if (permissions.some((permission) => user.canInCompany(context.companyId!, permission))) return side;
      }
    }
    if (intent === 'read' && user.can('support.tickets.read') && context.tenantId === user.tenantId) return 'STAFF';
    return null;
  }

  private async load(user: AuthUser, conversationId: string, intent: 'read' | 'send') {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation || conversation.tenantId !== user.tenantId) throw new NotFoundException('Conversa não encontrada.');
    const context = await this.context(conversation.type, conversation);
    const viewer = context ? this.viewerOf(user, context, intent) : null;
    if (!context || !viewer) throw new NotFoundException('Conversa não encontrada.');
    return { conversation, context, viewer };
  }

  private canSend(context: Context, viewer: Viewer): boolean {
    return viewer !== 'STAFF' && (!context.closesAt || context.closesAt > new Date());
  }

  private readField(side: ChatSide) {
    return side === 'CUSTOMER' ? 'customerReadAt' : side === 'COMPANY' ? 'companyReadAt' : 'driverReadAt';
  }

  private view(conversation: Conversation, context: Context, viewer: Viewer) {
    const [a, b] = SIDES[context.type];
    const counterpart = viewer === a ? b : viewer === b ? a : null;
    const readAt = viewer !== 'STAFF' ? conversation[this.readField(viewer)] : null;
    return {
      id: conversation.id,
      type: conversation.type,
      orderId: conversation.orderId,
      deliveryId: conversation.deliveryId,
      me: viewer,
      counterpart: counterpart ? { role: counterpart, name: context.names[counterpart] } : null,
      participants: { [a]: context.names[a], [b]: context.names[b] },
      canSend: this.canSend(context, viewer),
      canCall: this.voice.enabled && viewer !== 'STAFF' && context.active && !!counterpart && !!context.phones[counterpart],
      closesAt: context.closesAt,
      lastMessageAt: conversation.lastMessageAt,
      lastMessagePreview: conversation.lastMessagePreview,
      unread: !!conversation.lastMessageAt && viewer !== 'STAFF' && (!readAt || readAt < conversation.lastMessageAt),
    };
  }

  // ---------------------------------------------------------------------------
  // Consultas
  // ---------------------------------------------------------------------------

  /** Conversas possíveis para um pedido/entrega do ponto de vista do usuário (botões "Conversar com..."). */
  async available(user: AuthUser, ref: { orderId?: string; deliveryId?: string }) {
    let orderId = ref.orderId ?? null;
    let deliveryId = ref.deliveryId ?? null;
    if (orderId && !deliveryId) deliveryId = (await this.prisma.delivery.findUnique({ where: { orderId }, select: { id: true } }))?.id ?? null;
    if (deliveryId && !orderId) orderId = (await this.prisma.delivery.findUnique({ where: { id: deliveryId }, select: { orderId: true } }))?.orderId ?? null;
    const options = [];
    for (const type of ['CUSTOMER_COMPANY', 'CUSTOMER_DRIVER', 'COMPANY_DRIVER'] as ConversationType[]) {
      const context = await this.context(type, { orderId, deliveryId });
      if (!context || context.tenantId !== user.tenantId) continue;
      const viewer = this.viewerOf(user, context, 'read');
      if (!viewer || viewer === 'STAFF') continue;
      const existing = await this.prisma.conversation.findFirst({ where: type === 'CUSTOMER_COMPANY' ? { type, orderId } : { type, deliveryId } });
      const counterpart = SIDES[type].find((side) => side !== viewer)!;
      options.push({
        type,
        orderId: type === 'CUSTOMER_COMPANY' ? orderId : null,
        deliveryId: type === 'CUSTOMER_COMPANY' ? null : deliveryId,
        with: counterpart,
        name: context.names[counterpart],
        conversationId: existing?.id ?? null,
        canSend: this.canSend(context, viewer),
        unread: existing ? this.view(existing, context, viewer).unread : false,
      });
    }
    return options;
  }

  async open(user: AuthUser, input: { type: ConversationType; orderId?: string; deliveryId?: string }) {
    const ref = input.type === 'CUSTOMER_COMPANY' ? { orderId: input.orderId ?? null, deliveryId: null } : { orderId: null, deliveryId: input.deliveryId ?? null };
    const context = await this.context(input.type, ref);
    if (!context || context.tenantId !== user.tenantId) throw new NotFoundException('Conversa indisponível para este pedido/entrega.');
    const viewer = this.viewerOf(user, context, 'read');
    if (!viewer || viewer === 'STAFF') throw new ForbiddenException('Você não participa desta conversa.');
    const where = input.type === 'CUSTOMER_COMPANY' ? { type_orderId: { type: input.type, orderId: context.orderId! } } : { type_deliveryId: { type: input.type, deliveryId: context.deliveryId! } };
    const conversation = await this.prisma.conversation.upsert({
      where: where as never,
      create: {
        tenantId: context.tenantId,
        type: input.type,
        orderId: input.type === 'CUSTOMER_COMPANY' ? context.orderId : null,
        deliveryId: input.type === 'CUSTOMER_COMPANY' ? null : context.deliveryId,
        customerUserId: context.customerUserId,
        companyId: context.companyId,
        driverId: context.driverId,
      },
      // Mantém o entregador atual (troca de entregador após desistência).
      update: { driverId: context.driverId, closesAt: context.closesAt },
    });
    return this.view(conversation, context, viewer);
  }

  async get(user: AuthUser, conversationId: string) {
    const { conversation, context, viewer } = await this.load(user, conversationId, 'read');
    if (viewer === 'STAFF') await this.audit.log({ action: 'chat.staff_view', entityType: 'Conversation', entityId: conversation.id });
    return this.view(conversation, context, viewer);
  }

  async messages(user: AuthUser, conversationId: string, before?: string, limit = 50) {
    const { conversation, context, viewer } = await this.load(user, conversationId, 'read');
    const rows = await this.prisma.chatMessage.findMany({
      where: { conversationId, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, limit)),
    });
    return {
      conversation: this.view(conversation, context, viewer),
      messages: rows.reverse().map((message) => ({
        id: message.id,
        body: message.body,
        createdAt: message.createdAt,
        senderRole: message.senderRole,
        senderName: message.senderRole === 'STAFF' ? 'Equipe' : message.senderRole === 'SYSTEM' ? 'Sistema' : context.names[message.senderRole as ChatSide],
        mine: viewer !== 'STAFF' && message.senderRole === viewer,
      })),
      hasMore: rows.length === Math.min(100, Math.max(1, limit)),
    };
  }

  /** Caixa de entrada do cliente/entregador (conversas mais recentes primeiro). */
  async inbox(user: AuthUser, query: PaginationQueryDto) {
    const where = {
      tenantId: user.tenantId,
      lastMessageAt: { not: null },
      OR: [{ customerUserId: user.userId }, ...(user.driverId ? [{ driverId: user.driverId }] : [])],
    };
    return this.inboxPage(user, where, query);
  }

  async companyInbox(user: AuthUser, companyId: string, query: PaginationQueryDto) {
    return this.inboxPage(user, { tenantId: user.tenantId, companyId, lastMessageAt: { not: null } }, query);
  }

  private async inboxPage(user: AuthUser, where: object, query: PaginationQueryDto) {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({ where, orderBy: { lastMessageAt: 'desc' }, skip: skipOf(query), take: query.pageSize }),
    ]);
    const views = [];
    for (const conversation of rows) {
      const context = await this.context(conversation.type, conversation);
      const viewer = context ? this.viewerOf(user, context, 'read') : null;
      if (context && viewer && viewer !== 'STAFF') views.push(this.view(conversation, context, viewer));
    }
    return paginated(views, total, query);
  }

  /** Conversas de um pedido/entrega para a equipe de suporte (auditado). */
  async forStaff(user: AuthUser, ref: { orderId?: string; deliveryId?: string }) {
    if (!ref.orderId && !ref.deliveryId) throw new BadRequestException('Informe o pedido ou a entrega.');
    const conversations = await this.prisma.conversation.findMany({
      where: { tenantId: user.tenantId, OR: [...(ref.orderId ? [{ orderId: ref.orderId }] : []), ...(ref.deliveryId ? [{ deliveryId: ref.deliveryId }] : [])] },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 500 } },
    });
    await this.audit.log({ action: 'chat.staff_view', entityType: ref.orderId ? 'Order' : 'Delivery', entityId: ref.orderId ?? ref.deliveryId });
    return conversations.map((conversation) => ({
      id: conversation.id,
      type: conversation.type,
      messages: conversation.messages.map((message) => ({ id: message.id, senderRole: message.senderRole, body: message.body, createdAt: message.createdAt })),
    }));
  }

  // ---------------------------------------------------------------------------
  // Envio
  // ---------------------------------------------------------------------------

  async send(user: AuthUser, conversationId: string, text: string) {
    const body = text.trim();
    if (!body) throw new BadRequestException('Escreva uma mensagem.');
    if (body.length > 2000) throw new BadRequestException('Mensagem muito longa (máximo 2.000 caracteres).');
    const { conversation, context, viewer } = await this.load(user, conversationId, 'send');
    if (viewer === 'STAFF' || !this.canSend(context, viewer)) throw new ConflictException('Esta conversa foi encerrada.');

    const now = new Date();
    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({ data: { conversationId, senderUserId: user.userId, senderRole: viewer as ChatRole, body } });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: now, lastMessagePreview: body.slice(0, 140), [this.readField(viewer)]: now, driverId: context.driverId },
      });
      return created;
    });

    const payload = {
      conversationId,
      orderId: conversation.orderId,
      deliveryId: conversation.deliveryId,
      message: { id: message.id, body, createdAt: message.createdAt, senderRole: viewer, senderName: context.names[viewer] },
    };
    for (const side of SIDES[context.type]) {
      if (side === 'CUSTOMER' && context.customerUserId) this.realtime.toUser(context.customerUserId, 'chat.message', payload);
      if (side === 'DRIVER' && context.driverId) this.realtime.toDriver(context.driverId, 'chat.message', payload);
      if (side === 'COMPANY' && context.companyId) this.realtime.toCompany(context.companyId, 'chat.message', payload);
    }
    const counterpart = SIDES[context.type].find((side) => side !== viewer)!;
    const recipient = counterpart === 'CUSTOMER' ? context.customerUserId : counterpart === 'DRIVER' ? context.driverUserId : null;
    if (recipient) {
      await this.notifications.notify({
        userId: recipient,
        type: 'chat.message',
        title: `Mensagem de ${context.names[viewer]}`,
        body: body.slice(0, 160),
        data: { conversationId, orderId: conversation.orderId, deliveryId: conversation.deliveryId },
        channels: ['push'],
        app: counterpart === 'CUSTOMER' ? 'CUSTOMER' : 'DRIVER',
      });
    }
    return payload.message;
  }

  async markRead(user: AuthUser, conversationId: string) {
    const { context, viewer } = await this.load(user, conversationId, 'read');
    if (viewer === 'STAFF') return;
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { [this.readField(viewer)]: new Date(), driverId: context.driverId } });
  }

  /** Ligação mascarada (somente com o pedido/entrega em andamento). */
  async call(user: AuthUser, conversationId: string) {
    if (!this.voice.enabled) throw new UnprocessableEntityException('Ligação indisponível no momento. Use o chat.');
    const { conversation, context, viewer } = await this.load(user, conversationId, 'send');
    if (viewer === 'STAFF' || !context.active) throw new ConflictException('Ligações só durante o pedido/entrega em andamento.');
    const counterpart = SIDES[context.type].find((side) => side !== viewer)!;
    const callerPhone = viewer === 'COMPANY' ? (await this.prisma.user.findUnique({ where: { id: user.userId }, select: { phone: true } }))?.phone : context.phones[viewer];
    const calleePhone = context.phones[counterpart];
    if (!callerPhone || !calleePhone) throw new UnprocessableEntityException('Não há telefone cadastrado para completar a ligação. Use o chat.');
    const recent = await this.prisma.maskedCall.count({ where: { conversationId, createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
    if (recent >= 6) throw new ConflictException('Limite de ligações desta conversa atingido. Use o chat.');
    let status = 'REQUESTED';
    let providerCallId: string | undefined;
    try {
      ({ providerCallId } = await this.voice.bridge({ callerPhone, calleePhone, announcement: `Conectando você com ${context.names[counterpart]}. Aguarde.` }));
    } catch {
      status = 'FAILED';
    }
    await this.prisma.maskedCall.create({
      data: { tenantId: context.tenantId, conversationId, callerUserId: user.userId, calleeRole: counterpart, provider: this.voice.name, providerCallId, status },
    });
    await this.audit.log({ action: 'chat.call', entityType: 'Conversation', entityId: conversation.id, metadata: { status, callee: counterpart } });
    if (status === 'FAILED') throw new ConflictException('Não foi possível completar a ligação agora. Tente novamente ou use o chat.');
    return { status: 'CALLING', message: `Você vai receber uma ligação do número da plataforma. Atenda para falar com ${context.names[counterpart]}.` };
  }

  // ---------------------------------------------------------------------------
  // LGPD
  // ---------------------------------------------------------------------------

  /** Após a anonimização do titular, o conteúdo das mensagens dele é removido. */
  @OnEvent(USER_ANONYMIZED)
  async onAnonymized(event: UserAnonymizedEvent) {
    await this.prisma.chatMessage.updateMany({ where: { senderUserId: event.userId }, data: { body: '[mensagem removida a pedido do titular]', senderUserId: null } });
  }

  @OnEvent(USER_EXPORTING)
  async onExport(collector: UserExportCollector) {
    collector.sections.chatMessages = await this.prisma.chatMessage.findMany({
      where: { senderUserId: collector.userId },
      orderBy: { createdAt: 'desc' },
      take: 2000,
      select: { body: true, createdAt: true, senderRole: true, conversation: { select: { type: true, orderId: true, deliveryId: true } } },
    });
  }
}
