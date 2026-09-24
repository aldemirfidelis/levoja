import { Global, Module } from '@nestjs/common';
import { LegalService } from './legal.service';
import { PrivacyService } from './privacy.service';
import { AdminPrivacyController, LegalController, MePrivacyController } from './privacy.controller';

@Global()
@Module({
  providers: [LegalService, PrivacyService],
  controllers: [LegalController, MePrivacyController, AdminPrivacyController],
  exports: [LegalService, PrivacyService],
})
export class PrivacyModule {}
