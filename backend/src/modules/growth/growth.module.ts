import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminGrowthController, CompanyFleetController, CustomerHomeController, DriverFleetController, ReferralsController } from './growth.controller';
import { CustomerHomeService } from './customer-home.service';
import { LoyaltyService } from './loyalty.service';
import { ReferralsService } from './referrals.service';
import { FleetService } from './fleet.service';

/** Fase 10 — Crescimento e relacionamento: Home do cliente, favoritos, fidelidade, indicação e frota própria. */
@Module({
  imports: [AuthModule],
  controllers: [CustomerHomeController, ReferralsController, CompanyFleetController, DriverFleetController, AdminGrowthController],
  providers: [CustomerHomeService, LoyaltyService, ReferralsService, FleetService],
  exports: [LoyaltyService, ReferralsService],
})
export class GrowthModule {}
