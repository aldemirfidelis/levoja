import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength, ValidateNested } from 'class-validator';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { TenantId } from '../../common/tenant.decorator';
import type { AuthUser } from '../../common/auth/auth-user';
import { UploadedFileLike } from '../../infra/storage/file-validation';
import { FILE_BODY, IMAGE_UPLOAD } from '../users/users.controller';
import { UsersModule } from '../users/users.module';
import { TenantsAdminService } from './tenants-admin.service';
import { TenantsService } from './tenants.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class BrandingDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 40) appName?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) logoUrl?: string;
  @ApiPropertyOptional({ example: '#2A78D6' }) @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Use a cor no formato #RRGGBB.' }) primaryColor?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(254) supportEmail?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(30) supportPhone?: string;
  @ApiPropertyOptional({ description: 'Endereço do portal (links de e-mails)' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(200) webUrl?: string;
  @ApiPropertyOptional({ description: 'Endereço do painel administrativo' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(200) adminUrl?: string;
}

class TenantAdminDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 120) name!: string;
  @ApiProperty() @Transform(trim) @IsEmail() @MaxLength(254) email!: string;
}

class CreateTenantDto {
  @ApiProperty({ example: 'entregas-sul' }) @Transform(trim) @IsString() @Matches(/^[a-z0-9-]{3,40}$/) slug!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 80) name!: string;
  @ApiPropertyOptional({ type: [String], example: ['entregas.empresa.com.br'] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) domains?: string[];
  @ApiPropertyOptional({ type: BrandingDto }) @IsOptional() @ValidateNested() @Type(() => BrandingDto) branding?: BrandingDto;
  @ApiProperty({ type: TenantAdminDto }) @ValidateNested() @Type(() => TenantAdminDto) admin!: TenantAdminDto;
}

class UpdateTenantDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(2, 80) name?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) domains?: string[];
  @ApiPropertyOptional({ type: BrandingDto }) @IsOptional() @ValidateNested() @Type(() => BrandingDto) branding?: BrandingDto;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'] }) @IsOptional() @IsIn(['ACTIVE', 'SUSPENDED']) status?: 'ACTIVE' | 'SUSPENDED';
}

@ApiTags('Marca (white label)')
@Controller('tenant')
export class PublicTenantController {
  constructor(private readonly tenants: TenantsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Marca da plataforma (nome, logo, cor, contatos) — resolvida por X-Tenant ou domínio' })
  async branding(@TenantId() tenantId: string) {
    const info = await this.tenants.info(tenantId);
    return { slug: info.slug, name: info.name, appName: info.appName, logoUrl: info.logoUrl, primaryColor: info.primaryColor, supportEmail: info.supportEmail, supportPhone: info.supportPhone, webUrl: info.webUrl };
  }
}

@ApiTags('Admin • Tenants (white label)')
@ApiBearerAuth()
@Controller('admin/tenants')
export class AdminTenantsController {
  constructor(private readonly tenants: TenantsAdminService) {}

  @Get()
  @RequirePermissions('tenants.manage')
  list() {
    return this.tenants.list();
  }

  @Post()
  @RequirePermissions('tenants.manage')
  @ApiOperation({ summary: 'Criar tenant: papéis, segmentos, preços, planos, documentos legais e convite ao primeiro administrador' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTenantDto) {
    return this.tenants.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('tenants.manage')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTenantDto) {
    return this.tenants.update(user, id, dto);
  }
}

@ApiTags('Admin • Marca')
@ApiBearerAuth()
@Controller('admin/branding')
export class AdminBrandingController {
  constructor(
    private readonly admin: TenantsAdminService,
    private readonly tenants: TenantsService,
  ) {}

  @Get()
  @RequirePermissions('settings.manage')
  current(@CurrentUser() user: AuthUser) {
    return this.tenants.info(user.tenantId);
  }

  @Patch()
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Marca desta plataforma: nome do app, cor, contatos e endereços' })
  update(@CurrentUser() user: AuthUser, @Body() dto: BrandingDto) {
    return this.admin.updateOwnBranding(user, dto);
  }

  @Put('logo')
  @RequirePermissions('settings.manage')
  @UseInterceptors(IMAGE_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  logo(@CurrentUser() user: AuthUser, @UploadedFile() file: UploadedFileLike) {
    return this.admin.uploadLogo(user, file);
  }
}

/** Administração de tenants (white label) e da marca de cada tenant. */
@Module({
  imports: [UsersModule],
  controllers: [PublicTenantController, AdminTenantsController, AdminBrandingController],
  providers: [TenantsAdminService],
})
export class TenantsAdminModule {}
