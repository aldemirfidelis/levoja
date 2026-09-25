import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiHeader, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { BatchRow } from './batch-file';
import { AllowApiKey, CompanyPermission, CurrentUser, RequireFeature, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { PaginationQueryDto } from '../../common/pagination';
import { AppConfig } from '../../config/config.module';
import { AuditService } from '../audit/audit.service';
import { ReportsService } from '../operations/reports.service';
import { MAX_BATCH_FILE_BYTES, templateCsv, templateXlsx } from './batch-file';
import { BatchesService } from './batches.service';
import { CompanyB2bService } from './company-b2b.service';
import { ContractsService } from './contracts.service';
import { InvoicesService } from './invoices.service';
import { RecurringService } from './recurring.service';
import {
  ApiKeyDto,
  BatchItemDto,
  BatchItemsQueryDto,
  BatchOptionsDto,
  CancelBatchDto,
  CancelInvoiceDto,
  ConfirmBatchDto,
  ContractsQueryDto,
  CorporateReportQueryDto,
  CostCenterDto,
  CreateBatchDto,
  CreateContractDto,
  InvoicesQueryDto,
  LocationDto,
  MarkPaidDto,
  PriceRuleDto,
  ReasonDto,
  RecurrenceDto,
  SimulateDto,
  UpdateContractDto,
  UpdateCostCenterDto,
  UpdateLocationDto,
  UpdatePriceRuleDto,
  UpdateRecurrenceDto,
} from './b2b.dto';

const BATCH_UPLOAD = FileInterceptor('file', { limits: { fileSize: MAX_BATCH_FILE_BYTES } });
const limit = (per: number) => ({ default: { limit: () => (process.env.NODE_ENV === 'test' ? 10_000 : per), ttl: 60_000 } });

function sendCsv(response: Response, file: { fileName: string; content: string }) {
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
  response.setHeader('Cache-Control', 'private, no-store');
  return file.content;
}

/** Item da API → linha no formato da planilha (a validação é a mesma). */
function toRow(item: BatchItemDto): BatchRow {
  const text = (value: unknown) => (value == null || value === '' ? undefined : String(value));
  return {
    externalRef: text(item.externalRef),
    recipientName: text(item.recipientName),
    recipientPhone: text(item.recipientPhone),
    zipCode: text(item.zipCode),
    street: text(item.street),
    number: text(item.number),
    complement: text(item.complement),
    district: text(item.district),
    city: text(item.city),
    state: text(item.state),
    reference: text(item.reference),
    lat: text(item.lat),
    lng: text(item.lng),
    itemCategory: text(item.itemCategory),
    itemDescription: text(item.itemDescription),
    weightKg: text(item.weightKg),
    declaredValue: item.declaredValueCents == null ? undefined : (item.declaredValueCents / 100).toFixed(2),
    notes: text(item.notes),
    costCenter: text(item.costCenter),
    proofMethod: text(item.proofMethod),
  };
}

// =============================================================================
// Portal da empresa
// =============================================================================

@ApiTags('Empresas • B2B')
@ApiBearerAuth()
@RequireFeature('b2b')
@Controller('companies/:companyId/b2b')
export class CompanyB2bController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly b2b: CompanyB2bService,
    private readonly invoices: InvoicesService,
    private readonly reports: ReportsService,
    private readonly recurring: RecurringService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @CompanyPermission('company.deliveries.request', 'contracts.read')
  @ApiOperation({ summary: 'Contrato vigente, crédito disponível e faturas em aberto' })
  overview(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.contracts.companyOverview(companyId);
  }

  // --- Centros de custo ---

  @Get('cost-centers')
  @RequireFeature('deliveries')
  @AllowApiKey('deliveries:read')
  @CompanyPermission('company.deliveries.request', 'contracts.read')
  costCenters(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.b2b.listCostCenters(companyId);
  }

  @Post('cost-centers')
  @CompanyPermission('company.b2b.manage')
  createCostCenter(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: CostCenterDto) {
    return this.b2b.createCostCenter(user, companyId, dto);
  }

  @Patch('cost-centers/:id')
  @CompanyPermission('company.b2b.manage')
  updateCostCenter(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCostCenterDto) {
    return this.b2b.updateCostCenter(user, companyId, id, dto);
  }

  // --- Unidades e locais ---

  @Get('locations')
  @RequireFeature('deliveries')
  @AllowApiKey('deliveries:read')
  @CompanyPermission('company.deliveries.request', 'contracts.read')
  locations(@Param('companyId', ParseUUIDPipe) companyId: string, @Query('all') all?: string) {
    return this.b2b.listLocations(companyId, all === 'true');
  }

  @Post('locations')
  @RequireFeature('deliveries')
  @CompanyPermission('company.b2b.manage')
  createLocation(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: LocationDto) {
    return this.b2b.createLocation(user, companyId, dto);
  }

  @Patch('locations/:id')
  @RequireFeature('deliveries')
  @CompanyPermission('company.b2b.manage')
  updateLocation(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLocationDto) {
    return this.b2b.updateLocation(user, companyId, id, dto);
  }

  // --- Chaves de API ---

  @Get('api-keys')
  @RequireFeature('integrations')
  @CompanyPermission('company.b2b.manage')
  apiKeys(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.b2b.listApiKeys(companyId);
  }

  @Post('api-keys')
  @RequireFeature('integrations')
  @CompanyPermission('company.b2b.manage')
  @ApiOperation({ summary: 'Criar chave de API (o segredo aparece somente nesta resposta)' })
  createApiKey(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: ApiKeyDto) {
    return this.b2b.createApiKey(user, companyId, dto);
  }

  @Delete('api-keys/:id')
  @RequireFeature('integrations')
  @HttpCode(204)
  @CompanyPermission('company.b2b.manage')
  async revokeApiKey(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.b2b.revokeApiKey(user, companyId, id);
  }

  // --- Entregas recorrentes ---

  @Get('recurring-deliveries')
  @CompanyPermission('company.deliveries.request', 'contracts.read')
  recurrences(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.recurring.list(companyId);
  }

  @Post('recurring-deliveries')
  @CompanyPermission('company.b2b.manage')
  createRecurrence(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: RecurrenceDto) {
    if (!user.canInCompany(companyId, 'company.deliveries.request')) throw new BadRequestException('É preciso poder solicitar entregas para criar recorrências.');
    return this.recurring.create(user, companyId, dto);
  }

  @Patch('recurring-deliveries/:id')
  @CompanyPermission('company.b2b.manage')
  updateRecurrence(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRecurrenceDto) {
    return this.recurring.update(user, companyId, id, dto);
  }

  @Post('recurring-deliveries/:id/run')
  @HttpCode(200)
  @CompanyPermission('company.b2b.manage')
  @ApiOperation({ summary: 'Gerar agora as ocorrências da janela (normalmente automático)' })
  runRecurrence(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.recurring.runNow(user, companyId, id);
  }

  // --- Faturas ---

  @Get('invoices')
  @RequireFeature(null)
  @CompanyPermission('company.finance.read', 'invoices.read')
  invoicesList(@Param('companyId', ParseUUIDPipe) companyId: string, @Query() query: InvoicesQueryDto) {
    return this.invoices.listForCompany(companyId, query);
  }

  @Get('invoices/:id')
  @RequireFeature(null)
  @CompanyPermission('company.finance.read', 'invoices.read')
  invoice(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.getForCompany(companyId, id);
  }

  @Get('invoices/:id/export.csv')
  @RequireFeature(null)
  @CompanyPermission('company.finance.read', 'invoices.read')
  @ApiProduces('text/csv')
  async invoiceCsv(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) response: Response) {
    return sendCsv(response, await this.invoices.exportCsv(id, { companyId }));
  }

  @Post('invoices/:id/pay')
  @RequireFeature(null)
  @HttpCode(200)
  @CompanyPermission('company.finance.read')
  @ApiOperation({ summary: 'Gerar PIX para pagar a fatura' })
  payInvoice(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.pay(user, companyId, id);
  }

  // --- Relatório corporativo ---

  @Get('report')
  @CompanyPermission('company.reports.read', 'reports.read')
  @ApiProduces('application/json', 'text/csv')
  @ApiOperation({ summary: 'Entregas, gasto, SLA e centros de custo no período' })
  async report(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Query() query: CorporateReportQueryDto, @Res({ passthrough: true }) response: Response) {
    const company = await this.contracts.companyTenant(companyId);
    const result = await this.reports.corporate(company, companyId, query);
    if (query.format !== 'csv') return result;
    const key = query.table ?? 'costCenters';
    const table = Object.hasOwn(result.tables, key) ? result.tables[key] : undefined;
    if (!table) throw new BadRequestException(`Tabela inválida. Opções: ${Object.keys(result.tables).join(', ')}.`);
    await this.audit.log({ action: 'report.export', entityType: 'Report', metadata: { kind: 'corporate', companyId, table: key } });
    return sendCsv(response, { fileName: `levoja-corporativo-${key}-${result.range.from}_${result.range.to}.csv`, content: this.reports.toCsv(table) });
  }
}

