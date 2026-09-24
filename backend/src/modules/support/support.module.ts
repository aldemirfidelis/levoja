import { Global, Module } from '@nestjs/common';
import { AdminSupportController, SupportController } from './support.controller';
import { SupportService } from './support.service';

@Global()
@Module({
  controllers: [SupportController, AdminSupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
