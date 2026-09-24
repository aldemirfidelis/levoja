import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CompanyPermission, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { UploadedFileLike } from '../../infra/storage/file-validation';
import { DOCUMENT_UPLOAD, FILE_BODY, IMAGE_UPLOAD } from '../users/users.controller';
import { AddressDto } from '../customers/address.dto';
import { BankAccountDto } from '../partners/bank-account.dto';
import { CompaniesService } from './companies.service';
import { CompanyReviewService } from './company-review.service';
import { CompanyMembersService } from './company-members.service';
import {
  AddMemberDto,
  AdminCompaniesQueryDto,
  CreateCompanyDto,
  OpeningHoursDto,
  PartnerActionDto,
  ReviewDocumentDto,
  SetOpenDto,
  UpdateCompanyDto,
  UpdateMemberDto,
  UploadCompanyDocumentDto,
} from './companies.dto';

export function sendFile(response: Response, file: { stream: NodeJS.ReadableStream; contentType?: string; fileName: string }) {
  response.setHeader('Content-Type', file.contentType ?? 'application/octet-stream');
  response.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`);
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  return new StreamableFile(file.stream as never);
}

@ApiTags('Empresas (portal)')
@ApiBearerAuth()
@Controller('companies')
export class CompaniesController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly members: CompanyMembersService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Cadastrar nova empresa (o usuário se torna proprietário)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCompanyDto) {
    return this.companies.create(user, dto);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Empresas das quais participo' })
  mine(@CurrentUser() user: AuthUser) {
    return this.companies.listMine(user);
  }

  @Get(':companyId')
  @CompanyPermission('company.products.read', 'companies.read')
  get(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.companies.getView(companyId);
  }

  @Patch(':companyId')
  @CompanyPermission('company.profile.manage', 'companies.manage')
  update(@Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: UpdateCompanyDto) {
    return this.companies.update(companyId, dto);
  }

  @Put(':companyId/address')
  @CompanyPermission('company.profile.manage', 'companies.manage')
  setAddress(@Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: AddressDto) {
    return this.companies.setAddress(companyId, dto);
  }

  @Put(':companyId/opening-hours')
  @CompanyPermission('company.profile.manage', 'companies.manage')
  setOpeningHours(@Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: OpeningHoursDto) {
    return this.companies.setOpeningHours(companyId, dto);
  }

  @Post(':companyId/open')
  @CompanyPermission('company.orders.manage')
  @ApiOperation({ summary: 'Abrir ou pausar a loja' })
  setOpen(@Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: SetOpenDto) {
    return this.companies.setOpen(companyId, dto.isOpen);
  }

  @Put(':companyId/logo')
  @CompanyPermission('company.profile.manage', 'companies.manage')
  @UseInterceptors(IMAGE_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  logo(@Param('companyId', ParseUUIDPipe) companyId: string, @UploadedFile() file: UploadedFileLike) {
    return this.companies.uploadImage(companyId, 'logo', file);
  }

  @Put(':companyId/banner')
  @CompanyPermission('company.profile.manage', 'companies.manage')
  @UseInterceptors(IMAGE_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  banner(@Param('companyId', ParseUUIDPipe) companyId: string, @UploadedFile() file: UploadedFileLike) {
    return this.companies.uploadImage(companyId, 'banner', file);
  }

  @Post(':companyId/documents')
  @CompanyPermission('company.profile.manage')
  @UseInterceptors(DOCUMENT_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { type: { type: 'string' }, file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Enviar documento (PDF/imagem)' })
  uploadDocument(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: UploadCompanyDocumentDto,
    @UploadedFile() file: UploadedFileLike,
  ) {
    return this.companies.uploadDocument(companyId, dto.type, file);
  }

  @Get(':companyId/documents/:documentId/file')
  @CompanyPermission('company.profile.manage', 'documents.read')
  async documentFile(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return sendFile(response, await this.companies.getDocumentFile(companyId, documentId));
  }

  @Delete(':companyId/documents/:documentId')
  @HttpCode(204)
  @CompanyPermission('company.profile.manage')
  async deleteDocument(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    await this.companies.deleteDocument(companyId, documentId);
  }

  @Put(':companyId/bank-account')
  @CompanyPermission('company.profile.manage')
  @ApiOperation({ summary: 'Dados bancários/PIX para repasse' })
  setBankAccount(@Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: BankAccountDto) {
    return this.companies.setBankAccount(companyId, dto);
  }

  @Post(':companyId/submit')
  @CompanyPermission('company.profile.manage')
  @ApiOperation({ summary: 'Enviar cadastro para análise' })
  submit(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.companies.submit(user, companyId);
  }

  @Get(':companyId/status-history')
  @CompanyPermission('company.profile.manage', 'companies.read')
  history(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.companies.statusHistory(companyId);
  }

  // --- Equipe ---

  @Get(':companyId/members')
  @CompanyPermission('company.users.manage', 'companies.read')
  listMembers(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.members.list(companyId);
  }

  @Get(':companyId/member-roles')
  @CompanyPermission('company.users.manage')
  memberRoles(@CurrentUser() user: AuthUser) {
    return this.members.listRoles(user.tenantId);
  }

  @Post(':companyId/members')
  @CompanyPermission('company.users.manage')
  addMember(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: AddMemberDto) {
    return this.members.add(user, companyId, dto);
  }

  @Patch(':companyId/members/:memberId')
  @CompanyPermission('company.users.manage')
  updateMember(
    @CurrentUser() user: AuthUser,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.members.update(user, companyId, memberId, dto);
  }

  @Delete(':companyId/members/:memberId')
  @HttpCode(204)
  @CompanyPermission('company.users.manage')
  async removeMember(
    @CurrentUser() user: AuthUser,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    await this.members.remove(user, companyId, memberId);
  }
}

@ApiTags('Admin • Empresas')
@ApiBearerAuth()
@Controller('admin/companies')
export class AdminCompaniesController {
  constructor(
    private readonly review: CompanyReviewService,
    private readonly companies: CompaniesService,
  ) {}

  @Get()
  @RequirePermissions('companies.read')
  @ApiOperation({ summary: 'Listar empresas (fila de análise ordenada por envio)' })
  list(@CurrentUser() user: AuthUser, @Query() query: AdminCompaniesQueryDto) {
    return this.review.list(user.tenantId, query);
  }

  @Get(':companyId')
  @RequirePermissions('companies.read')
  get(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.review.get(user, companyId);
  }

  @Post(':companyId/actions')
  @RequirePermissions('companies.read')
  @ApiOperation({ summary: 'Aprovar, reprovar, solicitar correção, suspender, bloquear ou reativar' })
  action(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: PartnerActionDto) {
    return this.review.applyAction(user, companyId, dto);
  }

  @Post(':companyId/documents/:documentId/review')
  @RequirePermissions('companies.review')
  reviewDocument(
    @CurrentUser() user: AuthUser,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: ReviewDocumentDto,
  ) {
    return this.review.reviewDocument(user, companyId, documentId, dto);
  }

  @Get(':companyId/documents/:documentId/file')
  @RequirePermissions('documents.read')
  async documentFile(
    @CurrentUser() user: AuthUser,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return sendFile(response, await this.companies.getDocumentFile(companyId, documentId, user.tenantId));
  }
}
