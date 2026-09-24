import { Controller, Get, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { ForbiddenException } from '@nestjs/common';

@ApiTags('Admin • Dashboard')
@ApiBearerAuth()
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Indicadores gerais da plataforma' })
  async dashboard(@CurrentUser() user: AuthUser) {
    if (!user.isStaff) throw new ForbiddenException('Acesso restrito à equipe.');
    const tenantId = user.tenantId;
    const since = new Date(Date.now() - 30 * 86_400_000);

    const [usersTotal, usersNew30d, customers, companiesByStatus, driversByStatus, pendingCompanyDocs, pendingDriverDocs, privacyOpen, recentActivity] =
      await Promise.all([
        this.prisma.user.count({ where: { tenantId, anonymizedAt: null } }),
        this.prisma.user.count({ where: { tenantId, createdAt: { gte: since } } }),
        this.prisma.customer.count({ where: { tenantId } }),
        this.prisma.company.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
        this.prisma.driver.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
        this.prisma.companyDocument.count({ where: { status: 'PENDING', company: { tenantId, status: 'UNDER_REVIEW' } } }),
        this.prisma.driverDocument.count({ where: { status: 'PENDING', driver: { tenantId, status: 'UNDER_REVIEW' } } }),
        this.prisma.privacyRequest.count({ where: { tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
        user.can('audit.read')
          ? this.prisma.auditLog.findMany({
              where: { tenantId },
              orderBy: { createdAt: 'desc' },
              take: 10,
              select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, actor: { select: { name: true } } },
            })
          : Promise.resolve([]),
      ]);

    const toMap = (rows: { status: string; _count: { _all: number } }[]) =>
      Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
    const companies = toMap(companiesByStatus);
    const drivers = toMap(driversByStatus);
    const sum = (map: Record<string, number>) => Object.values(map).reduce((total, value) => total + value, 0);

    return {
      users: { total: usersTotal, newLast30Days: usersNew30d, customers },
      companies: { total: sum(companies), byStatus: companies, awaitingReview: companies.UNDER_REVIEW ?? 0 },
      drivers: { total: sum(drivers), byStatus: drivers, awaitingReview: drivers.UNDER_REVIEW ?? 0 },
      pendingDocuments: { companies: pendingCompanyDocs, drivers: pendingDriverDocs },
      privacyRequestsOpen: privacyOpen,
      recentActivity,
    };
  }
}

@Module({ controllers: [AdminDashboardController] })
export class AdminModule {}
