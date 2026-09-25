import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AllowApiKey, CompanyPermission, Public, RequireFeature } from '../../common/decorators';
import { TenantId } from '../../common/tenant.decorator';
import type { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { UploadedFileLike } from '../../infra/storage/file-validation';
import { FILE_BODY, IMAGE_UPLOAD } from '../users/users.controller';
import { CatalogService } from './catalog.service';
import { ServiceAreasService } from './service-areas.service';
import { StoresService } from './stores.service';
import {
  CategoryDto,
  ProductDto,
  ProductsQueryDto,
  ServiceAreaDto,
  StockAdjustmentDto,
  StoresQueryDto,
  UpdateCategoryDto,
  UpdateProductDto,
} from './catalog.dto';

@ApiTags('Vitrine (público)')
@Controller('stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Estabelecimentos que atendem a localização (lat/lng ou endereço salvo)' })
  list(@TenantId() tenantId: string, @Req() request: Request & { user?: AuthUser }, @Query() query: StoresQueryDto) {
    return this.stores.list(tenantId, request.user, query);
  }

  @Public()
  @Get(':idOrSlug')
  @ApiOperation({ summary: 'Loja com categorias e produtos disponíveis' })
  detail(@TenantId() tenantId: string, @Param('idOrSlug') idOrSlug: string) {
    return this.stores.detail(tenantId, idOrSlug);
  }
}

@ApiTags('Empresas • Catálogo')
@ApiBearerAuth()
@RequireFeature('catalog')
@Controller('companies/:companyId')
export class CompanyCatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly areas: ServiceAreasService,
    private readonly prisma: PrismaService,
  ) {}

  // --- Categorias ---

  @Get('categories')
  @AllowApiKey('catalog:read')
  @CompanyPermission('company.products.read', 'companies.read')
  categories(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.catalog.listCategories(companyId);
  }

  @Post('categories')
  @CompanyPermission('company.products.manage')
  createCategory(@Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: CategoryDto) {
    return this.catalog.createCategory(companyId, dto);
  }

  @Patch('categories/:id')
  @CompanyPermission('company.products.manage')
  updateCategory(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.catalog.updateCategory(companyId, id, dto);
  }

  @Delete('categories/:id')
  @HttpCode(204)
  @CompanyPermission('company.products.manage')
  async deleteCategory(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.catalog.deleteCategory(companyId, id);
  }

  // --- Produtos ---

  @Get('products')
  @AllowApiKey('catalog:read')
  @CompanyPermission('company.products.read', 'companies.read')
  products(@Param('companyId', ParseUUIDPipe) companyId: string, @Query() query: ProductsQueryDto) {
    return this.catalog.listProducts(companyId, query);
  }

  @Get('products/:id')
  @AllowApiKey('catalog:read')
  @CompanyPermission('company.products.read', 'companies.read')
  product(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getProduct(companyId, id);
  }

  @Post('products')
  @AllowApiKey('catalog:write')
  @CompanyPermission('company.products.manage')
  @ApiOperation({ summary: 'Cadastrar produto (com variações, adicionais ou itens de combo)' })
  async createProduct(@Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: ProductDto) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { id: true, tenantId: true } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    return this.catalog.createProduct(company, dto);
  }

  @Patch('products/:id')
  @AllowApiKey('catalog:write')
  @CompanyPermission('company.products.manage')
  updateProduct(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.catalog.updateProduct(companyId, id, dto);
  }

  @Delete('products/:id')
  @HttpCode(204)
  @CompanyPermission('company.products.manage')
  async deleteProduct(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.catalog.deleteProduct(companyId, id);
  }

  @Post('products/:id/stock')
  @AllowApiKey('catalog:write')
  @CompanyPermission('company.products.manage')
  @ApiOperation({ summary: 'Entrada/saída de estoque' })
  adjustStock(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StockAdjustmentDto) {
    return this.catalog.adjustStock(companyId, id, dto.delta, dto.reason);
  }

  @Post('products/:id/images')
  @CompanyPermission('company.products.manage')
  @UseInterceptors(IMAGE_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  addImage(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedFileLike) {
    return this.catalog.addImage(companyId, id, file);
  }

  @Delete('products/:id/images/:imageId')
  @CompanyPermission('company.products.manage')
  removeImage(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.catalog.removeImage(companyId, id, imageId);
  }

  // --- Áreas de atendimento ---

  @Get('service-areas')
  @RequireFeature(null)
  @CompanyPermission('company.profile.manage', 'companies.read')
  serviceAreas(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.areas.list(companyId);
  }

  @Post('service-areas')
  @RequireFeature(null)
  @CompanyPermission('company.profile.manage')
  createArea(@Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: ServiceAreaDto) {
    return this.areas.create(companyId, dto);
  }

  @Put('service-areas/:id')
  @RequireFeature(null)
  @CompanyPermission('company.profile.manage')
  updateArea(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ServiceAreaDto) {
    return this.areas.update(companyId, id, dto);
  }

  @Delete('service-areas/:id')
  @RequireFeature(null)
  @HttpCode(204)
  @CompanyPermission('company.profile.manage')
  async deleteArea(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.areas.remove(companyId, id);
  }
}
