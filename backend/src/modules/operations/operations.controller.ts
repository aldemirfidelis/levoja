import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CompanyPermission, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { AuditService } from '../audit/audit.service';
import { OperationsService } from './operations.service';
import { ReportKind, ReportsService } from './reports.service';
import { CompanyDashboardQueryDto, HeatmapQueryDto, ReportQueryDto, SnapshotQueryDto } from './operations.dto';

@ApiTags('Admin • Operação')
@ApiBearerAuth()
@Controller('admin/operations')
@RequirePermissions('operations.view')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('snapshot')
  @ApiOperation({ summary: 'Torre de controle: entregadores, entregas em aberto, atrasos, indicadores do dia, oferta x demanda e alertas' })
  snapshot(@CurrentUser() user: AuthUser, @Query() query: SnapshotQueryDto) {
    return this.operations.snapshot(user, query);
  }

  @Get('heatmap')
  @ApiOperation({ summary: 'Mapa de calor: demanda, pedidos, entregas ou disponibilidade de entregadores' })
  heatmap(@CurrentUser() user: AuthUser, @Query() query: HeatmapQueryDto) {
    return this.operations.heatmap(user, query);
  }

  @Get('cities')
  @ApiOperation({ summary: 'Cidades com operação recente (filtros)' })
  cities(@CurrentUser() user: AuthUser) {
    return this.operations.cities(user);
  }
}

@ApiTags('Admin • Relatórios')
@ApiBearerAuth()
@Controller('admin/reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  private async respond(kind: ReportKind, user: AuthUser, query: ReportQueryDto, response: Response) {
    const result = await this.reports.report(kind, user, query);
    if (query.format !== 'csv') return result;
    const tableKey = query.table ?? Object.keys(result.tables)[0];
    const table = Object.hasOwn(result.tables, tableKey) ? result.tables[tableKey] : undefined;
    if (!table) throw new BadRequestException(`Tabela inválida. Opções: ${Object.keys(result.tables).join(', ')}.`);
    await this.audit.log({ action: 'report.export', entityType: 'Report', metadata: { kind, table: tableKey, from: result.range.from, to: result.range.to } });
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="levoja-${kind}-${tableKey}-${result.range.from}_${result.range.to}.csv"`);
    response.setHeader('Cache-Control', 'private, no-store');
    return this.reports.toCsv(table);
  }

  @Get('commercial')
  @RequirePermissions('reports.read')
  @ApiProduces('application/json', 'text/csv')
  @ApiOperation({ summary: 'Comercial: vendas, ticket médio, clientes e empresas' })
  commercial(@CurrentUser() user: AuthUser, @Query() query: ReportQueryDto, @Res({ passthrough: true }) response: Response) {
    return this.respond('commercial', user, query, response);
  }

  @Get('operational')
  @RequirePermissions('reports.read')
  @ApiProduces('application/json', 'text/csv')
  @ApiOperation({ summary: 'Operacional: entregas, SLA, atrasos e cancelamentos' })
  operational(@CurrentUser() user: AuthUser, @Query() query: ReportQueryDto, @Res({ passthrough: true }) response: Response) {
    return this.respond('operational', user, query, response);
  }

  @Get('financial')
  @RequirePermissions('finance.reports')
  @ApiProduces('application/json', 'text/csv')
  @ApiOperation({ summary: 'Financeiro: receita, comissão, taxas, pagamentos e estornos' })
  financial(@CurrentUser() user: AuthUser, @Query() query: ReportQueryDto, @Res({ passthrough: true }) response: Response) {
    return this.respond('financial', user, query, response);
  }

  @Get('corporate')
  @RequirePermissions('reports.read')
  @ApiProduces('application/json', 'text/csv')
  @ApiOperation({ summary: 'Corporativo (por empresa): entregas, gasto, SLA e centros de custo' })
  corporate(@CurrentUser() user: AuthUser, @Query() query: ReportQueryDto, @Res({ passthrough: true }) response: Response) {
    if (!query.companyId) throw new BadRequestException('Escolha a empresa.');
    return this.respond('corporate', user, query, response);
  }

  @Get('drivers')
  @RequirePermissions('reports.read')
  @ApiProduces('application/json', 'text/csv')
  @ApiOperation({ summary: 'Entregadores: ganhos, entregas, km e avaliações' })
  drivers(@CurrentUser() user: AuthUser, @Query() query: ReportQueryDto, @Res({ passthrough: true }) response: Response) {
    return this.respond('drivers', user, query, response);
  }
}

@ApiTags('Empresas • Indicadores')
@ApiBearerAuth()
@Controller('companies/:companyId/dashboard')
export class CompanyDashboardController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @CompanyPermission('company.reports.read', 'reports.read')
  @ApiOperation({ summary: 'Vendas, pedidos, ticket médio, receita, taxas, avaliações, tempos, conversão e produtos mais vendidos' })
  dashboard(@Param('companyId', ParseUUIDPipe) companyId: string, @Query() query: CompanyDashboardQueryDto) {
    return this.reports.companyDashboard(companyId, query.period);
  }
}
