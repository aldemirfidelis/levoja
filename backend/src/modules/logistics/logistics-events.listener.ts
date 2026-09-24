import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DELIVERY_STATUS_LABELS } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { JobsService } from '../../infra/jobs/jobs.service';
import { businessEvents } from '../../infra/observability/metrics';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SettingsService } from '../settings/settings.service';
import { ORDER_STATUS_CHANGED, OrdersService, OrderStatusChangedEvent } from '../orders/orders.service';
import { DELIVERY_STATUS_CHANGED, DeliveriesService, DeliveryStatusChangedEvent } from './deliveries.service';
import { DELIVERY_OFFER_CREATED, DISPATCH_STALLED, DispatchService, OfferCreatedEvent } from './dispatch.service';
import type { OrderStatus } from '../../generated/prisma/enums';

/** Status da entrega → status do pedido correspondente. */
const ORDER_SYNC: Partial<Record<string, OrderStatus>> = {
  DRIVER_ASSIGNED: 'DRIVER_ASSIGNED',
  PICKED_UP: 'PICKED_UP',
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  FAILED: 'CANCELED',
  CANCELED: 'CANCELED',
};

/** Progresso logístico do pedido (para ignorar eventos atrasados). */
const ORDER_PROGRESS: Partial<Record<OrderStatus, number>> = { READY_FOR_PICKUP: 0, DRIVER_ASSIGNED: 1, PICKED_UP: 2, IN_TRANSIT: 3, DELIVERED: 4 };

