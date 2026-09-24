import { Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, ConflictException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService, diff } from '../audit/audit.service';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { TenantId } from '../../common/tenant.decorator';
import type { AuthUser } from '../../common/auth/auth-user';
import { CompanyDocumentType, SegmentKind } from '../../generated/prisma/enums';

class SegmentDto {
  @ApiProperty({ example: 'farmacias' }) @Matches(/^[a-z0-9-]{2,40}$/) slug!: string;
  @ApiProperty() @IsString() @Length(2, 60) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string;
  @ApiPropertyOptional({ example: 'pill' }) @IsOptional() @IsString() @MaxLength(40) icon?: string;
  @ApiPropertyOptional({ enum: SegmentKind }) @IsOptional() @IsEnum(SegmentKind) kind?: SegmentKind;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRegulated?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(21) minimumAge?: number;
  @ApiPropertyOptional({ enum: CompanyDocumentType, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(CompanyDocumentType, { each: true })
  requiredDocuments?: CompanyDocumentType[];
}

class UpdateSegmentDto extends PartialType(SegmentDto) {}

@Injectable()
export class SegmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listActive(tenantId: string) {
    return this.prisma.segment.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, slug: true, name: true, description: true, icon: true, kind: true, isRegulated: true, minimumAge: true },
    });
  }

  listAll(tenantId: string) {
    return this.prisma.segment.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { companies: true } } },
    });
  }

  async create(tenantId: string, dto: SegmentDto) {
    if (await this.prisma.segment.findUnique({ where: { tenantId_slug: { tenantId, slug: dto.slug } } })) {
      throw new ConflictException('Já existe um segmento com este identificador.');
    }
    const segment = await this.prisma.segment.create({ data: { tenantId, ...dto } });
    await this.audit.log({ action: 'segment.create', entityType: 'Segment', entityId: segment.id, after: { ...dto } });
    return segment;
  }

  async update(tenantId: string, id: string, dto: UpdateSegmentDto) {
    const segment = await this.prisma.segment.findFirst({ where: { id, tenantId } });
    if (!segment) throw new NotFoundException('Segmento não encontrado.');
    const updated = await this.prisma.segment.update({ where: { id }, data: dto });
    await this.audit.log({ action: 'segment.update', entityType: 'Segment', entityId: id, ...diff(segment, updated) });
    return updated;
  }
}

@ApiTags('Segmentos')
@Controller()
export class SegmentsController {
  constructor(private readonly segments: SegmentsService) {}

  @Public()
  @Get('segments')
  @ApiOperation({ summary: 'Categorias exibidas na Home' })
  list(@TenantId() tenantId: string) {
    return this.segments.listActive(tenantId);
  }

  @ApiBearerAuth()
  @Get('admin/segments')
  @RequirePermissions('settings.manage')
  listAll(@CurrentUser() user: AuthUser) {
    return this.segments.listAll(user.tenantId);
  }

  @ApiBearerAuth()
  @Post('admin/segments')
  @RequirePermissions('settings.manage')
  create(@CurrentUser() user: AuthUser, @Body() dto: SegmentDto) {
    return this.segments.create(user.tenantId, dto);
  }

  @ApiBearerAuth()
  @Patch('admin/segments/:id')
  @RequirePermissions('settings.manage')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSegmentDto) {
    return this.segments.update(user.tenantId, id, dto);
  }
}

@Module({
  providers: [SegmentsService],
  controllers: [SegmentsController],
  exports: [SegmentsService],
})
export class SegmentsModule {}
