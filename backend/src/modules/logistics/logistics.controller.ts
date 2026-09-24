import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { REVIEW_THEMES } from '@levoja/shared';
import { AllowApiKey, CompanyPermission, CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { PaginationQueryDto } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { UploadedFileLike, validateUpload } from '../../infra/storage/file-validation';
import { IMAGE_UPLOAD } from '../users/users.controller';
import { DeliveriesService } from './deliveries.service';
import { DispatchService } from './dispatch.service';
import { TrackingService } from './tracking.service';
import { ReviewsService } from './reviews.service';
import {
  AssignDriverDto,
  AvailabilityDto,
  CancelDeliveryDto,
  CreateDeliveryDto,
  DeclineOfferDto,
  DeliverDto,
  DeliveriesQueryDto,
  DeliveryQuoteDto,
  FailDeliveryDto,
  LocationBatchDto,
  LocationPointDto,
  OrderReviewDto,
  ReviewInputDto,
} from './deliveries.dto';

const FAIL_REASONS: Record<string, string> = {
  RECIPIENT_ABSENT: 'Destinatário ausente',
  WRONG_ADDRESS: 'Endereço incorreto',
  REFUSED: 'Recebimento recusado',
  DAMAGED: 'Item avariado',
  UNSAFE_LOCATION: 'Local inseguro',
  OTHER: 'Outro motivo',
};

const REQUESTER_CANCELABLE = ['PENDING', 'SCHEDULED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'AT_PICKUP'];

class DriverReviewDto {
  @ApiPropertyOptional({ type: ReviewInputDto }) @IsOptional() @ValidateNested() @Type(() => ReviewInputDto) customer?: ReviewInputDto;
  @ApiPropertyOptional({ type: ReviewInputDto }) @IsOptional() @ValidateNested() @Type(() => ReviewInputDto) company?: ReviewInputDto;
}

class TrackingQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() since?: string;
}

class ReviewsAdminQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) maxRating?: number;
  @ApiPropertyOptional({ enum: ['POSITIVE', 'NEUTRAL', 'NEGATIVE'] }) @IsOptional() @IsIn(['POSITIVE', 'NEUTRAL', 'NEGATIVE']) sentiment?: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  @ApiPropertyOptional({ enum: REVIEW_THEMES }) @IsOptional() @IsIn(REVIEW_THEMES) theme?: string;
}

class HideReviewDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

// -----------------------------------------------------------------------------
// App do entregador
// -----------------------------------------------------------------------------

@ApiTags('Entregador (operação)')
@ApiBearerAuth()
@Controller('drivers/me')
@RequirePermissions('driver.deliveries.work')
export class DriverOperationsController {
  constructor(
    private readonly tracking: TrackingService,
    private readonly dispatch: DispatchService,
    private readonly deliveries: DeliveriesService,
    private readonly reviews: ReviewsService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Status, ganhos (dia/semana/mês), entregas, avaliação e taxas' })
  dashboard(@CurrentUser() user: AuthUser) {
    return this.tracking.dashboard(user);
  }

  @Post('availability')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ficar online (entra na fila de disponibilidade) ou offline' })
  availability(@CurrentUser() user: AuthUser, @Body() dto: AvailabilityDto) {
    return this.tracking.setAvailability(user, dto.online, dto.lat != null && dto.lng != null ? { lat: dto.lat, lng: dto.lng } : undefined);
  }

  @Post('location')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  location(@CurrentUser() user: AuthUser, @Body() dto: LocationPointDto) {
    return this.tracking.updateLocation(user, [dto]);
  }

  @Post('locations')
  @HttpCode(200)
  @ApiOperation({ summary: 'Envio em lote (sincronização após perda de conexão)' })
  locations(@CurrentUser() user: AuthUser, @Body() dto: LocationBatchDto) {
    return this.tracking.updateLocation(user, dto.points);
  }

  @Get('offers')
  @ApiOperation({ summary: 'Ofertas pendentes (com contador regressivo)' })
  offers(@CurrentUser() user: AuthUser) {
    return this.dispatch.currentOffers(user);
  }

  @Post('offers/:id/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.dispatch.accept(user, id);
  }

  @Post('offers/:id/decline')
  @HttpCode(204)
  async decline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeclineOfferDto) {
    await this.dispatch.decline(user, id, dto.reason);
  }

