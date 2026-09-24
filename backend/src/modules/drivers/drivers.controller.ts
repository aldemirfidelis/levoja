import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { UploadedFileLike } from '../../infra/storage/file-validation';
import { DOCUMENT_UPLOAD } from '../users/users.controller';
import { sendFile } from '../companies/companies.controller';
import { PartnerActionDto, ReviewDocumentDto } from '../companies/companies.dto';
import { AddressDto } from '../customers/address.dto';
import { BankAccountDto } from '../partners/bank-account.dto';
import { DriversService } from './drivers.service';
import { DriverReviewService } from './driver-review.service';
import {
  AdminDriversQueryDto,
  CreateDriverDto,
  ReviewVehicleDto,
  UpdateDriverDto,
  UpdateVehicleDto,
  UploadDriverDocumentDto,
  VehicleDto,
} from './drivers.dto';

@ApiTags('Entregador (cadastro)')
@ApiBearerAuth()
@Controller('drivers/me')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Post()
  @ApiOperation({ summary: 'Tornar-me entregador (usuário já cadastrado)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDriverDto) {
    return this.drivers.create(user, dto.vehicleType);
  }

  @Get()
  @ApiOperation({ summary: 'Meu cadastro de entregador, pendências e status' })
  get(@CurrentUser() user: AuthUser) {
    return this.drivers.getMine(user.userId);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateDriverDto) {
    return this.drivers.updateMine(user, dto);
  }

  @Put('address')
  setAddress(@CurrentUser() user: AuthUser, @Body() dto: AddressDto) {
    return this.drivers.setAddress(user, dto);
  }

  @Post('vehicles')
  addVehicle(@CurrentUser() user: AuthUser, @Body() dto: VehicleDto) {
    return this.drivers.addVehicle(user, dto);
  }

  @Patch('vehicles/:vehicleId')
  updateVehicle(@CurrentUser() user: AuthUser, @Param('vehicleId', ParseUUIDPipe) vehicleId: string, @Body() dto: UpdateVehicleDto) {
    return this.drivers.updateVehicle(user, vehicleId, dto);
  }

  @Delete('vehicles/:vehicleId')
  @HttpCode(204)
  async removeVehicle(@CurrentUser() user: AuthUser, @Param('vehicleId', ParseUUIDPipe) vehicleId: string) {
    await this.drivers.removeVehicle(user, vehicleId);
  }

  @Post('vehicles/:vehicleId/activate')
  activateVehicle(@CurrentUser() user: AuthUser, @Param('vehicleId', ParseUUIDPipe) vehicleId: string) {
    return this.drivers.activateVehicle(user, vehicleId);
  }

  @Post('documents')
  @UseInterceptors(DOCUMENT_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { type: { type: 'string' }, vehicleId: { type: 'string' }, file: { type: 'string', format: 'binary' } },
    },
  })
  uploadDocument(@CurrentUser() user: AuthUser, @Body() dto: UploadDriverDocumentDto, @UploadedFile() file: UploadedFileLike) {
    return this.drivers.uploadDocument(user, dto.type, dto.vehicleId, file);
  }

  @Get('documents/:documentId/file')
  async documentFile(
    @CurrentUser() user: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!user.driverId) throw new ForbiddenException('Cadastro de entregador não encontrado.');
    return sendFile(response, await this.drivers.getDocumentFile(user.driverId, documentId));
  }

  @Delete('documents/:documentId')
  @HttpCode(204)
  async deleteDocument(@CurrentUser() user: AuthUser, @Param('documentId', ParseUUIDPipe) documentId: string) {
    await this.drivers.deleteDocument(user, documentId);
  }

  @Put('bank-account')
  @ApiOperation({ summary: 'Chave PIX e dados bancários para saques' })
  setBankAccount(@CurrentUser() user: AuthUser, @Body() dto: BankAccountDto) {
    return this.drivers.setBankAccount(user, dto);
  }

  @Post('submit')
  @ApiOperation({ summary: 'Enviar cadastro para análise' })
  submit(@CurrentUser() user: AuthUser) {
    return this.drivers.submit(user);
  }

  @Get('status-history')
  async history(@CurrentUser() user: AuthUser) {
    if (!user.driverId) throw new ForbiddenException('Cadastro de entregador não encontrado.');
    return this.drivers.statusHistory(user.driverId);
  }
}

@ApiTags('Admin • Entregadores')
@ApiBearerAuth()
@Controller('admin/drivers')
export class AdminDriversController {
  constructor(
    private readonly review: DriverReviewService,
    private readonly drivers: DriversService,
  ) {}

  @Get()
  @RequirePermissions('drivers.read')
  list(@CurrentUser() user: AuthUser, @Query() query: AdminDriversQueryDto) {
    return this.review.list(user.tenantId, query);
  }

  @Get(':driverId')
  @RequirePermissions('drivers.read')
  get(@CurrentUser() user: AuthUser, @Param('driverId', ParseUUIDPipe) driverId: string) {
    return this.review.get(user, driverId);
  }

  @Post(':driverId/actions')
  @RequirePermissions('drivers.read')
  @ApiOperation({ summary: 'Aprovar, reprovar, solicitar correção, suspender, bloquear ou reativar' })
  action(@CurrentUser() user: AuthUser, @Param('driverId', ParseUUIDPipe) driverId: string, @Body() dto: PartnerActionDto) {
    return this.review.applyAction(user, driverId, dto);
  }

  @Post(':driverId/documents/:documentId/review')
  @RequirePermissions('drivers.review')
  reviewDocument(
    @CurrentUser() user: AuthUser,
    @Param('driverId', ParseUUIDPipe) driverId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: ReviewDocumentDto,
  ) {
    return this.review.reviewDocument(user, driverId, documentId, dto);
  }

  @Post(':driverId/vehicles/:vehicleId/review')
  @RequirePermissions('drivers.review')
  reviewVehicle(
    @CurrentUser() user: AuthUser,
    @Param('driverId', ParseUUIDPipe) driverId: string,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() dto: ReviewVehicleDto,
  ) {
    return this.review.reviewVehicle(user, driverId, vehicleId, dto);
  }

  @Get(':driverId/documents/:documentId/file')
  @RequirePermissions('documents.read')
  async documentFile(
    @CurrentUser() user: AuthUser,
    @Param('driverId', ParseUUIDPipe) driverId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return sendFile(response, await this.drivers.getDocumentFile(driverId, documentId, user.tenantId));
  }
}
