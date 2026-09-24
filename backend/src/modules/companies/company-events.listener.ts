import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { COMPANY_SUBMITTED } from './companies.service';

/** Avisa a equipe de análise quando uma empresa envia o cadastro. */
@Injectable()
export class CompanyEventsListener {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @OnEvent(COMPANY_SUBMITTED, { async: true, promisify: true })
  async onSubmitted(event: { tenantId: string; companyId: string; tradeName: string }) {
    const reviewers = await this.prisma.user.findMany({
      where: {
        tenantId: event.tenantId,
        status: 'ACTIVE',
        roles: { some: { role: { permissions: { some: { permission: { key: 'companies.review' } } } } } },
      },
      select: { id: true },
      take: 50,
    });
    await this.notifications.notifyMany(
      reviewers.map((reviewer) => reviewer.id),
      {
        type: 'company.submitted',
        title: 'Nova empresa para análise',
        body: `${event.tradeName} enviou o cadastro para análise.`,
        data: { companyId: event.companyId },
        channels: ['inapp'],
      },
    );
  }
}