  @Get('route')
  @ApiOperation({ summary: 'Entregas ativas e paradas na ordem recomendada' })
  route(@CurrentUser() user: AuthUser) {
    return this.tracking.activeRoute(user);
  }

  @Get('deliveries')
  history(@CurrentUser() user: AuthUser, @Query() query: DeliveriesQueryDto) {
    return this.deliveries.listForDriver(user, query);
  }

  @Get('deliveries/:id')
  @ApiOperation({ summary: 'Detalhe de uma entrega do entregador (endereços completos após o aceite)' })
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.deliveries.getForDriver(user, id);
  }

  @Post('deliveries/:id/arrived-pickup')
  @HttpCode(204)
  async arrivedPickup(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.deliveries.findForDriver(user, id);
    await this.deliveries.transition(id, 'AT_PICKUP', { type: 'DRIVER', id: user.userId }, { expectedFrom: ['DRIVER_ASSIGNED'] });
  }

  @Post('deliveries/:id/picked-up')
  @HttpCode(204)
  @ApiOperation({ summary: 'Confirmar a coleta' })
  async pickedUp(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.deliveries.findForDriver(user, id);
    await this.deliveries.transition(id, 'PICKED_UP', { type: 'DRIVER', id: user.userId }, { expectedFrom: ['DRIVER_ASSIGNED', 'AT_PICKUP'] });
  }

  @Post('deliveries/:id/start-route')
  @HttpCode(204)
  @ApiOperation({ summary: 'Iniciar rota até o destino' })
  async startRoute(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.deliveries.findForDriver(user, id);
    await this.deliveries.transition(id, 'IN_TRANSIT', { type: 'DRIVER', id: user.userId }, { expectedFrom: ['PICKED_UP'] });
  }

  @Post('deliveries/:id/arrived-dropoff')
  @HttpCode(204)
  async arrivedDropoff(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const delivery = await this.deliveries.findForDriver(user, id);
    if (delivery.status === 'PICKED_UP') await this.deliveries.transition(id, 'IN_TRANSIT', { type: 'DRIVER', id: user.userId });
    await this.deliveries.transition(id, 'AT_DROPOFF', { type: 'DRIVER', id: user.userId }, { expectedFrom: ['PICKED_UP', 'IN_TRANSIT'] });
  }

  @Post('deliveries/:id/deliver')
  @HttpCode(200)
  @UseInterceptors(IMAGE_UPLOAD)
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiOperation({ summary: 'Concluir com prova de entrega (código, QR code, foto ou assinatura)' })
  async deliver(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeliverDto, @UploadedFile() file?: UploadedFileLike) {
    const upload = file ? { buffer: file.buffer, ...validateUpload(file, 'image') } : undefined;
    const delivery = await this.deliveries.deliver(user, id, dto, upload);
    return { id: delivery.id, status: delivery.status, deliveredAt: delivery.deliveredAt };
  }

  @Post('deliveries/:id/fail')
  @HttpCode(204)
  @ApiOperation({ summary: 'Registrar entrega não realizada (após a coleta)' })
  async fail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FailDeliveryDto) {
    await this.deliveries.findForDriver(user, id);
    const reason = `${FAIL_REASONS[dto.reasonCode]}${dto.details ? `: ${dto.details}` : ''}`;
    await this.deliveries.transition(id, 'FAILED', { type: 'DRIVER', id: user.userId }, { reason, expectedFrom: ['PICKED_UP', 'IN_TRANSIT', 'AT_DROPOFF'] });
  }

  @Post('deliveries/:id/release')
  @HttpCode(204)
  @ApiOperation({ summary: 'Desistir antes da coleta (a entrega volta para a fila)' })
  async release(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDeliveryDto) {
    await this.dispatch.release(user, id, dto.reason);
  }

  @Post('deliveries/:id/review')
  @RequirePermissions('driver.reviews.write')
  review(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DriverReviewDto) {
    return this.reviews.reviewByDriver(user, id, dto);
  }
}

// -----------------------------------------------------------------------------
// Entregas avulsas: cliente
// -----------------------------------------------------------------------------

