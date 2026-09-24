import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_STATUS_LABELS } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { businessEvents } from '../../infra/observability/metrics';
import { NotificationsService, NotificationChannel } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ORDER_CREATED, ORDER_STATUS_CHANGED, OrderStatusChangedEvent } from './orders.service';

/** Mensagens ao cliente por status (status sem mensagem não geram notificação). */
const CUSTOMER_MESSAGES: Partial<Record<string, { title: string; body: string; channels: NotificationChannel[] }>> = {
  NEW: { title: 'Pedido recebido', body: 'Aguardando a confirmação da loja.', channels: ['inapp'] },
  CONFIRMED: { title: 'Pedido confirmado', body: 'A loja confirmou seu pedido.', channels: ['inapp', 'push'] },
  PREPARING: { title: 'Pedido em preparação', body: 'Seu pedido está sendo preparado.', channels: ['inapp', 'push'] },
  READY_FOR_PICKUP: { title: 'Pedido pronto', body: 'Seu pedido está pronto.', channels: ['inapp', 'push'] },
  DRIVER_ASSIGNED: { title: 'Entregador a caminho da loja', body: 'Um entregador aceitou seu pedido.', channels: ['inapp', 'push'] },
  PICKED_UP: { title: 'Pedido coletado', body: 'O entregador coletou seu pedido.', channels: ['inapp', 'push'] },
  IN_TRANSIT: { title: 'Pedido a caminho', body: 'Acompanhe o entregador no mapa.', channels: ['inapp', 'push'] },
  DELIVERED: { title: 'Pedido entregue', body: 'Bom apetite! Avalie sua experiência.', channels: ['inapp', 'push'] },
  CANCELED: { title: 'Pedido cancelado', body: 'Seu pedido foi cancelado.', channels: ['inapp', 'push', 'email'] },
};

@Injectable()
export class OrderEventsListener {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  @OnEvent(ORDER_CREATED, { async: true, promisify: true })
  async onCreated(event: OrderStatusChangedEvent) {
    businessEvents.inc({ event: 'order_created' });
    await this.onChanged(event);
  }

  @OnEvent(ORDER_STATUS_CHANGED, { async: true, promisify: true })
  async onStatusChanged(event: OrderStatusChangedEvent) {
    businessEvents.inc({ event: `order_${event.to.toLowerCase()}` });
    await this.onChanged(event);
  }

  private async onChanged(event: OrderStatusChangedEvent) {
    const payload = { orderId: event.orderId, number: event.number, status: event.to, from: event.from, companyId: event.companyId };

    // Tempo real: cliente, painel da loja e torre de controle.
    this.realtime.toUser(event.customerUserId, 'order.updated', payload);
    this.realtime.toCompany(event.companyId, event.from === null ? 'order.new' : 'order.updated', payload);
    this.realtime.toOps(event.tenantId, 'order.updated', payload);

    // Notificação ao cliente.
    const message = CUSTOMER_MESSAGES[event.to];
    if (message && !(event.to === 'READY_FOR_PICKUP' && event.fulfillment === 'DELIVERY')) {
      const body =
        event.to === 'READY_FOR_PICKUP'
          ? 'Seu pedido está pronto para retirada. Informe o código na loja.'
          : event.to === 'CANCELED' && event.reason
            ? `Seu pedido foi cancelado. Motivo: ${event.reason}`
            : message.body;
      await this.notifications.notify({
        userId: event.customerUserId,
        type: `order.${event.to.toLowerCase()}`,
        title: `${message.title} (#${event.number})`,
        body,
        data: payload,
        channels: message.channels,
        app: 'CUSTOMER',
      });
    }

    // Notificação à loja: pedido novo e cancelamentos que ela não fez.
    if (event.to === 'NEW' || (event.to === 'CANCELED' && event.actorType !== 'COMPANY')) {
      const members = await this.prisma.companyUser.findMany({
        where: { companyId: event.companyId, isActive: true, role: { permissions: { some: { permission: { key: 'company.orders.read' } } } } },
        select: { userId: true },
      });
      await this.notifications.notifyMany(
        members.map((member) => member.userId),
        {
          type: event.to === 'NEW' ? 'company.order.new' : 'company.order.canceled',
          title: event.to === 'NEW' ? `Novo pedido #${event.number}` : `Pedido #${event.number} cancelado`,
          body: event.to === 'NEW' ? 'Confirme o pedido para iniciar o preparo.' : `Status: ${ORDER_STATUS_LABELS.CANCELED}. ${event.reason ?? ''}`.trim(),
          data: payload,
          channels: ['inapp', 'push'],
        },
      );
    }
  }
}
