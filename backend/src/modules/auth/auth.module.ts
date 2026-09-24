import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TokenService } from './token.service';
import { CompaniesModule } from '../companies/companies.module';
import { DriversModule } from '../drivers/drivers.module';

@Module({
  imports: [CompaniesModule, DriversModule],
  providers: [AuthService, TokenService],
  controllers: [AuthController],
  exports: [TokenService],
})
export class AuthModule {}
