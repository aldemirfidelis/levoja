import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { paginated, PaginationQueryDto, skipOf } from '../../common/pagination';
import { Prisma } from '../../generated/prisma/client';

class AuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() entityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

@ApiTags('Admin • Auditoria')
@ApiBearerAuth()
@Controller('admin/audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('audit.read')
  @ApiOperation({ summary: 'Consultar a trilha de auditoria' })
  async list(@CurrentUser() user: AuthUser, @Query() query: AuditQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      tenantId: user.tenantId,
      action: query.action ? { startsWith: query.action } : undefined,
      entityType: query.entityType,
      entityId: query.entityId,
      actorId: query.actorId,
      createdAt: query.from || query.to ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined } : undefined,
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: skipOf(query),
        take: query.pageSize,
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
    ]);
    return paginated(rows, total, query);
  }
}
