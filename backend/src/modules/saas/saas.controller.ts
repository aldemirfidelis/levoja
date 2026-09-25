import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { PLAN_FEATURES } from '@levoja/shared';
import { CompanyPermission, CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { TenantId } from '../../common/tenant.decorator';
import type { AuthUser } from '../../common/auth/auth-user';
import { PaginationQueryDto } from '../../common/pagination';
import { SubscriptionStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { planLimits, SubscriptionsService } from './subscriptions.service';
import { PlansService } from './plans.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class PlanDto {
  @ApiProperty({ example: 'profissional' }) @Transform(trim) @IsString() @Matches(/^[a-z0-9-]{2,40}$/, { message: 'Chave: letras minúsculas, números e hífen.' }) key!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 60) name!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) description?: string;
  @ApiProperty({ description: 'Mensalidade em centavos' }) @Type(() => Number) @IsInt() @Min(0) @Max(10_000_000) priceCents!: number;
  @ApiProperty({ enum: PLAN_FEATURES, isArray: true }) @IsIn(PLAN_FEATURES, { each: true }) features!: string[];
  @ApiProperty({ description: '{ maxProducts, maxUsers, maxApiKeys, maxLocations, apiRequestsPerMinute } — null = sem limite' }) @IsObject() limits!: Record<string, number | null>;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(90) trialDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublic?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

class UpdatePlanDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 60) name?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) description?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000_000) priceCents?: number;
  @ApiPropertyOptional({ enum: PLAN_FEATURES, isArray: true }) @IsOptional() @IsIn(PLAN_FEATURES, { each: true }) features?: string[];
  @ApiPropertyOptional() @IsOptional() @IsObject() limits?: Record<string, number | null>;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(90) trialDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublic?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

class ChoosePlanDto {
  @ApiProperty() @IsString() @Matches(/^[a-z0-9-]{2,40}$/) planKey!: string;
  @ApiPropertyOptional({ description: 'Equipe: aplicar a troca na hora (inclusive para plano menor)' }) @IsOptional() @IsBoolean() immediate?: boolean;
}

class SubscriptionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SubscriptionStatus }) @IsOptional() @IsEnum(SubscriptionStatus) status?: SubscriptionStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() planId?: string;
}

class InvoicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'PAID', 'VOID'] }) @IsOptional() @IsIn(['OPEN', 'PAID', 'VOID']) status?: 'OPEN' | 'PAID' | 'VOID';
}

class VoidInvoiceDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 300) reason!: string;
}

@ApiTags('Planos (público)')
@Controller('plans')
export class PublicPlansController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Planos disponíveis para empresas (página de preços)' })
  async list(@TenantId() tenantId: string) {
    const plans = await this.prisma.plan.findMany({ where: { tenantId, isActive: true, isPublic: true }, orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }] });
    return plans.map((plan) => ({ key: plan.key, name: plan.name, description: plan.description, priceCents: plan.priceCents, features: plan.features, limits: planLimits(plan.limits), trialDays: plan.trialDays }));
  }
}

@ApiTags('Admin • Planos SaaS')
@ApiBearerAuth()
@Controller('admin/saas')
export class AdminSaasController {
  constructor(
    private readonly plans: PlansService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  @Get('plans')
  @RequirePermissions('plans.manage')
  listPlans(@CurrentUser() user: AuthUser) {
    return this.plans.list(user.tenantId);
  }

  @Post('plans')
  @RequirePermissions('plans.manage')
  createPlan(@CurrentUser() user: AuthUser, @Body() dto: PlanDto) {
    return this.plans.create(user.tenantId, dto);
  }

  @Patch('plans/:id')
  @RequirePermissions('plans.manage')
  updatePlan(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto) {
    return this.plans.update(user.tenantId, id, dto);
  }

  @Get('subscriptions')
  @RequirePermissions('plans.manage')
  @ApiOperation({ summary: 'Assinaturas das empresas, com receita recorrente mensal (MRR)' })
  listSubscriptions(@CurrentUser() user: AuthUser, @Query() query: SubscriptionsQueryDto) {
    return this.subscriptions.list(user.tenantId, query);
  }

  @Get('invoices')
  @RequirePermissions('plans.manage')
  listInvoices(@CurrentUser() user: AuthUser, @Query() query: InvoicesQueryDto) {
    return this.subscriptions.invoices(user.tenantId, query);
  }

  @Get('companies/:companyId')
  @RequirePermissions('plans.manage')
  companySubscription(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.subscriptions.companyView(user.tenantId, companyId);
  }

  @Post('companies/:companyId/plan')
  @RequirePermissions('plans.manage')
  @ApiOperation({ summary: 'Contratar/trocar o plano de uma empresa (pode aplicar na hora e usar planos não públicos)' })
  choose(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: ChoosePlanDto) {
    return this.subscriptions.choose(user, companyId, dto.planKey, { immediate: dto.immediate });
  }

  @Post('companies/:companyId/cancel')
  @RequirePermissions('plans.manage')
  cancel(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.subscriptions.cancel(user, companyId);
  }

  @Post('invoices/:id/void')
  @HttpCode(204)
  @RequirePermissions('plans.manage')
  async voidInvoice(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidInvoiceDto) {
    await this.subscriptions.voidInvoice(user, id, dto.reason);
  }

  @Post('billing/run')
  @RequirePermissions('plans.manage')
  @ApiOperation({ summary: 'Executar agora a renovação e a conferência de pagamentos (roda a cada hora)' })
  run() {
    return this.subscriptions.billingCycle();
  }
}

@ApiTags('Empresas • Plano')
@ApiBearerAuth()
@Controller('companies/:companyId/subscription')
export class CompanySubscriptionController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @CompanyPermission('company.profile.manage', 'companies.read')
  @ApiOperation({ summary: 'Plano atual, uso dos limites, cobranças e planos disponíveis' })
  view(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.subscriptions.companyView(user.tenantId, companyId);
  }

  @Post()
  @HttpCode(200)
  @CompanyPermission('company.subscription.manage', 'plans.manage')
  @ApiOperation({ summary: 'Contratar ou trocar de plano (upgrade na hora com cobrança proporcional; downgrade no fim do período)' })
  choose(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: ChoosePlanDto) {
    return this.subscriptions.choose(user, companyId, dto.planKey);
  }

  @Post('cancel')
  @HttpCode(200)
  @CompanyPermission('company.subscription.manage', 'plans.manage')
  cancel(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.subscriptions.cancel(user, companyId);
  }

  @Post('resume')
  @HttpCode(200)
  @CompanyPermission('company.subscription.manage', 'plans.manage')
  resume(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.subscriptions.resume(user, companyId);
  }
}
