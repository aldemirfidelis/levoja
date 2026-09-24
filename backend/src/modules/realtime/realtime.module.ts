import { Controller, Global, Injectable, Module, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { NOTIFICATION_CREATED } from '../notifications/notifications.service';
import { RealtimeGateway, SocketTicketPayload } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

@ApiTags('Tempo real')
@ApiBearerAuth()
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly jwt: JwtService) {}

  @Post('ticket')
  @ApiOperation({ summary: 'Ticket de 60 s para conectar ao Socket.IO (namespace /realtime)' })
  async ticket(@CurrentUser() user: AuthUser) {
    const payload: SocketTicketPayload = { sub: user.userId, typ: 'ws' };
    return { ticket: await this.jwt.signAsync(payload, { expiresIn: 60 }), namespace: '/realtime' };
  }
}

/** Repasse das notificações internas para o canal em tempo real (badge e toast imediatos). */
@Injectable()
export class NotificationRealtimeListener {
  constructor(private readonly realtime: RealtimeService) {}

  @OnEvent(NOTIFICATION_CREATED)
  onNotification(notification: { id: string; userId: string; type: string; title: string; body: string; data: unknown; createdAt: Date }) {
    const { userId, ...payload } = notification;
    this.realtime.toUser(userId, 'notification', payload);
  }
}

@Global()
@Module({
  providers: [RealtimeGateway, RealtimeService, NotificationRealtimeListener],
  controllers: [RealtimeController],
  exports: [RealtimeService],
})
export class RealtimeModule {}
