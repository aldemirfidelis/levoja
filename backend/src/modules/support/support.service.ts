import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { TICKET_STATUS_LABELS } from '@levoja/shared';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { SubscriptionsService } from '../saas/subscriptions.service';
import { StorageService } from '../../infra/storage/storage.service';
import { safeFileName, UploadedFileLike, validateUpload } from '../../infra/storage/file-validation';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { USER_ANONYMIZED, USER_EXPORTING, UserAnonymizedEvent, UserExportCollector } from '../privacy/privacy.events';
import { paginated, PaginationQueryDto, skipOf } from '../../common/pagination';
import type { AuthUser } from '../../common/auth/auth-user';
import { Prisma } from '../../generated/prisma/client';
import type { SupportTicket } from '../../generated/prisma/client';
import type { ChatRole, TicketCategory, TicketPriority, TicketStatus } from '../../generated/prisma/enums';

export type RequesterRole = 'CUSTOMER' | 'DRIVER' | 'COMPANY';

export interface CreateTicketInput {
  as: RequesterRole;
  companyId?: string;
  category: TicketCategory;
  subject: string;
  description: string;
  orderId?: string;
  deliveryId?: string;
  paymentId?: string;
}

export interface StaffTicketsQuery extends PaginationQueryDto {
  status?: TicketStatus | 'ACTIVE';
  priority?: TicketPriority;
  category?: TicketCategory;
  assignee?: string;
  breached?: boolean;
}

const ACTIVE: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_REQUESTER'];
const REOPEN_DAYS = 7;
const AUTO_CLOSE_DAYS = 3;
const PERMISSION: Record<RequesterRole, string> = { CUSTOMER: 'customer.support.use', DRIVER: 'driver.support.use', COMPANY: 'company.support.use' };

