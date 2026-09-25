import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, NotEquals } from 'class-validator';
import { CompanyPermission, CurrentUser, Public, RequireFeature, RequirePermissions } from '../../common/decorators';
import { TenantId } from '../../common/tenant.decorator';
import type { AuthUser } from '../../common/auth/auth-user';
import { PaginationQueryDto } from '../../common/pagination';
import { StoresQueryDto } from '../catalog/catalog.dto';
import { ReferralProgram, ReferralStatus } from '../../generated/prisma/enums';
import { CustomerHomeService } from './customer-home.service';
import { LoyaltyService } from './loyalty.service';
import { ReferralsService } from './referrals.service';
import { FleetService } from './fleet.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class RedeemDto {
  @ApiProperty({ description: 'Pontos a converter em saldo na carteira' }) @Type(() => Number) @IsInt() @Min(1) @Max(10_000_000) points!: number;
}

class AdjustPointsDto {
  @ApiProperty({ description: 'Positivo = crédito, negativo = débito' }) @Type(() => Number) @IsInt() @NotEquals(0) @Min(-1_000_000) @Max(1_000_000) points!: number;
  @ApiProperty() @Transform(trim) @IsString() @Length(5, 200) reason!: string;
}

class LoyaltyAccountsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-z0-9-]{2,20}$/) tier?: string;
}

class ReferralValidateQueryDto {
  @ApiProperty() @IsString() @Length(3, 20) code!: string;
  @ApiPropertyOptional({ enum: ReferralProgram, default: 'CUSTOMER' }) @IsOptional() @IsEnum(ReferralProgram) program?: ReferralProgram;
}

class MyReferralQueryDto {
  @ApiPropertyOptional({ enum: ReferralProgram, description: 'Programa exibido (padrão: pelo perfil do app)' }) @IsOptional() @IsEnum(ReferralProgram) program?: ReferralProgram;
}

class ReferralsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReferralStatus }) @IsOptional() @IsEnum(ReferralStatus) status?: ReferralStatus;
  @ApiPropertyOptional({ enum: ReferralProgram }) @IsOptional() @IsEnum(ReferralProgram) program?: ReferralProgram;
}

class NoteDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 300) note!: string;
}

class ReasonDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 300) reason!: string;
}

class FleetInviteDto {
  @ApiProperty({ description: 'E-mail ou celular do cadastro do entregador' }) @Transform(trim) @IsString() @Length(5, 254) login!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) message?: string;
}

class FleetResponseDto {
  @ApiProperty({ enum: ['accept', 'decline'] }) @IsIn(['accept', 'decline']) action!: 'accept' | 'decline';
}

// -----------------------------------------------------------------------------
// Cliente
// -----------------------------------------------------------------------------

@ApiTags('Cliente • Home, favoritos e cupons')
@ApiBearerAuth()
@Controller('me')
export class CustomerHomeController {
  constructor(
    private readonly home: CustomerHomeService,
    private readonly loyalty: LoyaltyService,
  ) {}

  @Get('home')
  @ApiOperation({ summary: 'Home: favoritas, promoções, cupons, pedidos recentes, fidelidade e indicação' })
  view(@CurrentUser() user: AuthUser, @Query() query: StoresQueryDto) {
    return this.home.home(user, query);
  }

  @Get('favorites')
  @ApiOperation({ summary: 'Lojas favoritas (com distância/tempo para o endereço informado)' })
  favorites(@CurrentUser() user: AuthUser, @Query() query: StoresQueryDto) {
    return this.home.favorites(user, query);
  }

  @Get('favorites/ids')
  favoriteIds(@CurrentUser() user: AuthUser) {
    return this.home.favoriteIds(user);
  }

  @Put('favorites/:companyId')
  @HttpCode(204)
  async addFavorite(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    await this.home.addFavorite(user, companyId);
  }

  @Delete('favorites/:companyId')
  @HttpCode(204)
  async removeFavorite(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    await this.home.removeFavorite(user, companyId);
  }

  @Get('coupons')
  @ApiOperation({ summary: 'Cupons disponíveis para o cliente (públicos e exclusivos do nível de fidelidade)' })
  coupons(@CurrentUser() user: AuthUser) {
    return this.home.coupons(user);
  }

  @Get('recent-orders')
  recentOrders(@CurrentUser() user: AuthUser) {
    return this.home.recentOrders(user, 10);
  }

  @Post('orders/:orderId/reorder')
  @HttpCode(200)
  @RequirePermissions('customer.orders.create')
  @ApiOperation({ summary: 'Pedir de novo: coloca no carrinho os itens ainda disponíveis' })
  reorder(@CurrentUser() user: AuthUser, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.home.reorder(user, orderId);
  }

  @Get('loyalty')
  @ApiOperation({ summary: 'Fidelidade: saldo, nível, próximo nível, valor do resgate e extrato recente' })
  loyaltySummary(@CurrentUser() user: AuthUser) {
    return this.loyalty.summary(user);
  }

  @Get('loyalty/transactions')
  loyaltyHistory(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.loyalty.history(user, query);
  }

  @Post('loyalty/redeem')
  @HttpCode(200)
  @ApiOperation({ summary: 'Converter pontos em saldo na carteira' })
  redeem(@CurrentUser() user: AuthUser, @Body() dto: RedeemDto) {
    return this.loyalty.redeem(user, dto.points);
  }
}

// -----------------------------------------------------------------------------
// Indicação (qualquer perfil)
// -----------------------------------------------------------------------------

