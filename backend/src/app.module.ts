import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { AppConfig, ConfigModule } from './config/config.module';
import { loadEnv } from './config/env';
import { RequestContext } from './common/request-context';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { CompanyAccessGuard, PermissionsGuard } from './common/guards/permissions.guard';
import { PrismaModule } from './infra/prisma/prisma.module';
import { RedisModule } from './infra/redis/redis.module';
import { CryptoModule } from './infra/crypto/crypto.module';
import { InfraModule } from './infra/infra.module';
import { MetricsInterceptor } from './infra/observability/metrics';
import { ObservabilityController, PublicFilesController } from './infra/observability/observability.controller';
import { TenantsModule } from './modules/tenants/tenants.module';
import { TenantMiddleware } from './modules/tenants/tenant.middleware';
import { AuditModule } from './modules/audit/audit.module';
import { AccessModule } from './modules/access/access.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { UsersModule } from './modules/users/users.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { PartnersModule } from './modules/partners/partners.module';
import { CustomersModule } from './modules/customers/customers.module';
import { SegmentsModule } from './modules/segments/segments.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { ContactModule } from './modules/contact/contact.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { MarketplaceModule } from './modules/marketplace.module';
import { LogisticsModule } from './modules/logistics/logistics.module';
import { FinanceModule } from './modules/finance/finance.module';
import { ChatModule } from './modules/chat/chat.module';
import { SupportModule } from './modules/support/support.module';
import { OperationsModule } from './modules/operations/operations.module';
import { BroadcastsModule } from './modules/broadcasts/broadcasts.module';
import { B2bModule } from './modules/b2b/b2b.module';
import { IntelligenceModule } from './modules/intelligence/intelligence.module';
import { SaasModule } from './modules/saas/saas.module';
import { CitiesModule } from './modules/cities/cities.module';
import { TenantsAdminModule } from './modules/tenants/tenants-admin.module';
import { CompanyBrandModule } from './modules/tenants/company-brand.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { PlanFeatureGuard } from './modules/saas/plan-feature.guard';
import { GrowthModule } from './modules/growth/growth.module';

const env = loadEnv();

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        transport: env.LOG_PRETTY ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } } : undefined,
        genReqId: (request: IncomingMessage) =>
          RequestContext.get()?.requestId ?? ((request.headers['x-request-id'] as string) || randomUUID()),
        customProps: () => ({ userId: RequestContext.get()?.userId }),
        // Dados sensíveis nunca vão para o log.
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', '*.password', '*.refreshToken', '*.cpf'],
          censor: '[REDACTED]',
        },
        autoLogging: { ignore: (request) => ['/health', '/metrics'].includes(request.url ?? '') },
        serializers: {
          req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
        },
      },
    }),
    JwtModule.registerAsync({
      global: true,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.env.JWT_ACCESS_SECRET,
        signOptions: { issuer: 'levoja', algorithm: 'HS256' },
        verifyOptions: { issuer: 'levoja', algorithms: ['HS256'] },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ name: 'default', ttl: config.env.RATE_LIMIT_TTL_SECONDS * 1000, limit: config.env.RATE_LIMIT_MAX }],
      }),
    }),
    EventEmitterModule.forRoot({ wildcard: false, ignoreErrors: false }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    CryptoModule,
    InfraModule,
    TenantsModule,
    AuditModule,
    AccessModule,
    NotificationsModule,
    UsersModule,
    PrivacyModule,
    PartnersModule,
    CustomersModule,
    SegmentsModule,
    CompaniesModule,
    DriversModule,
    AuthModule,
    AdminModule,
    ContactModule,
    RealtimeModule,
    MarketplaceModule,
    LogisticsModule,
    FinanceModule,
    ChatModule,
    SupportModule,
    OperationsModule,
    BroadcastsModule,
    B2bModule,
    IntelligenceModule,
    SaasModule,
    CitiesModule,
    TenantsAdminModule,
    CompanyBrandModule,
    PublicApiModule,
    GrowthModule,
  ],
  controllers: [ObservabilityController, PublicFilesController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: CompanyAccessGuard },
    { provide: APP_GUARD, useClass: PlanFeatureGuard },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('*path');
  }
}
