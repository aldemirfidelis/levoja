import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { JobsService } from '../../infra/jobs/jobs.service';
import { MailService, MailMessage } from '../../infra/mail/mail.service';
import { PushProvider, SmsProvider } from './providers';
import { Prisma } from '../../generated/prisma/client';
import type { ConsentType } from '../../generated/prisma/enums';

export type NotificationChannel = 'inapp' | 'push' | 'email' | 'sms' | 'whatsapp';

export interface NotifyInput {
  userId: string;
  /** Evento de origem, ex.: "company.approved". */
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channels?: NotificationChannel[];
  /** Mensagens de marketing respeitam as preferências/consentimentos do usuário. */
  category?: 'transactional' | 'marketing';
  email?: Omit<MailMessage, 'to'>;
  /** Push apenas para os dispositivos deste app (ex.: ofertas só no app do entregador). */
  app?: 'CUSTOMER' | 'DRIVER' | 'COMPANY' | 'ADMIN';
  /** Canal Android do push. */
  channelId?: string;
  ttlSeconds?: number;
}

export const NOTIFICATION_CREATED = 'notification.created';

interface DeliveryJob {
  userId: string;
  channels: NotificationChannel[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  email?: Omit<MailMessage, 'to'>;
  app?: NotifyInput['app'];
  channelId?: string;
  ttlSeconds?: number;
}

/**
 * Central de notificações: um único ponto para todos os canais.
 * A notificação interna é gravada de forma síncrona; os canais externos
 * são entregues de forma assíncrona pela fila (com retentativas).
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
    private readonly push: PushProvider,
    private readonly sms: SmsProvider,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit(): void {
    this.jobs.register<DeliveryJob>('notifications.deliver', (job) => this.deliver(job));
  }

  /** Retorna os canais efetivamente usados (marketing: apenas os com consentimento). */
  async notify(input: NotifyInput): Promise<NotificationChannel[]> {
    const channels = input.channels ?? ['inapp', 'push'];
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, tenantId: true, status: true, anonymizedAt: true },
    });
    if (!user || user.anonymizedAt) return [];

    const allowed = input.category === 'marketing' ? await this.filterByConsent(user.id, channels) : channels;

    if (allowed.includes('inapp')) {
      const notification = await this.prisma.notification.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          type: input.type,
          title: input.title,
          body: input.body,
          data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      this.events.emit(NOTIFICATION_CREATED, notification);
    }

    const external = allowed.filter((channel) => channel !== 'inapp');
    if (external.length) {
      await this.jobs.enqueue<DeliveryJob>('notifications.deliver', {
        userId: user.id,
        channels: external,
        title: input.title,
        body: input.body,
        data: { ...input.data, type: input.type },
        email: input.email,
        app: input.app,
        channelId: input.channelId,
        ttlSeconds: input.ttlSeconds,
      });
    }
    return allowed;
  }

  async notifyMany(userIds: string[], input: Omit<NotifyInput, 'userId'>): Promise<void> {
    for (const userId of new Set(userIds)) await this.notify({ ...input, userId });
  }

  private async deliver(job: DeliveryJob): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: job.userId },
      select: { email: true, phone: true, anonymizedAt: true, devices: { select: { token: true, app: true } } },
    });
    if (!user || user.anonymizedAt) return;

    const devices = job.app ? user.devices.filter((device) => device.app === job.app) : user.devices;
    if (job.channels.includes('push') && devices.length) {
      const { invalidTokens } = await this.push.send({
        tokens: devices.map((device) => device.token),
        title: job.title,
        body: job.body,
        data: job.data,
        channelId: job.channelId,
        ttlSeconds: job.ttlSeconds,
      });
      if (invalidTokens.length) await this.prisma.deviceToken.deleteMany({ where: { token: { in: invalidTokens } } });
    }
    if (job.channels.includes('email') && user.email) {
      await this.mail.send({ to: user.email, ...(job.email ?? { subject: job.title, paragraphs: [job.body] }) });
    }
    for (const channel of ['sms', 'whatsapp'] as const) {
      if (job.channels.includes(channel) && user.phone) {
        await this.sms.send({ to: user.phone, body: `${job.title}: ${job.body}`, channel });
      }
    }
  }

  /** Marketing só é enviado pelos canais com consentimento vigente (LGPD, art. 7º, I). */
  private async filterByConsent(userId: string, channels: NotificationChannel[]): Promise<NotificationChannel[]> {
    const byChannel: Partial<Record<NotificationChannel, ConsentType>> = {
      email: 'MARKETING_EMAIL',
      push: 'MARKETING_PUSH',
      sms: 'MARKETING_SMS',
      whatsapp: 'MARKETING_WHATSAPP',
    };
    const records = await this.prisma.consent.findMany({
      where: { userId, type: { in: Object.values(byChannel) } },
      orderBy: { createdAt: 'desc' },
      select: { type: true, granted: true },
    });
    const latest = new Map<ConsentType, boolean>();
    for (const record of records) if (!latest.has(record.type)) latest.set(record.type, record.granted);
    return channels.filter((channel) => channel === 'inapp' || latest.get(byChannel[channel]!) === true);
  }
}
