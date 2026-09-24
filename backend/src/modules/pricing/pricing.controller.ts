import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Allow, ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { PricingService } from './pricing.service';
import { SettingsService } from '../settings/settings.service';
import { PricingTarget, VehicleType } from '../../generated/prisma/enums';
import { Prisma } from '../../generated/prisma/client';

class TimeWindowDto {
  @ApiProperty({ type: [Number] }) @IsArray() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) weekdays!: number[];
  @ApiProperty({ example: '18:00' }) @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) from!: string;
  @ApiProperty({ example: '22:00' }) @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) to!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(20_000) surchargeBps!: number;
}

class PricingRuleDto {
  @ApiProperty() @IsString() @Length(2, 80) name!: string;
  @ApiProperty({ enum: PricingTarget }) @IsEnum(PricingTarget) target!: PricingTarget;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) priority?: number;
  @ApiPropertyOptional({ enum: VehicleType }) @IsOptional() @IsEnum(VehicleType) vehicleType?: VehicleType | null;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 2) state?: string | null;
  @ApiProperty() @IsInt() @Min(0) @Max(1_000_000) baseCents!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) perKmCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) includedKm?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) perMinuteCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) perKgCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1000) includedKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000) minimumCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000_000) maximumCents?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(20_000) nightSurchargeBps?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(20_000) rainSurchargeBps?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(30_000) demandSurchargeMaxBps?: number;
  @ApiPropertyOptional({ type: [TimeWindowDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TimeWindowDto)
  timeWindows?: TimeWindowDto[];
}

class UpdatePricingRuleDto extends PartialType(PricingRuleDto) {}

class SimulateDto {
  @ApiProperty({ enum: PricingTarget }) @IsEnum(PricingTarget) target!: PricingTarget;
  @ApiProperty() @IsNumber() @Min(0) @Max(500) distanceKm!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(1000) durationMin!: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) weightKg?: number;
  @ApiPropertyOptional({ enum: VehicleType }) @IsOptional() @IsEnum(VehicleType) vehicleType?: VehicleType;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() state?: string;
}

class SettingValueDto {
  /** Validado pelo schema Zod de cada configuração (SettingsService). */
  @ApiProperty({ description: 'Valor conforme o schema da configuração' }) @Allow() value!: unknown;
}

@ApiTags('Admin • Precificação e configurações')
@ApiBearerAuth()
@Controller('admin')
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
  ) {}

  @Get('pricing-rules')
  @RequirePermissions('pricing.read')
  list(@CurrentUser() user: AuthUser) {
    return this.pricing.list(user.tenantId);
  }

  @Post('pricing-rules')
  @RequirePermissions('pricing.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: PricingRuleDto) {
    return this.pricing.create(user.tenantId, { ...dto, timeWindows: (dto.timeWindows ?? undefined) as Prisma.InputJsonValue | undefined });
  }

  @Patch('pricing-rules/:id')
  @RequirePermissions('pricing.manage')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePricingRuleDto) {
    return this.pricing.update(user.tenantId, id, { ...dto, timeWindows: (dto.timeWindows ?? undefined) as Prisma.InputJsonValue | undefined });
  }

  @Post('pricing-rules/simulate')
  @RequirePermissions('pricing.read')
  @ApiOperation({ summary: 'Simular o cálculo com as regras ativas' })
  simulate(@CurrentUser() user: AuthUser, @Body() dto: SimulateDto) {
    return this.pricing.quote({ tenantId: user.tenantId, ...dto });
  }

  @Get('settings')
  @RequirePermissions('settings.manage')
  settingsList(@CurrentUser() user: AuthUser) {
    return this.settings.list(user.tenantId);
  }

  @Put('settings/:key')
  @RequirePermissions('settings.manage')
  setSetting(@CurrentUser() user: AuthUser, @Param('key') key: string, @Body() dto: SettingValueDto) {
    return this.settings.set(user.tenantId, key, dto.value, user.userId);
  }
}