@ApiTags('Entregas avulsas (cliente)')
@ApiBearerAuth()
@Controller()
export class CustomerDeliveriesController {
  constructor(
    private readonly deliveries: DeliveriesService,
    private readonly reviews: ReviewsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('deliveries/quote')
  @RequirePermissions('customer.deliveries.request')
  @ApiOperation({ summary: 'Cotação: origem, destino, tipo de item, peso, dimensões, veículo e agendamento' })
  quote(@CurrentUser() user: AuthUser, @Body() dto: DeliveryQuoteDto) {
    return this.deliveries.quoteView(user, dto);
  }

  @Post('deliveries')
  @RequirePermissions('customer.deliveries.request')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateDeliveryDto) {
    const delivery = await this.deliveries.createOnDemand(user, dto);
    return this.deliveries.getForRequester(user, delivery.id);
  }

  @Get('deliveries')
  @RequirePermissions('customer.deliveries.request')
  list(@CurrentUser() user: AuthUser, @Query() query: DeliveriesQueryDto) {
    return this.deliveries.listForRequester(user, query);
  }

  @Get('deliveries/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.deliveries.getForRequester(user, id);
  }

  @Get('deliveries/:id/tracking')
  @ApiOperation({ summary: 'Histórico da rota (pontos de GPS)' })
  async tracking(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: TrackingQueryDto) {
    await this.deliveries.getForRequester(user, id);
    return this.deliveries.trackingPoints(id, query.since ? new Date(query.since) : undefined);
  }

  @Post('deliveries/:id/cancel')
  @RequirePermissions('customer.deliveries.request')
  async cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDeliveryDto) {
    const delivery = await this.prisma.delivery.findFirst({ where: { id, requesterUserId: user.userId, kind: 'ON_DEMAND' } });
    if (!delivery) throw new BadRequestException('Entrega não encontrada.');
    if (!REQUESTER_CANCELABLE.includes(delivery.status)) throw new BadRequestException('O item já foi coletado. Fale com o suporte.');
    await this.prisma.deliveryOffer.updateMany({ where: { deliveryId: id, status: 'PENDING' }, data: { status: 'CANCELED' } });
    await this.deliveries.transition(id, 'CANCELED', { type: 'CUSTOMER', id: user.userId }, { reason: dto.reason });
    return this.deliveries.getForRequester(user, id);
  }

  @Post('deliveries/:id/review')
  @RequirePermissions('customer.reviews.write')
  review(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewInputDto) {
    return this.reviews.reviewDeliveryDriver(user, id, dto);
  }

  @Post('orders/:id/review')
  @RequirePermissions('customer.reviews.write')
  @ApiOperation({ summary: 'Avaliar a loja e o entregador de um pedido entregue' })
  reviewOrder(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OrderReviewDto) {
    return this.reviews.reviewOrder(user, id, dto);
  }
}

// -----------------------------------------------------------------------------
// Entregas avulsas: empresa
// -----------------------------------------------------------------------------

@ApiTags('Empresas • Entregas')
@ApiBearerAuth()
@Controller('companies/:companyId/deliveries')
export class CompanyDeliveriesController {
  constructor(
    private readonly deliveries: DeliveriesService,
    private readonly reviews: ReviewsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('quote')
  @AllowApiKey()
  @CompanyPermission('company.deliveries.request')
  quote(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: DeliveryQuoteDto) {
    return this.deliveries.quoteView(user, dto, companyId);
  }

  @Post()
  @AllowApiKey()
  @CompanyPermission('company.deliveries.request')
  @ApiOperation({ summary: 'Solicitar entrega avulsa (coleta padrão: endereço da empresa)' })
  async create(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: CreateDeliveryDto) {
    const delivery = await this.deliveries.createOnDemand(user, dto, companyId);
    return this.deliveries.getForCompany(companyId, delivery.id);
  }

  @Get()
  @AllowApiKey()
  @CompanyPermission('company.orders.read', 'deliveries.read')
  list(@Param('companyId', ParseUUIDPipe) companyId: string, @Query() query: DeliveriesQueryDto) {
    return this.deliveries.listForCompany(companyId, query);
  }

  @Get(':id')
  @AllowApiKey()
  @CompanyPermission('company.orders.read', 'deliveries.read')
  get(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.deliveries.getForCompany(companyId, id);
  }

  @Post(':id/cancel')
  @AllowApiKey()
  @CompanyPermission('company.deliveries.request')
  async cancel(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDeliveryDto) {
    const delivery = await this.prisma.delivery.findFirst({ where: { id, companyId, kind: 'ON_DEMAND' } });
    if (!delivery) throw new BadRequestException('Entrega avulsa não encontrada. Entregas de pedidos são canceladas pelo pedido.');
    if (!REQUESTER_CANCELABLE.includes(delivery.status)) throw new BadRequestException('O item já foi coletado. Fale com o suporte.');
    await this.prisma.deliveryOffer.updateMany({ where: { deliveryId: id, status: 'PENDING' }, data: { status: 'CANCELED' } });
    await this.deliveries.transition(id, 'CANCELED', { type: 'COMPANY', id: user.userId }, { reason: dto.reason });
    return this.deliveries.getForCompany(companyId, id);
  }

  @Post(':id/review')
  @CompanyPermission('company.reviews.write')
  @ApiOperation({ summary: 'Avaliar o entregador' })
  review(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewInputDto) {
    return this.reviews.reviewDeliveryDriver(user, id, dto, companyId);
  }
}

// -----------------------------------------------------------------------------
// Público
// -----------------------------------------------------------------------------

@ApiTags('Rastreamento (público)')
@Controller()
export class PublicTrackingController {
  constructor(
    private readonly deliveries: DeliveriesService,
    private readonly reviews: ReviewsService,
  ) {}

