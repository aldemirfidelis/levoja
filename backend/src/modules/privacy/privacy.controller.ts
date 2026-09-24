import { Body, Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { Client, ClientInfo, CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { TenantId } from '../../common/tenant.decorator';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LegalService } from './legal.service';
import { PrivacyService } from './privacy.service';
import { ConsentType, LegalDocumentType, PrivacyRequestStatus } from '../../generated/prisma/enums';

class UpdateConsentDto {
  @ApiProperty({ enum: ConsentType }) @IsEnum(ConsentType) type!: ConsentType;
  @ApiProperty() @IsBoolean() granted!: boolean;
}

class DeletionRequestDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class PublishLegalDto {
  @ApiProperty({ enum: LegalDocumentType }) @IsEnum(LegalDocumentType) type!: LegalDocumentType;
  @ApiProperty({ example: '2.0' }) @IsString() @Matches(/^\d+(\.\d+){0,2}$/) version!: string;
  @ApiProperty() @IsString() @Length(3, 150) title!: string;
  @ApiProperty({ description: 'Markdown' }) @IsString() @Length(50, 200_000) content!: string;
}

class ResolvePrivacyDto {
  @ApiProperty() @IsBoolean() approve!: boolean;
  @ApiProperty() @IsString() @Length(3, 1000) response!: string;
}

@ApiTags('Documentos legais')
@Controller('legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Documentos legais vigentes' })
  list(@TenantId() tenantId: string) {
    return this.legal.listCurrent(tenantId);
  }

  @Public()
  @Get(':type')
  @ApiOperation({ summary: 'Texto vigente de um documento legal' })
  get(@TenantId() tenantId: string, @Param('type', new ParseEnumPipe(LegalDocumentType)) type: LegalDocumentType) {
    return this.legal.current(tenantId, type);
  }
}

@ApiTags('Privacidade (LGPD)')
@ApiBearerAuth()
@Controller('me')
export class MePrivacyController {
  constructor(
    private readonly legal: LegalService,
    private readonly privacy: PrivacyService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('consents')
  @ApiOperation({ summary: 'Consentimentos atuais e aceites pendentes' })
  consents(@CurrentUser() user: AuthUser) {
    const required: ConsentType[] = ['TERMS_OF_USE', 'PRIVACY_POLICY'];
    if (user.driverId) required.push('DRIVER_TERMS');
    if (user.companies.length) required.push('COMPANY_TERMS');
    return this.legal.consentStatus(user.tenantId, user.userId, required);
  }

  @Post('consents')
  @ApiOperation({ summary: 'Conceder ou revogar consentimento opcional (marketing, localização)' })
  async updateConsent(@CurrentUser() user: AuthUser, @Client() client: ClientInfo, @Body() dto: UpdateConsentDto) {
    this.legal.assertRevocable(dto.type);
    await this.prisma.$transaction((tx) => this.legal.recordConsents(tx, user.tenantId, user.userId, [dto], client));
    return this.consents(user);
  }

  @Post('consents/accept-current')
  @ApiOperation({ summary: 'Aceitar as versões vigentes dos termos pendentes' })
  async acceptCurrent(@CurrentUser() user: AuthUser, @Client() client: ClientInfo) {
    const status = await this.consents(user);
    await this.prisma.$transaction((tx) =>
      this.legal.recordConsents(
        tx,
        user.tenantId,
        user.userId,
        status.pendingAcceptance.map((type) => ({ type, granted: true })),
        client,
      ),
    );
    return this.consents(user);
  }

  @Get('data-export')
  @ApiOperation({ summary: 'Exportar meus dados pessoais (portabilidade)' })
  async export(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Content-Disposition', `attachment; filename="meus-dados-${new Date().toISOString().slice(0, 10)}.json"`);
    return this.privacy.exportData(user);
  }

  @Post('privacy/deletion-request')
  @ApiOperation({ summary: 'Solicitar exclusão da conta e dos dados pessoais' })
  requestDeletion(@CurrentUser() user: AuthUser, @Body() dto: DeletionRequestDto) {
    return this.privacy.requestDeletion(user, dto.reason);
  }

  @Get('privacy/requests')
  myRequests(@CurrentUser() user: AuthUser) {
    return this.privacy.listMine(user.userId);
  }
}

@ApiTags('Admin • Privacidade e documentos legais')
@ApiBearerAuth()
@Controller('admin')
export class AdminPrivacyController {
  constructor(
    private readonly legal: LegalService,
    private readonly privacy: PrivacyService,
  ) {}

  @Get('legal-documents')
  @RequirePermissions('settings.manage')
  legalDocuments(@CurrentUser() user: AuthUser) {
    return this.legal.listAll(user.tenantId);
  }

  @Post('legal-documents')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Publicar nova versão de documento legal (usuários precisarão aceitar novamente)' })
  publish(@CurrentUser() user: AuthUser, @Body() dto: PublishLegalDto) {
    return this.legal.publish(user.tenantId, dto);
  }

  @Get('privacy-requests')
  @RequirePermissions('privacy.manage')
  requests(
    @CurrentUser() user: AuthUser,
    @Query('status', new ParseEnumPipe(PrivacyRequestStatus, { optional: true })) status?: PrivacyRequestStatus,
  ) {
    return this.privacy.listForAdmin(user.tenantId, status);
  }

  @Post('privacy-requests/:id/resolve')
  @RequirePermissions('privacy.manage')
  @ApiOperation({ summary: 'Concluir (anonimizar) ou recusar solicitação do titular' })
  resolve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolvePrivacyDto) {
    return this.privacy.resolve(user, id, dto.approve, dto.response);
  }
}
