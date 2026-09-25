import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { isValidDomain } from '@levoja/shared';
import { CompanyPermission, CurrentUser, Public, RequireFeature } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { SubscriptionsService } from '../saas/subscriptions.service';
import { TenantsService } from './tenants.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

class CompanyBrandDto {
  @ApiPropertyOptional({ example: '#1F7A4D', nullable: true }) @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Use a cor no formato #RRGGBB.' }) brandColor?: string | null;
  @ApiPropertyOptional({ example: 'pedidos.minhaloja.com.br', nullable: true }) @IsOptional() @Transform(trim) @IsString() @MaxLength(253) customDomain?: string | null;
}

class ResolveQueryDto {
  @ApiProperty({ example: 'pedidos.minhaloja.com.br' }) @Transform(trim) @IsString() @Length(4, 253) host!: string;
}

/**
 * Marca própria da empresa (recurso `white_label` do plano): cor e domínio da página da loja.
 * O domínio aponta (CNAME) para o portal, que resolve a loja por aqui e exibe a página com a
 * identidade da empresa.
 */
@Injectable()
export class CompanyBrandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionsService,
    private readonly tenants: TenantsService,
  ) {}

  async view(user: AuthUser, companyId: string) {
    const company = await this.prisma.company.findFirst({ where: { id: companyId, tenantId: user.tenantId }, select: { slug: true, brandColor: true, customDomain: true, logoKey: true, tradeName: true } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    const tenant = await this.tenants.info(user.tenantId);
    return {
      available: await this.subscriptions.hasFeature(user.tenantId, companyId, 'white_label'),
      brandColor: company.brandColor,
      customDomain: company.customDomain,
      logoUrl: this.storage.publicUrl(company.logoKey),
      pageUrl: company.customDomain ? `https://${company.customDomain}` : `${tenant.webUrl}/loja/${company.slug}`,
    };
  }

  async update(user: AuthUser, companyId: string, input: { brandColor?: string | null; customDomain?: string | null }) {
    const company = await this.prisma.company.findFirst({ where: { id: companyId, tenantId: user.tenantId }, select: { id: true, brandColor: true, customDomain: true } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    let customDomain: string | null | undefined = input.customDomain === undefined ? undefined : input.customDomain || null;
    if (customDomain) {
      if (!isValidDomain(customDomain)) throw new BadRequestException('Domínio inválido. Informe só o endereço (ex.: pedidos.minhaloja.com.br), sem https:// nem caminho.');
      const tenantUsing = await this.prisma.tenant.findFirst({ where: { domains: { has: customDomain } }, select: { id: true } });
      const companyUsing = await this.prisma.company.findFirst({ where: { customDomain, id: { not: companyId } }, select: { id: true } });
      if (tenantUsing || companyUsing) throw new ConflictException('Este domínio já está em uso.');
    }
    if (customDomain === company.customDomain) customDomain = undefined;
    await this.prisma.company.update({ where: { id: companyId }, data: { brandColor: input.brandColor === undefined ? undefined : input.brandColor, customDomain } });
    await this.audit.log({ action: 'company.brand.update', entityType: 'Company', entityId: companyId, before: { brandColor: company.brandColor, customDomain: company.customDomain }, after: { brandColor: input.brandColor, customDomain: input.customDomain } });
    return this.view(user, companyId);
  }

  /** Domínio próprio → tenant e loja (somente com o recurso de marca própria ativo no plano). */
  async resolve(host: string) {
    const company = await this.prisma.company.findUnique({ where: { customDomain: host.split(':')[0] }, select: { id: true, tenantId: true, slug: true, tradeName: true, brandColor: true, logoKey: true, status: true } });
    if (!company || company.status !== 'APPROVED') throw new NotFoundException('Domínio não configurado.');
    if (!(await this.subscriptions.hasFeature(company.tenantId, company.id, 'white_label'))) throw new NotFoundException('Domínio não configurado.');
    const tenant = await this.tenants.info(company.tenantId);
    if (tenant.status !== 'ACTIVE') throw new NotFoundException('Domínio não configurado.');
    return {
      tenant: { slug: tenant.slug, appName: tenant.appName },
      store: { slug: company.slug, tradeName: company.tradeName, brandColor: company.brandColor, logoUrl: this.storage.publicUrl(company.logoKey) },
    };
  }
}

@ApiTags('Empresas • Marca própria')
@ApiBearerAuth()
@Controller('companies/:companyId/brand')
export class CompanyBrandController {
  constructor(private readonly brand: CompanyBrandService) {}

  @Get()
  @CompanyPermission('company.profile.manage', 'companies.read')
  view(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.brand.view(user, companyId);
  }

  @Put()
  @RequireFeature('white_label')
  @CompanyPermission('company.profile.manage', 'companies.manage')
  @ApiOperation({ summary: 'Cor e domínio próprio da página da loja (plano com marca própria)' })
  update(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: CompanyBrandDto) {
    return this.brand.update(user, companyId, dto);
  }
}

@ApiTags('Marca (white label)')
@Controller('brands')
export class BrandResolveController {
  constructor(private readonly brand: CompanyBrandService) {}

  @Public()
  @Get('resolve')
  @ApiOperation({ summary: 'Resolve um domínio próprio de empresa (usado pelo portal para exibir a página da loja)' })
  resolve(@Query() query: ResolveQueryDto) {
    return this.brand.resolve(query.host);
  }
}

@Module({
  controllers: [CompanyBrandController, BrandResolveController],
  providers: [CompanyBrandService],
})
export class CompanyBrandModule {}
