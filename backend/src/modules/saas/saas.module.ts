import { Global, Module } from '@nestjs/common';
import { AdminSaasController, CompanySubscriptionController, PublicPlansController } from './saas.controller';
import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';
import { PlanFeatureGuard } from './plan-feature.guard';

/** Planos SaaS para empresas: recursos, limites, assinaturas e cobrança mensal. */
@Global()
@Module({
  controllers: [PublicPlansController, AdminSaasController, CompanySubscriptionController],
  providers: [PlansService, SubscriptionsService, PlanFeatureGuard],
  exports: [SubscriptionsService, PlanFeatureGuard],
})
export class SaasModule {}
