import { Injectable, Module } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DriversService, DRIVER_SUBMITTED } from './drivers.service';
import { DriverReviewService } from './driver-review.service';
import { AdminDriversController, DriversController } from './drivers.controller';

/** Avisa a equipe de análise quando um entregador envia o cadastro. */
@Injectable()
export class DriverEventsListener {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @OnEvent(DRIVER_SUBMITTED, { async: true, promisify: true })
  async onSubmitted(event: { tenantId: string; driverId: string; name: string }) {
    const reviewers = await this.prisma.user.findMany({
      where: {
        tenantId: event.tenantId,
        status: 'ACTIVE',
        roles: { some: { role: { permissions: { some: { permission: { key: 'drivers.review' } } } } } },
      },
      select: { id: true },
      take: 50,
    });
    await this.notifications.notifyMany(
      reviewers.map((reviewer) => reviewer.id),
      {
        type: 'driver.submitted',
        title: 'Novo entregador para análise',
        body: `${event.name} enviou o cadastro para análise.`,
        data: { driverId: event.driverId },
        channels: ['inapp'],
      },
    );
  }
}

@Module({
  providers: [DriversService, DriverReviewService, DriverEventsListener],
  controllers: [DriversController, AdminDriversController],
  exports: [DriversService],
})
export class DriversModule {}
