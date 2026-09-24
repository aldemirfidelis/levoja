import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { REVIEW_CREATED, ReviewCreatedEvent } from '../../common/intelligence-events';
import { AuditService } from '../audit/audit.service';
import { paginated, PaginationQueryDto, skipOf } from '../../common/pagination';
import type { AuthUser } from '../../common/auth/auth-user';
import { ReviewInputDto } from './deliveries.dto';
import type { ActorType, ReviewSentiment, ReviewSubject } from '../../generated/prisma/enums';

const REVIEW_WINDOW_DAYS = 7;

/**
 * Avaliações (1 a 5 estrelas, comentário opcional):
 * cliente → loja e entregador; loja → entregador; entregador → cliente/loja.
 * A média exibida considera apenas avaliações não ocultadas pela moderação.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  private assertWindow(finishedAt: Date | null) {
    if (!finishedAt) throw new ConflictException('Só é possível avaliar após a conclusão.');
    if (Date.now() - finishedAt.getTime() > REVIEW_WINDOW_DAYS * 86_400_000) throw new ConflictException(`O prazo para avaliar é de ${REVIEW_WINDOW_DAYS} dias.`);
  }

  private async create(
    tenantId: string,
    author: { userId: string; type: ActorType },
    subject: { type: ReviewSubject; id: string },
    refs: { orderId?: string; deliveryId?: string },
    input: ReviewInputDto,
  ) {
    const duplicate = await this.prisma.review.findFirst({
      where: { authorUserId: author.userId, subjectType: subject.type, ...(refs.orderId ? { orderId: refs.orderId } : { deliveryId: refs.deliveryId }) },
    });
    if (duplicate) throw new ConflictException('Você já avaliou.');
    const review = await this.prisma.review.create({
      data: {
        tenantId,
        authorUserId: author.userId,
        authorType: author.type,
        subjectType: subject.type,
        subjectId: subject.id,
        orderId: refs.orderId,
        deliveryId: refs.deliveryId,
        rating: input.rating,
        comment: input.comment?.trim() || null,
        tags: input.tags ?? [],
      },
    });
    await this.recompute(subject.type, subject.id);
    this.events.emit(REVIEW_CREATED, { tenantId, reviewId: review.id } satisfies ReviewCreatedEvent);
    return review;
  }

  /** Cliente avalia a loja e/ou o entregador de um pedido entregue. */
  async reviewOrder(user: AuthUser, orderId: string, input: { company?: ReviewInputDto; driver?: ReviewInputDto }) {
    if (!input.company && !input.driver) throw new BadRequestException('Avalie a loja e/ou o entregador.');
    const order = await this.prisma.order.findFirst({ where: { id: orderId, customerId: user.customerId ?? '' }, include: { delivery: { select: { id: true, driverId: true } } } });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    if (order.status !== 'DELIVERED') throw new ConflictException('Só é possível avaliar pedidos entregues.');
    this.assertWindow(order.deliveredAt);
    const author = { userId: user.userId, type: 'CUSTOMER' as const };
    const results = [];
    if (input.company) results.push(await this.create(order.tenantId, author, { type: 'COMPANY', id: order.companyId }, { orderId }, input.company));
    if (input.driver) {
      if (!order.delivery?.driverId) throw new BadRequestException('Este pedido não teve entregador.');
      results.push(await this.create(order.tenantId, author, { type: 'DRIVER', id: order.delivery.driverId }, { orderId }, input.driver));
    }
    return results;
  }

  /** Solicitante de entrega avulsa avalia o entregador. */
  async reviewDeliveryDriver(user: AuthUser, deliveryId: string, input: ReviewInputDto, companyId?: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, ...(companyId ? { companyId } : { requesterUserId: user.userId }) },
    });
    if (!delivery) throw new NotFoundException('Entrega não encontrada.');
    if (delivery.status !== 'DELIVERED' || !delivery.driverId) throw new ConflictException('Só é possível avaliar entregas concluídas.');
    this.assertWindow(delivery.deliveredAt);
    return this.create(delivery.tenantId, { userId: user.userId, type: companyId ? 'COMPANY' : 'CUSTOMER' }, { type: 'DRIVER', id: delivery.driverId }, { deliveryId }, input);
  }

  /** Entregador avalia o cliente (destinatário) e/ou a loja de coleta. */
  async reviewByDriver(user: AuthUser, deliveryId: string, input: { customer?: ReviewInputDto; company?: ReviewInputDto }) {
    if (!user.driverId) throw new ForbiddenException('Perfil de entregador não encontrado.');
    const delivery = await this.prisma.delivery.findFirst({ where: { id: deliveryId, driverId: user.driverId }, include: { order: { select: { customerId: true } } } });
    if (!delivery) throw new NotFoundException('Entrega não encontrada.');
    if (delivery.status !== 'DELIVERED') throw new ConflictException('Só é possível avaliar entregas concluídas.');
    this.assertWindow(delivery.deliveredAt);
    const author = { userId: user.userId, type: 'DRIVER' as const };
    const results = [];
    if (input.customer) {
      const customer = delivery.order?.customerId
        ? { id: delivery.order.customerId }
        : await this.prisma.customer.findUnique({ where: { userId: delivery.requesterUserId }, select: { id: true } });
      if (customer) results.push(await this.create(delivery.tenantId, author, { type: 'CUSTOMER', id: customer.id }, { deliveryId }, input.customer));
    }
    if (input.company && delivery.companyId) {
      results.push(await this.create(delivery.tenantId, author, { type: 'COMPANY', id: delivery.companyId }, { deliveryId }, input.company));
    }
    return results;
  }

  async listForSubject(subjectType: ReviewSubject, subjectId: string, query: PaginationQueryDto) {
    const where = { subjectType, subjectId, isHidden: false };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.review.count({ where }),
      this.prisma.review.findMany({ where, orderBy: { createdAt: 'desc' }, skip: skipOf(query), take: query.pageSize, select: { id: true, rating: true, comment: true, tags: true, authorType: true, createdAt: true } }),
    ]);
    return paginated(rows, total, query);
  }

  async listForAdmin(tenantId: string, query: PaginationQueryDto & { maxRating?: number; sentiment?: ReviewSentiment; theme?: string }) {
    const where = {
      tenantId,
      ...(query.maxRating ? { rating: { lte: query.maxRating } } : {}),
      ...(query.sentiment ? { sentiment: query.sentiment } : {}),
      ...(query.theme ? { themes: { has: query.theme } } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.review.count({ where }),
      this.prisma.review.findMany({ where, orderBy: { createdAt: 'desc' }, skip: skipOf(query), take: query.pageSize }),
    ]);
    return paginated(rows, total, query);
  }

  async setHidden(actor: AuthUser, reviewId: string, hidden: boolean, reason?: string) {
    const review = await this.prisma.review.findFirst({ where: { id: reviewId, tenantId: actor.tenantId } });
    if (!review) throw new NotFoundException('Avaliação não encontrada.');
    await this.prisma.review.update({ where: { id: reviewId }, data: { isHidden: hidden, hiddenReason: hidden ? (reason ?? null) : null } });
    await this.recompute(review.subjectType, review.subjectId);
    await this.audit.log({ action: hidden ? 'review.hide' : 'review.show', entityType: 'Review', entityId: reviewId, metadata: { reason } });
  }

  /** Recalcula média e total do avaliado (indicador de qualidade). */
  private async recompute(subjectType: ReviewSubject, subjectId: string) {
    const stats = await this.prisma.review.aggregate({ where: { subjectType, subjectId, isHidden: false }, _avg: { rating: true }, _count: { _all: true } });
    const data = { ratingAvg: Math.round((stats._avg.rating ?? 0) * 100) / 100, ratingCount: stats._count._all };
    if (subjectType === 'COMPANY') await this.prisma.company.update({ where: { id: subjectId }, data });
    if (subjectType === 'DRIVER') await this.prisma.driver.update({ where: { id: subjectId }, data });
    if (subjectType === 'CUSTOMER') await this.prisma.customer.update({ where: { id: subjectId }, data });
  }
}