const CANCELABLE_DELIVERY = ['PENDING', 'SCHEDULED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'AT_PICKUP'];

/**
 * Orquestra o ciclo pedido ↔ entrega:
 * pedido confirmado cria a entrega; pedido pronto aciona o despacho; cada avanço da entrega
 * avança o pedido; cancelamentos se propagam nos dois sentidos (sem laços).
 */
@Injectable()
export class LogisticsEventsListener {
  private readonly logger = new Logger(LogisticsEventsListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly orders: OrdersService,
    private readonly deliveries: DeliveriesService,
    private readonly dispatch: DispatchService,
  ) {}

  @OnEvent(ORDER_STATUS_CHANGED, { async: true, promisify: true })
  async onOrderChanged(event: OrderStatusChangedEvent) {
    if (event.fulfillment !== 'DELIVERY') return;
    try {
      if (event.to === 'CONFIRMED') await this.deliveries.createForOrder(event.orderId);
      if (event.to === 'READY_FOR_PICKUP' && event.from !== 'DRIVER_ASSIGNED') {
        const delivery = (await this.prisma.delivery.findUnique({ where: { orderId: event.orderId } })) ?? (await this.deliveries.createForOrder(event.orderId));
        if (delivery) await this.dispatch.start(delivery.id);
      }
      if (event.to === 'CANCELED') {
        const delivery = await this.prisma.delivery.findUnique({ where: { orderId: event.orderId } });
        if (delivery && CANCELABLE_DELIVERY.includes(delivery.status)) {
          await this.prisma.deliveryOffer.updateMany({ where: { deliveryId: delivery.id, status: 'PENDING' }, data: { status: 'CANCELED' } });
          await this.deliveries.transition(delivery.id, 'CANCELED', { type: 'SYSTEM' }, { reason: event.reason ?? 'Pedido cancelado' });
        }
      }
    } catch (error) {
      this.logger.error(`Falha ao sincronizar entrega do pedido ${event.orderId}: ${(error as Error).message}`);
    }
  }

  @OnEvent(DELIVERY_STATUS_CHANGED, { async: true, promisify: true })
  async onDeliveryChanged(event: DeliveryStatusChangedEvent) {
    businessEvents.inc({ event: `delivery_${event.to.toLowerCase()}` });
    try {
      await this.syncOrder(event);
      await this.updateDriver(event);
      if (event.to === 'PENDING' && event.kind === 'ON_DEMAND') await this.dispatch.start(event.deliveryId);
      if (event.to === 'SCHEDULED') await this.scheduleStart(event);
      this.broadcast(event);
      await this.notify(event);
      await this.notifyDriverOfCancellation(event);
    } catch (error) {
      this.logger.error(`Falha ao processar evento da entrega ${event.deliveryId}: ${(error as Error).message}`);
    }
  }

  private async syncOrder(event: DeliveryStatusChangedEvent) {
    if (!event.orderId) return;
    const order = await this.prisma.order.findUnique({ where: { id: event.orderId }, select: { status: true } });
    if (!order || order.status === 'CANCELED' || order.status === 'DELIVERED') return;
    const actor = { type: event.actorType === 'DRIVER' ? ('DRIVER' as const) : ('SYSTEM' as const) };

    try {
      // Entregador desistiu antes da coleta: o pedido volta a aguardar entregador.
      if (event.to === 'SEARCHING_DRIVER' && order.status === 'DRIVER_ASSIGNED') {
        await this.orders.transition(event.orderId, 'READY_FOR_PICKUP', actor, { expectedFrom: ['DRIVER_ASSIGNED'] });
        return;
      }
      const target = ORDER_SYNC[event.to];
      if (!target || order.status === target) return;
      // Eventos podem ser processados fora de ordem: o pedido só avança, nunca retrocede.
      if (target !== 'CANCELED' && (ORDER_PROGRESS[order.status] ?? -1) >= (ORDER_PROGRESS[target] ?? -1)) return;
      const reason = event.to === 'FAILED' ? `Entrega não realizada: ${event.reason ?? ''}`.trim() : event.to === 'CANCELED' ? event.reason : undefined;
      await this.orders.transition(event.orderId, target, actor, { reason, expectedFrom: [order.status] });
    } catch (error) {
      // Outro evento já avançou o pedido (concorrência): o estado final continua consistente.
      if ((error as { status?: number }).status !== 409) throw error;
    }
  }

  private async updateDriver(event: DeliveryStatusChangedEvent) {
    if (!event.driverId) return;
    if (event.to === 'DELIVERED') {
      await this.prisma.driver.update({ where: { id: event.driverId }, data: { completedDeliveries: { increment: 1 } } });
    }
    if (['DELIVERED', 'FAILED', 'CANCELED', 'DRIVER_ASSIGNED'].includes(event.to)) await this.dispatch.refreshAvailability(event.driverId);
  }

  private async scheduleStart(event: DeliveryStatusChangedEvent) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: event.deliveryId }, select: { scheduledFor: true } });
    if (!delivery?.scheduledFor) return;
    const { leadMinutes } = await this.settings.get(event.tenantId, 'dispatch.scheduling');
    const delayMs = Math.max(0, delivery.scheduledFor.getTime() - leadMinutes * 60_000 - Date.now());
    await this.jobs.enqueue('dispatch.scheduledStart', { deliveryId: event.deliveryId }, { delayMs, jobId: `scheduled:${event.deliveryId}` });
  }

  private broadcast(event: DeliveryStatusChangedEvent) {
    const payload = { deliveryId: event.deliveryId, code: event.code, status: event.to, from: event.from, orderId: event.orderId };
    this.realtime.toUser(event.requesterUserId, 'delivery.updated', payload);
    if (event.companyId) this.realtime.toCompany(event.companyId, 'delivery.updated', payload);
    if (event.driverId) this.realtime.toDriver(event.driverId, 'delivery.updated', payload);
    this.realtime.toOps(event.tenantId, 'delivery.updated', payload);
  }

  /** Entregador com a entrega em andamento é avisado quando ela é cancelada por outra pessoa. */
  private async notifyDriverOfCancellation(event: DeliveryStatusChangedEvent) {
    if (event.to !== 'CANCELED' || !event.driverId || event.actorType === 'DRIVER') return;
    if (!event.from || !['DRIVER_ASSIGNED', 'AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'AT_DROPOFF'].includes(event.from)) return;
    const driver = await this.prisma.driver.findUnique({ where: { id: event.driverId }, select: { userId: true } });
    if (!driver) return;
    await this.notifications.notify({
      userId: driver.userId,
      type: 'delivery.canceled',
      title: `Entrega ${event.code} cancelada`,
      body: event.reason ? `Motivo: ${event.reason}` : 'A entrega foi cancelada. Confira o app.',
      data: { deliveryId: event.deliveryId, code: event.code, status: event.to },
      channels: ['inapp', 'push'],
      app: 'DRIVER',
    });
  }

  /** Pedidos do marketplace já notificam o cliente pelo fluxo do pedido; aqui, entregas avulsas. */
  private async notify(event: DeliveryStatusChangedEvent) {
    if (event.kind !== 'ON_DEMAND') return;
    const important = ['DRIVER_ASSIGNED', 'PICKED_UP', 'AT_DROPOFF', 'DELIVERED', 'FAILED', 'CANCELED'];
    if (!important.includes(event.to)) return;
    const recipients = event.companyId
      ? (
          await this.prisma.companyUser.findMany({
            where: { companyId: event.companyId, isActive: true, role: { permissions: { some: { permission: { key: 'company.deliveries.request' } } } } },
            select: { userId: true },
          })
        ).map((member) => member.userId)
      : [event.requesterUserId];
    await this.notifications.notifyMany(recipients, {
      type: `delivery.${event.to.toLowerCase()}`,
      title: `Entrega ${event.code}: ${DELIVERY_STATUS_LABELS[event.to]}`,
      body: event.reason ?? (event.to === 'AT_DROPOFF' ? 'O entregador chegou ao destino. Informe o código de entrega.' : 'Acompanhe pelo app.'),
      data: { deliveryId: event.deliveryId, code: event.code, status: event.to },
      channels: ['inapp', 'push'],
      ...(event.companyId ? {} : { app: 'CUSTOMER' as const }),
    });
  }

  @OnEvent(DELIVERY_OFFER_CREATED, { async: true, promisify: true })
  async onOffer(event: OfferCreatedEvent) {
    this.realtime.toDriver(event.driverId, 'delivery.offer', { offerId: event.offerId, deliveryId: event.deliveryId, payoutCents: event.payoutCents, expiresAt: event.expiresAt });
    await this.notifications.notify({
      userId: event.driverUserId,
      type: 'delivery.offer',
      title: 'Nova entrega disponível',
      body: `Ganho de R$ ${(event.payoutCents / 100).toFixed(2).replace('.', ',')}. Responda antes que expire.`,
      data: { offerId: event.offerId, deliveryId: event.deliveryId },
      channels: ['push'],
      app: 'DRIVER',
      channelId: 'offers',
      ttlSeconds: Math.max(5, Math.round((new Date(event.expiresAt).getTime() - Date.now()) / 1000)),
    });
  }

  @OnEvent(DISPATCH_STALLED, { async: true, promisify: true })
  async onStalled(event: { deliveryId: string; tenantId: string; attempts: number }) {
    const staff = await this.prisma.user.findMany({
      where: { tenantId: event.tenantId, status: 'ACTIVE', roles: { some: { role: { permissions: { some: { permission: { key: 'operations.view' } } } } } } },
      select: { id: true },
      take: 50,
    });
    this.realtime.toOps(event.tenantId, 'dispatch.stalled', event);
    await this.notifications.notifyMany(
      staff.map((user) => user.id),
      { type: 'ops.dispatch.stalled', title: 'Entrega sem entregador', body: `Após ${event.attempts} tentativas ainda não há entregador disponível.`, data: event, channels: ['inapp'] },
    );
  }
}
