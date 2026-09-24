import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';

@Global()
@Module({
  providers: [AccessService, RolesService],
  controllers: [RolesController],
  exports: [AccessService, RolesService],
})
export class AccessModule {}
