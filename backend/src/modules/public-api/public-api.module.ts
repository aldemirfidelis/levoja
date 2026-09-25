import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { WEBHOOK_EVENTS, type WebhookEvent } from '@levoja/shared';
import { CompanyPermission, CurrentUser, RequireFeature } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { utcTimestamp } from '../../common/sql';
import { WebhooksService } from './webhooks.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class WebhookEndpointDto {
  @ApiProperty({ example: 'https://minhaloja.com.br/webhooks/levoja' }) @Transform(trim) @IsString() @MaxLength(500) url!: string;
  @ApiProperty({ enum: WEBHOOK_EVENTS, isArray: true }) @IsArray() @ArrayMinSize(1) @IsIn(WEBHOOK_EVENTS, { each: true }) events!: WebhookEvent[];
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(120) description?: string;
}

class UpdateWebhookEndpointDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) url?: string;
  @ApiPropertyOptional({ enum: WEBHOOK_EVENTS, isArray: true }) @IsOptional() @IsArray() @ArrayMinSize(1) @IsIn(WEBHOOK_EVENTS, { each: true }) events?: WebhookEvent[];
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(120) description?: string;
  @ApiPropertyOptional({ description: 'Reativar zera o contador de falhas' }) @IsOptional() @IsBoolean() isActive?: boolean;
}

/** Uso da API pública por empresa (painel de integração). */
@Injectable()
export class ApiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async usage(companyId: string) {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [daily, byKey, recent, keys] = await Promise.all([
      this.prisma.$queryRaw<{ day: string; total: number; errors: number }[]>`
        SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS day, count(*)::int AS total,
               (count(*) FILTER (WHERE status >= 400))::int AS errors
        FROM api_request_logs WHERE "companyId" = ${companyId}::uuid AND "createdAt" >= ${utcTimestamp(since)}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.apiRequestLog.groupBy({ by: ['apiKeyId'], where: { companyId, createdAt: { gte: since } }, _count: { _all: true }, _avg: { durationMs: true } }),
      this.prisma.apiRequestLog.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.companyApiKey.findMany({ where: { companyId }, select: { id: true, name: true, prefix: true } }),
    ]);
    const keyName = new Map(keys.map((key) => [key.id, `${key.name} (${key.prefix}…)`]));
    return {
      daily,
      byKey: byKey.map((row) => ({ apiKeyId: row.apiKeyId, name: keyName.get(row.apiKeyId) ?? 'Chave removida', calls: row._count._all, avgMs: Math.round(row._avg.durationMs ?? 0) })),
      recent: recent.map((row) => ({ ...row, keyName: keyName.get(row.apiKeyId) ?? null })),
    };
  }
}

@ApiTags('Empresas • Integração (webhooks e uso da API)')
@ApiBearerAuth()
@RequireFeature('integrations')
@Controller('companies/:companyId')
export class CompanyIntegrationController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly usage: ApiUsageService,
  ) {}

  @Get('webhooks')
  @CompanyPermission('company.b2b.manage', 'companies.read')
  list(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.webhooks.list(companyId);
  }

  @Post('webhooks')
  @CompanyPermission('company.b2b.manage')
  @ApiOperation({ summary: 'Cadastrar endpoint (o segredo de assinatura é exibido uma única vez)' })
  create(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: WebhookEndpointDto) {
    return this.webhooks.create(user, companyId, dto);
  }

  @Patch('webhooks/:id')
  @CompanyPermission('company.b2b.manage')
  update(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWebhookEndpointDto) {
    return this.webhooks.update(companyId, id, dto);
  }

  @Post('webhooks/:id/rotate-secret')
  @CompanyPermission('company.b2b.manage')
  rotate(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.rotateSecret(companyId, id);
  }

  @Delete('webhooks/:id')
  @HttpCode(204)
  @CompanyPermission('company.b2b.manage')
  async remove(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.webhooks.remove(companyId, id);
  }

  @Post('webhooks/:id/test')
  @HttpCode(200)
  @CompanyPermission('company.b2b.manage')
  @ApiOperation({ summary: 'Enviar um evento de teste (ping) e ver a resposta' })
  test(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.test(companyId, id);
  }

  @Get('webhooks/:id/deliveries')
  @CompanyPermission('company.b2b.manage', 'companies.read')
  deliveries(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.deliveries(companyId, id);
  }

  @Post('webhook-deliveries/:deliveryId/retry')
  @HttpCode(200)
  @CompanyPermission('company.b2b.manage')
  retry(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('deliveryId', ParseUUIDPipe) deliveryId: string) {
    return this.webhooks.retry(companyId, deliveryId);
  }

  @Get('api-usage')
  @CompanyPermission('company.b2b.manage', 'companies.read')
  @ApiOperation({ summary: 'Chamadas à API pública nos últimos 7 dias (por dia, por chave e as mais recentes)' })
  apiUsage(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.usage.usage(companyId);
  }
}

/** API pública: webhooks assinados, registro de uso das chaves e painel de integração. */
@Module({
  controllers: [CompanyIntegrationController],
  providers: [WebhooksService, ApiUsageService],
  exports: [WebhooksService],
})
export class PublicApiModule {}