@ApiTags('Indique e ganhe')
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Public()
  @Get('validate')
  @ApiOperation({ summary: 'Confere um código de indicação no cadastro (não revela quem indicou)' })
  validate(@TenantId() tenantId: string, @Query() query: ReferralValidateQueryDto) {
    return this.referrals.validate(tenantId, query.code, query.program ?? 'CUSTOMER');
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Meu código, recompensas do programa e minhas indicações' })
  mine(@CurrentUser() user: AuthUser, @Query() query: MyReferralQueryDto) {
    const program = query.program ?? (user.driverId && !user.customerId ? 'DRIVER' : user.companies.length && !user.customerId ? 'COMPANY' : 'CUSTOMER');
    return this.referrals.mine(user, program);
  }
}

// -----------------------------------------------------------------------------
// Frota própria
// -----------------------------------------------------------------------------

@ApiTags('Empresas • Frota própria')
@ApiBearerAuth()
@RequireFeature('own_fleet')
@Controller('companies/:companyId/fleet')
export class CompanyFleetController {
  constructor(private readonly fleet: FleetService) {}

  @Get()
  @CompanyPermission('company.fleet.manage', 'drivers.read')
  @ApiOperation({ summary: 'Entregadores da frota própria e convites' })
  view(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.fleet.companyView(user.tenantId, companyId);
  }

  @Post('invitations')
  @CompanyPermission('company.fleet.manage')
  @ApiOperation({ summary: 'Convidar entregador (e-mail ou celular do cadastro dele)' })
  invite(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: FleetInviteDto) {
    return this.fleet.invite(user, companyId, dto);
  }

  @Post('invitations/:id/cancel')
  @HttpCode(204)
  @CompanyPermission('company.fleet.manage')
  async cancel(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.fleet.cancelInvitation(user, companyId, id);
  }

  @Delete('drivers/:driverId')
  @HttpCode(204)
  @CompanyPermission('company.fleet.manage')
  async remove(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Param('driverId', ParseUUIDPipe) driverId: string) {
    await this.fleet.removeDriver(user, companyId, driverId);
  }
}

@ApiTags('Entregador • Frota própria')
@ApiBearerAuth()
@Controller('drivers/me/fleet')
export class DriverFleetController {
  constructor(private readonly fleet: FleetService) {}

  @Get()
  @ApiOperation({ summary: 'Empresa da minha frota e convites pendentes' })
  view(@CurrentUser() user: AuthUser) {
    return this.fleet.driverView(user);
  }

  @Post('invitations/:id')
  @HttpCode(200)
  respond(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FleetResponseDto) {
    return this.fleet.respond(user, id, dto.action === 'accept');
  }

  @Post('leave')
  @HttpCode(200)
  leave(@CurrentUser() user: AuthUser) {
    return this.fleet.leave(user);
  }
}

// -----------------------------------------------------------------------------
// Painel
// -----------------------------------------------------------------------------

@ApiTags('Admin • Fidelidade e indicação')
@ApiBearerAuth()
@Controller('admin/growth')
export class AdminGrowthController {
  constructor(
    private readonly loyalty: LoyaltyService,
    private readonly referrals: ReferralsService,
  ) {}

  @Get('loyalty')
  @RequirePermissions('coupons.manage')
  @ApiOperation({ summary: 'Fidelidade: clientes por nível, pontos em circulação (passivo) e movimento em 30 dias' })
  loyaltyOverview(@CurrentUser() user: AuthUser) {
    return this.loyalty.overview(user.tenantId);
  }

  @Get('loyalty/accounts')
  @RequirePermissions('coupons.manage')
  loyaltyAccounts(@CurrentUser() user: AuthUser, @Query() query: LoyaltyAccountsQueryDto) {
    return this.loyalty.accounts(user.tenantId, query);
  }

  @Get('loyalty/accounts/:customerId/transactions')
  @RequirePermissions('coupons.manage')
  loyaltyHistory(@CurrentUser() user: AuthUser, @Param('customerId', ParseUUIDPipe) customerId: string, @Query() query: PaginationQueryDto) {
    return this.loyalty.customerHistory(user.tenantId, customerId, query);
  }

  @Post('loyalty/accounts/:customerId/adjust')
  @RequirePermissions('coupons.manage')
  adjust(@CurrentUser() user: AuthUser, @Param('customerId', ParseUUIDPipe) customerId: string, @Body() dto: AdjustPointsDto) {
    return this.loyalty.adjust(user, customerId, dto.points, dto.reason);
  }

  @Post('loyalty/run')
  @RequirePermissions('coupons.manage')
  @ApiOperation({ summary: 'Executar agora a expiração de saldos e a revisão de níveis (roda todo dia)' })
  runLoyalty() {
    return this.loyalty.daily();
  }

  @Get('referrals')
  @RequirePermissions('coupons.manage')
  referralsOverview(@CurrentUser() user: AuthUser) {
    return this.referrals.overview(user.tenantId);
  }

  @Get('referrals/list')
  @RequirePermissions('coupons.manage')
  listReferrals(@CurrentUser() user: AuthUser, @Query() query: ReferralsQueryDto) {
    return this.referrals.list(user.tenantId, query);
  }

  @Post('referrals/:id/approve')
  @RequirePermissions('coupons.manage')
  @ApiOperation({ summary: 'Liberar a recompensa (indicação retida pelo antifraude ou conferida manualmente)' })
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.referrals.approve(user, id, dto.note);
  }

  @Post('referrals/:id/reject')
  @RequirePermissions('coupons.manage')
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.referrals.reject(user, id, dto.reason);
  }
}
