import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AllowApiKey, CompanyPermission, CurrentUser, RequireFeature, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { safeFileName, UploadedFileLike, validateUpload } from '../../infra/storage/file-validation';
import { DOCUMENT_UPLOAD, FILE_BODY } from '../users/users.controller';
import { sendFile } from '../companies/companies.controller';
import { OrdersService } from './orders.service';
import { AdminOrdersQueryDto, CancelOrderDto, CheckoutDto, HandoffDto, OrdersQueryDto, QuoteOrderDto } from './orders.dto';

@ApiTags('Pedidos (cliente)')
@ApiBearerAuth()
@Controller()
export class CustomerOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Post('orders/quote')
  @RequirePermissions('customer.orders.create')
  @ApiOperation({ summary: 'Resumo do pedido: itens, frete, taxas, total, prazo e pendências' })
  quote(@CurrentUser() user: AuthUser, @Body() dto: QuoteOrderDto) {
    return this.orders.quoteView(user, dto);
  }

  @Post('orders')
  @RequirePermissions('customer.orders.create')
  @ApiOperation({ summary: 'Finalizar pedido a partir do carrinho da loja' })
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.orders.checkout(user, dto);
  }

  @Get('orders')
  @RequirePermissions('customer.orders.read')
  list(@CurrentUser() user: AuthUser, @Query() query: OrdersQueryDto) {
    return this.orders.listForCustomer(user, query);
  }

  @Get('orders/:id')
  @RequirePermissions('customer.orders.read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.getForCustomer(user, id);
  }

  @Post('orders/:id/cancel')
  @RequirePermissions('customer.orders.cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelOrderDto) {
    return this.orders.cancelByCustomer(user, id, dto.reason);
  }

  @Post('me/prescriptions')
  @RequirePermissions('customer.orders.create')
  @UseInterceptors(DOCUMENT_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  @ApiOperation({ summary: 'Enviar receita médica (para produtos que exigem receita)' })
  async uploadPrescription(@CurrentUser() user: AuthUser, @UploadedFile() file: UploadedFileLike) {
    const { mime, ext } = validateUpload(file, 'document');
    const key = await this.storage.put(`private/prescriptions/${user.userId}/${randomUUID()}.${ext}`, file.buffer, mime);
    const prescription = await this.prisma.prescription.create({
      data: { userId: user.userId, fileKey: key, fileName: safeFileName(file.originalname), mimeType: mime },
    });
    return { id: prescription.id, fileName: prescription.fileName, createdAt: prescription.createdAt };
  }
}

@ApiTags('Empresas • Pedidos')
@ApiBearerAuth()
@RequireFeature('orders')
@Controller('companies/:companyId/orders')
export class CompanyOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @AllowApiKey('orders:read')
  @CompanyPermission('company.orders.read', 'orders.read')
  @ApiOperation({ summary: 'Pedidos da loja (scope=active para o quadro de pedidos)' })
  list(@Param('companyId', ParseUUIDPipe) companyId: string, @Query() query: OrdersQueryDto) {
    return this.orders.listForCompany(companyId, query);
  }

  @Get(':id')
  @AllowApiKey('orders:read')
  @CompanyPermission('company.orders.read', 'orders.read')
  get(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.getForCompany(companyId, id);
  }

  @Post(':id/confirm')
  @AllowApiKey('orders:write')
  @CompanyPermission('company.orders.manage')
  confirm(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.companyAction(user, companyId, id, 'confirm');
  }

  @Post(':id/prepare')
  @AllowApiKey('orders:write')
  @CompanyPermission('company.orders.manage')
  prepare(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.companyAction(user, companyId, id, 'prepare');
  }

  @Post(':id/ready')
  @AllowApiKey('orders:write')
  @CompanyPermission('company.orders.manage')
  @ApiOperation({ summary: 'Pedido pronto (entrega: aciona o despacho; retirada: aguarda o cliente)' })
  ready(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.companyAction(user, companyId, id, 'ready');
  }

  @Post(':id/cancel')
  @AllowApiKey('orders:write')
  @CompanyPermission('company.orders.manage')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.orders.companyAction(user, companyId, id, 'cancel', dto.reason);
  }

  @Post(':id/handoff')
  @CompanyPermission('company.orders.manage')
  @ApiOperation({ summary: 'Entrega no balcão (retirada) com o código do cliente' })
  handoff(
    @CurrentUser() user: AuthUser,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HandoffDto,
  ) {
    return this.orders.handoffToCustomer(user, companyId, id, dto.code);
  }

  @Get(':id/prescription')
  @CompanyPermission('company.orders.read')
  async prescription(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const prescription = await this.orders.prescriptionFile(companyId, id);
    const file = await this.storage.get(prescription.fileKey);
    if (!file) throw new NotFoundException('Arquivo não encontrado.');
    return sendFile(response, { ...file, contentType: prescription.mimeType, fileName: prescription.fileName });
  }
}

@ApiTags('Admin • Pedidos')
@ApiBearerAuth()
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermissions('orders.read')
  list(@CurrentUser() user: AuthUser, @Query() query: AdminOrdersQueryDto) {
    return this.orders.listForAdmin(user, query);
  }

  @Get(':id')
  @RequirePermissions('orders.read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.getForAdmin(user, id);
  }

  @Post(':id/cancel')
  @RequirePermissions('orders.manage')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelOrderDto) {
    return this.orders.cancelByPlatform(user, id, dto.reason);
  }
}
