import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppConfig } from '../../config/config.module';
import { SmsProvider } from '../notifications/providers';
import { DELIVERY_STATUS_CHANGED, DeliveryStatusChangedEvent, StopSnapshot } from '../logistics/deliveries.service';
import { DispatchService } from '../logistics/dispatch.service';

/**
 * Entregas corporativas: o destinatário (que não tem conta na plataforma) recebe o link de
 * acompanhamento e o código de recebimento por SMS quando a entrega sai para o destino, se o
 * contrato habilitar o aviso. Também mantém as rotas de lote consistentes quando entregas saem da busca.
 */
@Injectable()
export class B2bEventsListener {
  private readonly logger = new Logger(B2bEventsListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly sms: SmsProvider,
    private readonly dispatch: DispatchService,
  ) {}

  @OnEvent(DELIVERY_STATUS_CHANGED, { async: true, promisify: true })
  async onDeliveryChanged(event: DeliveryStatusChangedEvent) {
    try {
      if (event.from === 'SEARCHING_DRIVER' && event.to !== 'DRIVER_ASSIGNED') {
        const delivery = await this.prisma.delivery.findUnique({ where: { id: event.deliveryId }, select: { routeId: true } });
        if (delivery?.routeId) await this.dispatch.repairRoute(delivery.routeId);
      }
      if (event.to !== 'PICKED_UP' || !event.companyId || event.kind !== 'ON_DEMAND') return;
      const delivery = await this.prisma.delivery.findUnique({
        where: { id: event.deliveryId },
        select: { code: true, dropoff: true, dropoffCode: true, contractId: true, proofMethod: true, company: { select: { tradeName: true } } },
      });
      if (!delivery?.contractId) return;
      const contract = await this.prisma.corporateContract.findUnique({ where: { id: delivery.contractId }, select: { notifyRecipients: true } });
      const phone = (delivery.dropoff as unknown as StopSnapshot).phone?.replace(/\D/g, '');
      if (!contract?.notifyRecipients || !phone || phone.length < 10) return;
      const link = `${this.config.env.WEB_PUBLIC_URL.replace(/\/$/, '')}/rastreio/${delivery.code}`;
      const code = delivery.proofMethod === 'CODE' || delivery.proofMethod === 'QR_CODE' ? ` Código de recebimento: ${delivery.dropoffCode}.` : '';
      await this.sms.send({
        to: phone.length <= 11 ? `+55${phone}` : `+${phone}`,
        body: `${delivery.company?.tradeName ?? 'LevoJá'}: sua entrega saiu para o destino. Acompanhe: ${link}.${code}`,
        channel: 'sms',
      });
    } catch (error) {
      this.logger.error(`Aviso ao destinatário da entrega ${event.deliveryId} falhou: ${(error as Error).message}`);
    }
  }
}
