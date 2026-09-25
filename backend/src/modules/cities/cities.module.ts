import { Body, Controller, Get, Global, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsIn, IsLatitude, IsLongitude, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { TenantId } from '../../common/tenant.decorator';
import type { AuthUser } from '../../common/auth/auth-user';
import { CityStatus } from '../../generated/prisma/enums';
import { CitiesService } from './cities.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const limit = (per: number) => ({ default: { limit: () => (process.env.NODE_ENV === 'test' ? 10_000 : per), ttl: 60_000 } });

class CityDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 80) name!: string;
  @ApiProperty({ example: 'SP' }) @Transform(trim) @IsString() @Length(2, 2) state!: string;
  @ApiPropertyOptional({ enum: CityStatus }) @IsOptional() @IsEnum(CityStatus) status?: CityStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) timeZone?: string;
  @ApiPropertyOptional() @IsOptional() @IsLatitude() centerLat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() centerLng?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) message?: string;
}

class UpdateCityDto {
  @ApiPropertyOptional({ enum: CityStatus }) @IsOptional() @IsEnum(CityStatus) status?: CityStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) timeZone?: string;
  @ApiPropertyOptional() @IsOptional() @IsLatitude() centerLat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() centerLng?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) message?: string;
}

class CityCheckQueryDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 80) city!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 2) state!: string;
}

class WaitlistDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 80) city!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 2) state!: string;
  @ApiProperty() @Transform(trim) @IsEmail() @MaxLength(254) email!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(120) name?: string;
  @ApiProperty({ enum: ['CUSTOMER', 'COMPANY', 'DRIVER'] }) @IsIn(['CUSTOMER', 'COMPANY', 'DRIVER']) profile!: 'CUSTOMER' | 'COMPANY' | 'DRIVER';
}

@ApiTags('Cidades')
@Controller('cities')
export class CitiesController {
  constructor(private readonly cities: CitiesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Cidades atendidas e em preparação (página "onde atendemos")' })
  list(@TenantId() tenantId: string) {
    return this.cities.publicList(tenantId);
  }

  @Public()
  @Get('check')
  @ApiOperation({ summary: 'A plataforma opera nesta cidade?' })
  async check(@TenantId() tenantId: string, @Query() query: CityCheckQueryDto) {
    const gate = await this.cities.gate(tenantId, query.city, query.state);
    return gate.operating ? { operating: true } : { operating: false, message: gate.reason };
  }

  @Public()
  @Post('waitlist')
  @Throttle(limit(10))
  @ApiOperation({ summary: '"Avise-me quando chegar": lista de espera da cidade' })
  join(@TenantId() tenantId: string, @Body() dto: WaitlistDto, @CurrentUser() user?: AuthUser) {
    return this.cities.joinWaitlist(tenantId, dto, user?.userId);
  }
}

@ApiTags('Admin • Cidades')
@ApiBearerAuth()
@Controller('admin/cities')
export class AdminCitiesController {
  constructor(private readonly cities: CitiesService) {}

  @Get()
  @RequirePermissions('operations.view')
  @ApiOperation({ summary: 'Cidades com indicadores de 30 dias e cidades com movimento ainda sem cadastro' })
  list(@CurrentUser() user: AuthUser) {
    return this.cities.list(user.tenantId);
  }

  @Post()
  @RequirePermissions('service_areas.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CityDto) {
    return this.cities.create(user.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermissions('service_areas.manage')
  @ApiOperation({ summary: 'Alterar a cidade (ativar avisa a lista de espera; pausar recusa novos pedidos e entregas)' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCityDto) {
    return this.cities.update(user.tenantId, id, dto);
  }

  @Get(':id/waitlist')
  @RequirePermissions('operations.view')
  waitlist(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cities.waitlist(user.tenantId, id);
  }
}

/** Multi-cidade: cadastro de cidades, status de operação, lista de espera e indicadores. */
@Global()
@Module({
  controllers: [CitiesController, AdminCitiesController],
  providers: [CitiesService],
  exports: [CitiesService],
})
export class CitiesModule {}