@ApiTags('Empresas • Entregas em lote')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Api-Key', required: false, description: 'Alternativa ao token: chave de API da empresa (integrações)' })
@RequireFeature('b2b')
@Controller('companies/:companyId/delivery-batches')
export class DeliveryBatchesController {
  constructor(
    private readonly batches: BatchesService,
    private readonly config: AppConfig,
  ) {}

  @Get('template.csv')
  @AllowApiKey('deliveries:read')
  @CompanyPermission('company.deliveries.request')
  @ApiProduces('text/csv')
  templateCsv(@Res({ passthrough: true }) response: Response) {
    return sendCsv(response, { fileName: 'modelo-lote-entregas.csv', content: templateCsv() });
  }

  @Get('template.xlsx')
  @CompanyPermission('company.deliveries.request')
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async templateXlsx(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', 'attachment; filename="modelo-lote-entregas.xlsx"');
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(await templateXlsx());
  }

  @Post('upload')
  @AllowApiKey('deliveries:write')
  @Throttle(limit(10))
  @CompanyPermission('company.deliveries.request')
  @UseInterceptors(BATCH_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, paymentMethod: { type: 'string', enum: ['INVOICE', 'WALLET'] }, name: { type: 'string' }, scheduledFor: { type: 'string' }, locationId: { type: 'string' }, costCenterId: { type: 'string' }, planRoutes: { type: 'boolean' } } } })
  @ApiOperation({ summary: 'Importar lote por planilha (CSV ou Excel); a validação roda em segundo plano' })
  upload(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @UploadedFile() file: { buffer: Buffer; originalname: string; size: number }, @Body() dto: BatchOptionsDto) {
    return this.batches.createFromFile(user, companyId, file, dto);
  }

  @Post()
  @AllowApiKey('deliveries:write')
  @Throttle(limit(10))
  @CompanyPermission('company.deliveries.request')
  @ApiOperation({ summary: 'Criar lote pela API (JSON)' })
  create(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: CreateBatchDto) {
    const { items, ...options } = dto;
    return this.batches.createFromApi(user, companyId, items.map(toRow), options);
  }

  @Get()
  @AllowApiKey('deliveries:read')
  @CompanyPermission('company.orders.read', 'deliveries.read')
  list(@Param('companyId', ParseUUIDPipe) companyId: string, @Query() query: PaginationQueryDto) {
    return this.batches.list(companyId, query);
  }

  @Get(':id')
  @AllowApiKey('deliveries:read')
  @CompanyPermission('company.orders.read', 'deliveries.read')
  get(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.batches.get(companyId, id);
  }

  @Get(':id/items')
  @AllowApiKey('deliveries:read')
  @CompanyPermission('company.orders.read', 'deliveries.read')
  items(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string, @Query() query: BatchItemsQueryDto) {
    return this.batches.items(companyId, id, query);
  }

  @Get(':id/export.csv')
  @AllowApiKey('deliveries:read')
  @CompanyPermission('company.orders.read', 'deliveries.read')
  @ApiProduces('text/csv')
  async export(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) response: Response) {
    return sendCsv(response, await this.batches.exportCsv(companyId, id, this.config.env.WEB_PUBLIC_URL));
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @AllowApiKey('deliveries:write')
  @CompanyPermission('company.deliveries.request')
  @ApiOperation({ summary: 'Confirmar: cria as entregas válidas, agrupadas em rotas' })
  confirm(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmBatchDto) {
    return this.batches.confirm(user, companyId, id, dto.scheduledFor);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @AllowApiKey('deliveries:write')
  @CompanyPermission('company.deliveries.request')
  cancel(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelBatchDto) {
    return this.batches.cancel(user, companyId, id, dto.reason);
  }
}

// =============================================================================
// Painel administrativo
// =============================================================================

@ApiTags('Admin • B2B')
@ApiBearerAuth()
@Controller('admin/b2b')
export class AdminB2bController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly invoices: InvoicesService,
  ) {}

  @Get('contracts')
  @RequirePermissions('contracts.read')
  list(@CurrentUser() user: AuthUser, @Query() query: ContractsQueryDto) {
    return this.contracts.list(user, query);
  }

  @Get('contracts/:id')
  @RequirePermissions('contracts.read')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.get(user, id);
  }

  @Post('contracts')
  @RequirePermissions('contracts.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateContractDto) {
    const { companyId, ...input } = dto;
    return this.contracts.create(user, companyId, input);
  }

  @Patch('contracts/:id')
  @RequirePermissions('contracts.manage')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContractDto) {
    return this.contracts.update(user, id, dto);
  }

  @Post('contracts/:id/rules')
  @RequirePermissions('contracts.manage')
  addRule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PriceRuleDto) {
    return this.contracts.addRule(user, id, { ...dto, state: dto.state?.toUpperCase() ?? null });
  }

  @Patch('contracts/:id/rules/:ruleId')
  @RequirePermissions('contracts.manage')
  updateRule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('ruleId', ParseUUIDPipe) ruleId: string, @Body() dto: UpdatePriceRuleDto) {
    return this.contracts.updateRule(user, id, ruleId, { ...dto, ...(dto.state !== undefined ? { state: dto.state?.toUpperCase() ?? null } : {}) });
  }

  @Delete('contracts/:id/rules/:ruleId')
  @HttpCode(204)
  @RequirePermissions('contracts.manage')
  async deleteRule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('ruleId', ParseUUIDPipe) ruleId: string) {
    await this.contracts.deleteRule(user, id, ruleId);
  }

  @Post('contracts/:id/simulate')
  @HttpCode(200)
  @RequirePermissions('contracts.read')
  @ApiOperation({ summary: 'Preço do contrato x tabela padrão para uma entrega de exemplo' })
  simulate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SimulateDto) {
    return this.contracts.simulate(user, id, dto);
  }

  @Post('contracts/:id/invoices/close')
  @HttpCode(200)
  @RequirePermissions('invoices.manage')
  @ApiOperation({ summary: 'Fechar o período agora e emitir a fatura (antecipa o fechamento mensal)' })
  async close(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.contracts.get(user, id);
    const invoice = await this.invoices.generate(id, new Date(), user);
    return invoice ? this.invoices.staffView(user, invoice.id) : { invoice: null, message: 'Não há entregas faturadas a cobrar neste período.' };
  }

  @Get('invoices')
  @RequirePermissions('invoices.read')
  invoicesList(@CurrentUser() user: AuthUser, @Query() query: InvoicesQueryDto) {
    return this.invoices.listForStaff(user, query);
  }

  @Get('invoices/:id')
  @RequirePermissions('invoices.read')
  invoice(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.staffView(user, id);
  }

  @Get('invoices/:id/export.csv')
  @RequirePermissions('invoices.read')
  @ApiProduces('text/csv')
  async invoiceCsv(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) response: Response) {
    return sendCsv(response, await this.invoices.exportCsv(id, { tenantId: user.tenantId }));
  }

  @Post('invoices/:id/mark-paid')
  @HttpCode(200)
  @RequirePermissions('invoices.manage')
  @ApiOperation({ summary: 'Baixa manual (transferência/boleto conferidos)' })
  markPaid(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkPaidDto) {
    return this.invoices.markPaid(user, id, dto.reference);
  }

  @Post('invoices/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('invoices.manage')
  cancelInvoice(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelInvoiceDto) {
    return this.invoices.cancel(user, id, dto.reason);
  }

  // Rota genérica por último: não pode capturar /rules, /simulate e /invoices.
  @Post('contracts/:id/:action')
  @HttpCode(200)
  @RequirePermissions('contracts.manage')
  @ApiOperation({ summary: 'Ativar, suspender, reativar ou encerrar (activate | suspend | resume | end)' })
  setStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('action') action: string, @Body() dto: ReasonDto) {
    if (!['activate', 'suspend', 'resume', 'end'].includes(action)) throw new BadRequestException('Ação inválida.');
    return this.contracts.setStatus(user, id, action as 'activate' | 'suspend' | 'resume' | 'end', dto.reason);
  }
}
