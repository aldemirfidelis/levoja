import { Global, Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { AdminUsersService } from './admin-users.service';
import { OneTimeTokenService } from './one-time-token.service';
import { InvitationsService } from './invitations.service';
import { AdminUsersController, MeController } from './users.controller';

@Global()
@Module({
  providers: [UsersService, AdminUsersService, OneTimeTokenService, InvitationsService],
  controllers: [MeController, AdminUsersController],
  exports: [UsersService, OneTimeTokenService, InvitationsService],
})
export class UsersModule {}