const ticketInclude = {
  requester: { select: { id: true, name: true, email: true, phone: true } },
  assignee: { select: { id: true, name: true } },
  messages: { orderBy: { createdAt: 'asc' } },
  attachments: { orderBy: { createdAt: 'asc' } },
  events: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.SupportTicketInclude;

type TicketWithRelations = Prisma.SupportTicketGetPayload<{ include: typeof ticketInclude }>;

/**
 * Central de atendimento: chamados com categoria, prioridade, SLA (primeira resposta e resolução),
 * histórico, anexos, conversa com o solicitante e notas internas da equipe.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Abertura
  // ---------------------------------------------------------------------------

  private assertRole(user: AuthUser, as: RequesterRole, companyId?: string) {
    if (as === 'COMPANY') {
      if (!companyId || !user.canInCompany(companyId, PERMISSION.COMPANY)) throw new ForbiddenException('Sem permissão para abrir chamados por esta empresa.');
    } else if (!user.can(PERMISSION[as])) {
      throw new ForbiddenException('Sem permissão para abrir chamados.');
    }
    if (as === 'DRIVER' && !user.driverId) throw new ForbiddenException('Perfil de entregador não encontrado.');
  }

  /** Pedido/entrega/pagamento citados precisam pertencer a quem abre o chamado. */
  private async assertReferences(user: AuthUser, input: CreateTicketInput): Promise<{ active: boolean }> {
    let active = false;
    if (input.orderId) {
      const order = await this.prisma.order.findFirst({
        where: { id: input.orderId, tenantId: user.tenantId },
        select: { status: true, companyId: true, customer: { select: { userId: true } }, delivery: { select: { driverId: true } } },
      });
      const owns =
        order &&
        ((input.as === 'CUSTOMER' && order.customer.userId === user.userId) ||
          (input.as === 'COMPANY' && order.companyId === input.companyId) ||
          (input.as === 'DRIVER' && !!user.driverId && order.delivery?.driverId === user.driverId));
      if (!owns) throw new BadRequestException('Pedido não encontrado entre os seus.');
      active = !['DELIVERED', 'CANCELED'].includes(order!.status);
    }
    if (input.deliveryId) {
      const delivery = await this.prisma.delivery.findFirst({ where: { id: input.deliveryId, tenantId: user.tenantId }, select: { status: true, requesterUserId: true, companyId: true, driverId: true } });
      const owns =
        delivery &&
        ((input.as === 'CUSTOMER' && delivery.requesterUserId === user.userId) ||
          (input.as === 'COMPANY' && delivery.companyId === input.companyId) ||
          (input.as === 'DRIVER' && delivery.driverId === user.driverId));
      if (!owns) throw new BadRequestException('Entrega não encontrada entre as suas.');
      active = active || !['DELIVERED', 'CANCELED', 'FAILED'].includes(delivery!.status);
    }
    if (input.paymentId) {
      const payment = await this.prisma.payment.findFirst({ where: { id: input.paymentId, tenantId: user.tenantId, payerUserId: user.userId }, select: { id: true } });
      if (!payment) throw new BadRequestException('Pagamento não encontrado entre os seus.');
    }
    return { active };
  }

  /** Prioridade inicial: dinheiro e pedidos em andamento vêm primeiro. */
  private initialPriority(category: TicketCategory, active: boolean): TicketPriority {
    if (active && (category === 'ORDER' || category === 'DELIVERY' || category === 'DRIVER')) return 'HIGH';
    if (category === 'PAYMENT' || category === 'REFUND') return 'HIGH';
    return active ? 'HIGH' : 'MEDIUM';
  }

  private async dueDates(tenantId: string, priority: TicketPriority, from: Date) {
    const sla = (await this.settings.get(tenantId, 'support.sla'))[priority];
    return {
      firstResponseDueAt: new Date(from.getTime() + sla.firstResponseMinutes * 60_000),
      resolutionDueAt: new Date(from.getTime() + sla.resolutionMinutes * 60_000),
    };
  }

  private async nextNumber(tx: Tx, tenantId: string): Promise<number> {
    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO counters ("tenantId", key, value) VALUES (${tenantId}::uuid, 'ticket', 1)
      ON CONFLICT ("tenantId", key) DO UPDATE SET value = counters.value + 1
      RETURNING value`;
    return Number(rows[0].value);
  }

  async create(user: AuthUser, input: CreateTicketInput) {
    this.assertRole(user, input.as, input.companyId);
    const { active } = await this.assertReferences(user, input);
    let priority = this.initialPriority(input.category, active);
    // Plano com SLA: chamados da empresa entram, no mínimo, com prioridade alta.
    if (input.as === 'COMPANY' && input.companyId && (priority === 'LOW' || priority === 'MEDIUM') && (await this.subscriptions.hasFeature(user.tenantId, input.companyId, 'sla'))) {
      const { enforced } = await this.subscriptions.effective(user.tenantId, input.companyId);
      if (enforced) priority = 'HIGH';
    }
    const now = new Date();
    const due = await this.dueDates(user.tenantId, priority, now);
    const ticket = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supportTicket.create({
        data: {
          tenantId: user.tenantId,
          number: await this.nextNumber(tx, user.tenantId),
          requesterUserId: user.userId,
          requesterRole: input.as as ChatRole,
          companyId: input.as === 'COMPANY' ? input.companyId : null,
          orderId: input.orderId,
          deliveryId: input.deliveryId,
          paymentId: input.paymentId,
          category: input.category,
          priority,
          subject: input.subject.trim(),
          description: input.description.trim(),
          // Mesmo relógio dos prazos de SLA.
          createdAt: now,
          ...due,
          events: { create: { type: 'CREATED', actorUserId: user.userId, toValue: priority } },
        },
      });
      await this.audit.log({ action: 'support.ticket.create', entityType: 'SupportTicket', entityId: created.id, after: { number: created.number, category: input.category, priority } }, tx);
      return created;
    });
    this.realtime.toSupport(user.tenantId, 'support.ticket.created', { ticketId: ticket.id, number: ticket.number, priority });
    await this.notifyStaff(user.tenantId, `Novo chamado #${ticket.number}`, `${ticket.subject}`, ticket.id);
    return this.getForRequester(user, ticket.id);
  }

  // ---------------------------------------------------------------------------
  // Solicitante
  // ---------------------------------------------------------------------------

  /** Quem abriu (ou membros da empresa, nos chamados da empresa) enxerga o chamado. */
  private async findForRequester(user: AuthUser, ticketId: string): Promise<TicketWithRelations> {
    const ticket = await this.prisma.supportTicket.findFirst({ where: { id: ticketId, tenantId: user.tenantId }, include: ticketInclude });
    const allowed = ticket && (ticket.requesterUserId === user.userId || (ticket.companyId && user.canInCompany(ticket.companyId, PERMISSION.COMPANY)));
    if (!allowed) throw new NotFoundException('Chamado não encontrado.');
    return ticket!;
  }

  async listForRequester(user: AuthUser, query: PaginationQueryDto & { companyId?: string; as?: RequesterRole }) {
    let where: Prisma.SupportTicketWhereInput;
    if (query.companyId) {
      if (!user.canInCompany(query.companyId, PERMISSION.COMPANY)) throw new ForbiddenException('Sem acesso aos chamados desta empresa.');
      where = { tenantId: user.tenantId, companyId: query.companyId };
    } else {
      where = { tenantId: user.tenantId, requesterUserId: user.userId, companyId: null, ...(query.as ? { requesterRole: query.as as ChatRole } : {}) };
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: skipOf(query), take: query.pageSize }),
    ]);
    return paginated(rows.map((row) => this.summary(row)), total, query);
  }

  async getForRequester(user: AuthUser, ticketId: string) {
    return this.requesterView(await this.findForRequester(user, ticketId));
  }

  async replyAsRequester(user: AuthUser, ticketId: string, body: string) {
    const ticket = await this.findForRequester(user, ticketId);
    if (ticket.status === 'CLOSED') throw new ConflictException('Chamado encerrado. Abra um novo chamado se precisar.');
    const now = new Date();
    const reopen = ticket.status === 'RESOLVED';
    if (reopen && ticket.resolvedAt && now.getTime() - ticket.resolvedAt.getTime() > REOPEN_DAYS * 86_400_000) {
      throw new ConflictException('Este chamado foi resolvido há mais de 7 dias. Abra um novo chamado.');
    }
    const nextStatus: TicketStatus | null = reopen ? 'OPEN' : ticket.status === 'WAITING_REQUESTER' ? 'IN_PROGRESS' : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.ticketMessage.create({ data: { ticketId, authorUserId: user.userId, authorRole: 'REQUESTER', body: body.trim() } });
      if (nextStatus) {
        await tx.supportTicket.update({ where: { id: ticketId }, data: { status: nextStatus, resolvedAt: reopen ? null : undefined } });
        await tx.ticketEvent.create({ data: { ticketId, actorUserId: user.userId, type: reopen ? 'REOPENED' : 'STATUS', fromValue: ticket.status, toValue: nextStatus } });
      } else {
        await tx.supportTicket.update({ where: { id: ticketId }, data: { updatedAt: now } });
      }
    });
    this.realtime.toSupport(ticket.tenantId, 'support.ticket.updated', { ticketId, number: ticket.number });
    if (ticket.assigneeId) {
      await this.notifications.notify({ userId: ticket.assigneeId, type: 'support.reply', title: `Chamado #${ticket.number}: nova mensagem`, body: body.slice(0, 160), data: { ticketId }, channels: ['inapp'] });
    }
    return this.getForRequester(user, ticketId);
  }

  async closeByRequester(user: AuthUser, ticketId: string) {
    const ticket = await this.findForRequester(user, ticketId);
    if (ticket.status === 'CLOSED') return this.requesterView(ticket);
    await this.changeStatus(ticket, 'CLOSED', user.userId);
    return this.getForRequester(user, ticketId);
  }

  async rate(user: AuthUser, ticketId: string, rating: number, comment?: string) {
    const ticket = await this.findForRequester(user, ticketId);
    if (ticket.requesterUserId !== user.userId) throw new ForbiddenException('Somente quem abriu o chamado pode avaliar.');
    if (!['RESOLVED', 'CLOSED'].includes(ticket.status)) throw new ConflictException('Avalie depois que o chamado for resolvido.');
    if (ticket.rating) throw new ConflictException('Você já avaliou este atendimento.');
    await this.prisma.$transaction([
      this.prisma.supportTicket.update({ where: { id: ticketId }, data: { rating, ratingComment: comment?.trim() || null } }),
      this.prisma.ticketEvent.create({ data: { ticketId, actorUserId: user.userId, type: 'RATED', toValue: String(rating) } }),
    ]);
    return this.getForRequester(user, ticketId);
  }

  // ---------------------------------------------------------------------------
  // Anexos
  // ---------------------------------------------------------------------------

  async attach(user: AuthUser, ticketId: string, file: UploadedFileLike, asStaff: boolean, internal = false) {
    const ticket = asStaff ? await this.findForStaff(user, ticketId) : await this.findForRequester(user, ticketId);
    if (ticket.status === 'CLOSED') throw new ConflictException('Chamado encerrado.');
    if (ticket.attachments.length >= 20) throw new ConflictException('Limite de 20 anexos por chamado.');
    const { mime, ext } = validateUpload(file, 'document');
    const key = `private/tickets/${ticket.id}/${randomUUID()}.${ext}`;
    await this.storage.put(key, file.buffer, mime);
    const fileName = safeFileName(file.originalname || `anexo.${ext}`);
    const attachment = await this.prisma.ticketAttachment.create({
      data: { ticketId, fileKey: key, fileName, mimeType: mime, size: file.size, uploadedById: user.userId, internal: asStaff && internal },
    });
    await this.prisma.ticketEvent.create({ data: { ticketId, actorUserId: user.userId, type: 'ATTACHMENT', toValue: fileName } });
    return { id: attachment.id, fileName: attachment.fileName, mimeType: attachment.mimeType, size: attachment.size, internal: attachment.internal, createdAt: attachment.createdAt };
  }

  async attachmentFile(user: AuthUser, ticketId: string, attachmentId: string, asStaff: boolean) {
    const ticket = asStaff ? await this.findForStaff(user, ticketId) : await this.findForRequester(user, ticketId);
    const attachment = ticket.attachments.find((item) => item.id === attachmentId && (asStaff || !item.internal));
    if (!attachment) throw new NotFoundException('Anexo não encontrado.');
    const file = await this.storage.get(attachment.fileKey);
    if (!file) throw new NotFoundException('Arquivo não encontrado.');
    if (asStaff) await this.audit.log({ action: 'support.attachment.view', entityType: 'TicketAttachment', entityId: attachment.id });
    return { ...file, contentType: attachment.mimeType, fileName: attachment.fileName };
  }

  // ---------------------------------------------------------------------------
  // Equipe
  // ---------------------------------------------------------------------------

  private async findForStaff(user: AuthUser, ticketId: string): Promise<TicketWithRelations> {
    const ticket = await this.prisma.supportTicket.findFirst({ where: { id: ticketId, tenantId: user.tenantId }, include: ticketInclude });
    if (!ticket) throw new NotFoundException('Chamado não encontrado.');
    return ticket;
  }

  async listForStaff(user: AuthUser, query: StaffTicketsQuery) {
    const search = query.search?.trim();
    const where: Prisma.SupportTicketWhereInput = {
      tenantId: user.tenantId,
      status: query.status === 'ACTIVE' ? { in: ACTIVE } : query.status,
      priority: query.priority,
      category: query.category,
      ...(query.assignee === 'me' ? { assigneeId: user.userId } : query.assignee === 'none' ? { assigneeId: null } : query.assignee ? { assigneeId: query.assignee } : {}),
      ...(query.breached ? { slaBreachedAt: { not: null } } : {}),
      ...(search ? { OR: [...(/^\d+$/.test(search) ? [{ number: Number(search) }] : []), { subject: { contains: search, mode: 'insensitive' as const } }] } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({
        where,
        orderBy: [{ resolutionDueAt: 'asc' }],
        skip: skipOf(query),
        take: query.pageSize,
        include: { requester: { select: { name: true } }, assignee: { select: { name: true } } },
      }),
    ]);
    return paginated(
      rows.map((row) => ({ ...this.summary(row), requesterName: row.requester.name, assignee: row.assignee?.name ?? null, sla: this.slaState(row) })),
      total,
      query,
    );
  }

  async getForStaff(user: AuthUser, ticketId: string) {
    const ticket = await this.findForStaff(user, ticketId);
    const [order, delivery, payment] = await Promise.all([
      ticket.orderId ? this.prisma.order.findUnique({ where: { id: ticket.orderId }, select: { id: true, number: true, status: true, totalCents: true, company: { select: { tradeName: true } } } }) : null,
      ticket.deliveryId ? this.prisma.delivery.findUnique({ where: { id: ticket.deliveryId }, select: { id: true, code: true, status: true } }) : null,
      ticket.paymentId ? this.prisma.payment.findUnique({ where: { id: ticket.paymentId }, select: { id: true, method: true, status: true, amountCents: true } }) : null,
    ]);
    const actors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set([...ticket.messages.map((m) => m.authorUserId), ...ticket.events.map((e) => e.actorUserId)].filter((id): id is string => !!id))] } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(actors.map((actor) => [actor.id, actor.name]));
    return {
      ...this.summary(ticket),
      description: ticket.description,
      requester: ticket.requester,
      requesterRole: ticket.requesterRole,
      companyId: ticket.companyId,
      assignee: ticket.assignee,
      sla: this.slaState(ticket),
      firstResponseDueAt: ticket.firstResponseDueAt,
      resolutionDueAt: ticket.resolutionDueAt,
      firstRespondedAt: ticket.firstRespondedAt,
      resolvedAt: ticket.resolvedAt,
      rating: ticket.rating,
      ratingComment: ticket.ratingComment,
      order,
      delivery,
      payment,
      messages: ticket.messages.map((message) => ({
        id: message.id,
        body: message.body,
        internal: message.internal,
        authorRole: message.authorRole,
        authorName: message.authorUserId ? (nameOf.get(message.authorUserId) ?? '—') : 'Sistema',
        createdAt: message.createdAt,
      })),
      attachments: ticket.attachments.map(({ fileKey: _key, ...attachment }) => attachment),
      events: ticket.events.map((event) => ({ ...event, actorName: event.actorUserId ? (nameOf.get(event.actorUserId) ?? '—') : 'Sistema' })),
    };
  }

  async replyAsStaff(user: AuthUser, ticketId: string, body: string, internal: boolean) {
    const ticket = await this.findForStaff(user, ticketId);
    if (ticket.status === 'CLOSED') throw new ConflictException('Chamado encerrado.');
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.ticketMessage.create({ data: { ticketId, authorUserId: user.userId, authorRole: 'STAFF', body: body.trim(), internal } });
      if (!internal) {
        await tx.supportTicket.update({
          where: { id: ticketId },
          data: {
            firstRespondedAt: ticket.firstRespondedAt ?? now,
            status: ticket.status === 'OPEN' ? 'IN_PROGRESS' : undefined,
            assigneeId: ticket.assigneeId ?? user.userId,
          },
        });
        if (ticket.status === 'OPEN') await tx.ticketEvent.create({ data: { ticketId, actorUserId: user.userId, type: 'STATUS', fromValue: 'OPEN', toValue: 'IN_PROGRESS' } });
        if (!ticket.assigneeId) await tx.ticketEvent.create({ data: { ticketId, actorUserId: user.userId, type: 'ASSIGNED', toValue: user.userId } });
      }
    });
    if (!internal) await this.notifyRequester(ticket, `Resposta no chamado #${ticket.number}`, body.slice(0, 200));
    this.realtime.toUser(ticket.requesterUserId, 'support.ticket.updated', { ticketId, number: ticket.number });
    return this.getForStaff(user, ticketId);
  }

  async assign(user: AuthUser, ticketId: string, assigneeId: string | null) {
    const ticket = await this.findForStaff(user, ticketId);
    if (assigneeId) {
      const assignee = await this.prisma.user.findFirst({
        where: { id: assigneeId, tenantId: user.tenantId, status: 'ACTIVE', roles: { some: { role: { permissions: { some: { permission: { key: 'support.tickets.manage' } } } } } } },
        select: { id: true },
      });
      if (!assignee) throw new BadRequestException('Atendente inválido (precisa da permissão de atender chamados).');
    }
    await this.prisma.$transaction([
      this.prisma.supportTicket.update({ where: { id: ticketId }, data: { assigneeId, status: assigneeId && ticket.status === 'OPEN' ? 'IN_PROGRESS' : undefined } }),
      this.prisma.ticketEvent.create({ data: { ticketId, actorUserId: user.userId, type: 'ASSIGNED', fromValue: ticket.assigneeId, toValue: assigneeId } }),
    ]);
    if (assigneeId && assigneeId !== user.userId) {
      await this.notifications.notify({ userId: assigneeId, type: 'support.assigned', title: `Chamado #${ticket.number} atribuído a você`, body: ticket.subject, data: { ticketId }, channels: ['inapp'] });
    }
    return this.getForStaff(user, ticketId);
  }

  async setStatus(user: AuthUser, ticketId: string, status: TicketStatus) {
    const ticket = await this.findForStaff(user, ticketId);
    if (ticket.status === status) return this.getForStaff(user, ticketId);
    if (ticket.status === 'CLOSED') throw new ConflictException('Chamado encerrado não pode ser alterado.');
    await this.changeStatus(ticket, status, user.userId);
    if (status === 'RESOLVED') await this.notifyRequester(ticket, `Chamado #${ticket.number} resolvido`, 'Conte como foi o atendimento. Se algo ainda não estiver certo, responda no chamado.');
    if (status === 'WAITING_REQUESTER') await this.notifyRequester(ticket, `Chamado #${ticket.number}: precisamos da sua resposta`, 'Responda no chamado para continuarmos o atendimento.');
    return this.getForStaff(user, ticketId);
  }

  async setPriority(user: AuthUser, ticketId: string, priority: TicketPriority) {
    const ticket = await this.findForStaff(user, ticketId);
    if (ticket.priority === priority) return this.getForStaff(user, ticketId);
    // Prazos recalculados a partir da abertura com a nova prioridade.
    const due = await this.dueDates(ticket.tenantId, priority, ticket.createdAt);
    await this.prisma.$transaction([
      this.prisma.supportTicket.update({ where: { id: ticketId }, data: { priority, ...due } }),
      this.prisma.ticketEvent.create({ data: { ticketId, actorUserId: user.userId, type: 'PRIORITY', fromValue: ticket.priority, toValue: priority } }),
    ]);
    await this.audit.log({ action: 'support.ticket.priority', entityType: 'SupportTicket', entityId: ticketId, before: { priority: ticket.priority }, after: { priority } });
    return this.getForStaff(user, ticketId);
  }

  private async changeStatus(ticket: SupportTicket, status: TicketStatus, actorId: string) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.supportTicket.update({
        where: { id: ticket.id },
        data: {
          status,
          resolvedAt: status === 'RESOLVED' || status === 'CLOSED' ? (ticket.resolvedAt ?? now) : status === 'OPEN' || status === 'IN_PROGRESS' ? null : undefined,
          closedAt: status === 'CLOSED' ? now : null,
        },
      }),
      this.prisma.ticketEvent.create({ data: { ticketId: ticket.id, actorUserId: actorId, type: 'STATUS', fromValue: ticket.status, toValue: status } }),
    ]);
    this.realtime.toUser(ticket.requesterUserId, 'support.ticket.updated', { ticketId: ticket.id, number: ticket.number, status });
    this.realtime.toSupport(ticket.tenantId, 'support.ticket.updated', { ticketId: ticket.id, number: ticket.number, status });
  }

  async stats(user: AuthUser) {
    const tenantId = user.tenantId;
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [byStatus, breachedOpen, unassigned, mine, resolved] = await Promise.all([
      this.prisma.supportTicket.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
      this.prisma.supportTicket.count({ where: { tenantId, status: { in: ACTIVE }, slaBreachedAt: { not: null } } }),
      this.prisma.supportTicket.count({ where: { tenantId, status: { in: ACTIVE }, assigneeId: null } }),
      this.prisma.supportTicket.count({ where: { tenantId, status: { in: ACTIVE }, assigneeId: user.userId } }),
      this.prisma.supportTicket.findMany({
        where: { tenantId, createdAt: { gte: since } },
        select: { createdAt: true, firstRespondedAt: true, resolvedAt: true, slaBreachedAt: true, rating: true },
      }),
    ]);
    const minutes = (from: Date, to: Date | null) => (to ? (to.getTime() - from.getTime()) / 60_000 : null);
    const avg = (values: (number | null)[]) => {
      const list = values.filter((value): value is number => value != null);
      return list.length ? Math.round(list.reduce((sum, value) => sum + value, 0) / list.length) : null;
    };
    const ratings = resolved.map((row) => row.rating).filter((value): value is number => value != null);
    return {
      byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
      breachedOpen,
      unassigned,
      mine,
      last30Days: {
        opened: resolved.length,
        avgFirstResponseMinutes: avg(resolved.map((row) => minutes(row.createdAt, row.firstRespondedAt))),
        avgResolutionMinutes: avg(resolved.map((row) => minutes(row.createdAt, row.resolvedAt))),
        slaCompliance: resolved.length ? Math.round((resolved.filter((row) => !row.slaBreachedAt).length / resolved.length) * 1000) / 10 : null,
        csat: ratings.length ? Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 10) / 10 : null,
        ratings: ratings.length,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // SLA e encerramento automático
  // ---------------------------------------------------------------------------

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkSla(): Promise<number> {
    const now = new Date();
    const breached = await this.prisma.supportTicket.findMany({
      where: {
        status: { in: ACTIVE },
        slaBreachedAt: null,
        OR: [{ firstRespondedAt: null, firstResponseDueAt: { lt: now } }, { resolutionDueAt: { lt: now } }],
      },
      take: 500,
    });
    for (const ticket of breached) {
      const kind = !ticket.firstRespondedAt && ticket.firstResponseDueAt < now ? 'primeira resposta' : 'resolução';
      const updated = await this.prisma.supportTicket.updateMany({ where: { id: ticket.id, slaBreachedAt: null }, data: { slaBreachedAt: now } });
      if (!updated.count) continue;
      await this.prisma.ticketEvent.create({ data: { ticketId: ticket.id, type: 'SLA_BREACHED', toValue: kind } });
      this.realtime.toOps(ticket.tenantId, 'support.sla.breached', { ticketId: ticket.id, number: ticket.number, kind });
      this.realtime.toSupport(ticket.tenantId, 'support.sla.breached', { ticketId: ticket.id, number: ticket.number, kind });
      const title = `SLA estourado: chamado #${ticket.number}`;
      if (ticket.assigneeId) await this.notifications.notify({ userId: ticket.assigneeId, type: 'support.sla', title, body: `Prazo de ${kind} vencido.`, data: { ticketId: ticket.id }, channels: ['inapp'] });
      else await this.notifyStaff(ticket.tenantId, title, `Prazo de ${kind} vencido e chamado sem responsável.`, ticket.id);
    }
    if (breached.length) this.logger.warn(`${breached.length} chamado(s) com SLA estourado.`);
    return breached.length;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async autoClose(): Promise<number> {
    const limit = new Date(Date.now() - AUTO_CLOSE_DAYS * 86_400_000);
    const tickets = await this.prisma.supportTicket.findMany({ where: { status: 'RESOLVED', resolvedAt: { lt: limit } }, take: 500 });
    for (const ticket of tickets) {
      await this.prisma.$transaction([
        this.prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: 'CLOSED', closedAt: new Date() } }),
        this.prisma.ticketEvent.create({ data: { ticketId: ticket.id, type: 'AUTO_CLOSED', fromValue: 'RESOLVED', toValue: 'CLOSED' } }),
      ]);
    }
    return tickets.length;
  }

  // ---------------------------------------------------------------------------
  // Visões e notificações
  // ---------------------------------------------------------------------------

  private summary(ticket: SupportTicket) {
    return {
      id: ticket.id,
      number: ticket.number,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      subject: ticket.subject,
      orderId: ticket.orderId,
      deliveryId: ticket.deliveryId,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      slaBreached: !!ticket.slaBreachedAt,
    };
  }

  /** Situação do SLA: no prazo, em risco (menos de 25% do tempo) ou estourado. */
  private slaState(ticket: SupportTicket): { state: 'ok' | 'risk' | 'breached' | 'done'; dueAt: Date } {
    const done = ticket.status === 'RESOLVED' || ticket.status === 'CLOSED';
    const dueAt = ticket.firstRespondedAt ? ticket.resolutionDueAt : ticket.firstResponseDueAt;
    if (done) return { state: ticket.slaBreachedAt ? 'breached' : 'done', dueAt };
    const now = Date.now();
    if (ticket.slaBreachedAt || dueAt.getTime() < now) return { state: 'breached', dueAt };
    const total = dueAt.getTime() - ticket.createdAt.getTime();
    return { state: dueAt.getTime() - now < total * 0.25 ? 'risk' : 'ok', dueAt };
  }

  private requesterView(ticket: TicketWithRelations) {
    const now = Date.now();
    return {
      ...this.summary(ticket),
      description: ticket.description,
      statusLabel: TICKET_STATUS_LABELS[ticket.status],
      /** Expectativa de resposta mostrada a quem abriu. */
      expectedResponseAt: ticket.firstRespondedAt ? null : ticket.firstResponseDueAt,
      messages: ticket.messages
        .filter((message) => !message.internal)
        .map((message) => ({
          id: message.id,
          body: message.body,
          mine: message.authorRole === 'REQUESTER',
          authorName: message.authorRole === 'REQUESTER' ? 'Você' : message.authorRole === 'STAFF' ? 'Equipe de atendimento' : 'Sistema',
          createdAt: message.createdAt,
        })),
      attachments: ticket.attachments.filter((attachment) => !attachment.internal).map(({ fileKey: _key, internal: _internal, ...attachment }) => attachment),
      rating: ticket.rating,
      canReply: ticket.status !== 'CLOSED' && !(ticket.status === 'RESOLVED' && ticket.resolvedAt && now - ticket.resolvedAt.getTime() > REOPEN_DAYS * 86_400_000),
      canRate: ['RESOLVED', 'CLOSED'].includes(ticket.status) && !ticket.rating,
      canClose: ticket.status !== 'CLOSED',
    };
  }

  private async notifyRequester(ticket: SupportTicket, title: string, body: string) {
    await this.notifications.notify({
      userId: ticket.requesterUserId,
      type: 'support.ticket',
      title,
      body,
      data: { ticketId: ticket.id },
      channels: ['inapp', 'push', 'email'],
      ...(ticket.requesterRole === 'CUSTOMER' || ticket.requesterRole === 'DRIVER' ? { app: ticket.requesterRole } : {}),
      email: { subject: title, paragraphs: [body, 'Acompanhe e responda pelo app ou pelo portal.'] },
    });
  }

  private async notifyStaff(tenantId: string, title: string, body: string, ticketId: string) {
    const staff = await this.prisma.user.findMany({
      where: { tenantId, status: 'ACTIVE', roles: { some: { role: { permissions: { some: { permission: { key: 'support.tickets.manage' } } } } } } },
      select: { id: true },
      take: 50,
    });
    await this.notifications.notifyMany(
      staff.map((member) => member.id),
      { type: 'support.queue', title, body, data: { ticketId }, channels: ['inapp'] },
    );
  }

  // ---------------------------------------------------------------------------
  // LGPD
  // ---------------------------------------------------------------------------

  /** Chamados são mantidos (defesa e obrigações legais), mas o conteúdo escrito pelo titular é removido. */
  @OnEvent(USER_ANONYMIZED)
  async onAnonymized(event: UserAnonymizedEvent) {
    const tickets = await this.prisma.supportTicket.findMany({ where: { requesterUserId: event.userId }, include: { attachments: true } });
    for (const ticket of tickets) {
      for (const attachment of ticket.attachments.filter((item) => item.uploadedById === event.userId)) {
        await this.storage.delete(attachment.fileKey).catch(() => undefined);
        await this.prisma.ticketAttachment.delete({ where: { id: attachment.id } });
      }
      await this.prisma.supportTicket.update({ where: { id: ticket.id }, data: { subject: '[removido]', description: '[conteúdo removido a pedido do titular]', ratingComment: null } });
    }
    await this.prisma.ticketMessage.updateMany({ where: { authorUserId: event.userId }, data: { body: '[mensagem removida a pedido do titular]', authorUserId: null } });
  }

  @OnEvent(USER_EXPORTING)
  async onExport(collector: UserExportCollector) {
    collector.sections.supportTickets = await this.prisma.supportTicket.findMany({
      where: { requesterUserId: collector.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        number: true,
        category: true,
        status: true,
        subject: true,
        description: true,
        createdAt: true,
        rating: true,
        messages: { where: { internal: false }, select: { authorRole: true, body: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
      },
    });
  }
}
