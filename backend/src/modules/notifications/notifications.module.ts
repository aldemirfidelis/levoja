import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { PushProvider, SmsProvider } from './providers';

@Global()
@Module({
  providers: [NotificationsService, PushProvider, SmsProvider],
  controllers: [NotificationsController],
  exports: [NotificationsService, PushProvider, SmsProvider],
})
export class NotificationsModule {}
