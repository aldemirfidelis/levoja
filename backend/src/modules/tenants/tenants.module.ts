import { Global, Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantMiddleware } from './tenant.middleware';

@Global()
@Module({
  providers: [TenantsService, TenantMiddleware],
  exports: [TenantsService, TenantMiddleware],
})
export class TenantsModule {}