  @Public()
  @Get('track/:code')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rastreamento pelo código da entrega (link para o destinatário)' })
  track(@Param('code') code: string) {
    return this.deliveries.publicTracking(code);
  }

  @Public()
  @Get('stores/:companyId/reviews')
  storeReviews(@Param('companyId', ParseUUIDPipe) companyId: string, @Query() query: PaginationQueryDto) {
    return this.reviews.listForSubject('COMPANY', companyId, query);
  }
}

// -----------------------------------------------------------------------------
// Administração / operação
// -----------------------------------------------------------------------------

@ApiTags('Admin • Entregas e avaliações')
@ApiBearerAuth()
@Controller('admin')
export class AdminLogisticsController {
  constructor(
    private readonly deliveries: DeliveriesService,
    private readonly dispatch: DispatchService,
    private readonly reviews: ReviewsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('deliveries')
  @RequirePermissions('deliveries.read')
  list(@CurrentUser() user: AuthUser, @Query() query: DeliveriesQueryDto) {
    return this.deliveries.listForAdmin(user, query);
  }

  @Get('deliveries/:id')
  @RequirePermissions('deliveries.read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.deliveries.getForAdmin(user, id);
  }

  @Post('deliveries/:id/cancel')
  @RequirePermissions('deliveries.manage')
  async cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDeliveryDto) {
    await this.prisma.deliveryOffer.updateMany({ where: { deliveryId: id, status: 'PENDING' }, data: { status: 'CANCELED' } });
    await this.deliveries.transition(id, 'CANCELED', { type: 'PLATFORM', id: user.userId }, { reason: dto.reason });
    return this.deliveries.getForAdmin(user, id);
  }

  @Post('deliveries/:id/assign')
  @RequirePermissions('deliveries.manage')
  @ApiOperation({ summary: 'Atribuir manualmente a um entregador' })
  async assign(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDriverDto) {
    await this.dispatch.assignManually(user, id, dto.driverId);
    return this.deliveries.getForAdmin(user, id);
  }

  @Get('drivers-online')
  @RequirePermissions('operations.view')
  @ApiOperation({ summary: 'Entregadores online/ocupados com a última posição' })
  online(@CurrentUser() user: AuthUser) {
    return this.prisma.driver.findMany({
      where: { tenantId: user.tenantId, availability: { in: ['ONLINE', 'BUSY'] } },
      select: {
        id: true,
        availability: true,
        lastLat: true,
        lastLng: true,
        lastLocationAt: true,
        ratingAvg: true,
        user: { select: { name: true } },
        activeVehicle: { select: { type: true, plate: true } },
      },
      take: 2000,
    });
  }

  @Get('reviews')
  @RequirePermissions('reviews.moderate')
  listReviews(@CurrentUser() user: AuthUser, @Query() query: ReviewsAdminQueryDto) {
    return this.reviews.listForAdmin(user.tenantId, query);
  }

  @Post('reviews/:id/hide')
  @HttpCode(204)
  @RequirePermissions('reviews.moderate')
  async hide(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HideReviewDto) {
    await this.reviews.setHidden(user, id, true, dto.reason);
  }

  @Post('reviews/:id/show')
  @HttpCode(204)
  @RequirePermissions('reviews.moderate')
  async show(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.reviews.setHidden(user, id, false);
  }
}
