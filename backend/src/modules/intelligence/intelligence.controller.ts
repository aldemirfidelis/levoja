import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CompanyPermission, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { AiService } from './ai/ai.service';
import { AnomalyService } from './anomaly.service';
import { CompanyAssistantService } from './company-assistant.service';
import { EtaService } from './eta.service';
import { ForecastService } from './forecast.service';
import { FraudService } from './fraud.service';
import { ReviewInsightsService } from './review-insights.service';
import { SupportAssistService } from './support-assist.service';
import { SurchargesService } from './surcharges.service';
import {
  AnomaliesQueryDto,
  ApplySuggestionDto,
  AskAssistantDto,
  CityQueryDto,
  ConfirmCaseDto,
  DismissCaseDto,
  ManualSignalDto,
  ReviewSummaryQueryDto,
  RiskCasesQueryDto,
  RiskSignalsQueryDto,
  SuggestionsQueryDto,
  SurchargeDto,
} from './intelligence.dto';

const limit = (per: number) => ({ default: { limit: () => (process.env.NODE_ENV === 'test' ? 10_000 : per), ttl: 60_000 } });

@ApiTags('Admin • Antifraude')
@ApiBearerAuth()
@Controller('admin/intelligence/fraud')
export class FraudController {
  constructor(private readonly fraud: FraudService) {}

  @Get('overview')
  @RequirePermissions('fraud.read')
  overview(@CurrentUser() user: AuthUser) {
    return this.fraud.overview(user.tenantId);
  }

  @Get('cases')
  @RequirePermissions('fraud.read')
  @ApiOperation({ summary: 'Casos para revisão (padrão: abertos e em análise, do maior risco para o menor)' })
  cases(@CurrentUser() user: AuthUser, @Query() query: RiskCasesQueryDto) {
    return this.fraud.listCases(user.tenantId, query);
  }

  @Get('cases/:id')
  @RequirePermissions('fraud.read')
  getCase(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.fraud.getCase(user.tenantId, id);
  }

  @Post('cases/:id/review')
  @RequirePermissions('fraud.manage')
  review(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.fraud.startReview(user, id);
  }

  @Post('cases/:id/dismiss')
  @RequirePermissions('fraud.manage')
  @ApiOperation({ summary: 'Descartar (falso positivo) e isentar a conta das ações automáticas por um período' })
  dismiss(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DismissCaseDto) {
    return this.fraud.dismiss(user, id, dto.reason, dto.trustDays);
  }

  @Post('cases/:id/confirm')
  @RequirePermissions('fraud.manage')
  @ApiOperation({ summary: 'Confirmar a fraude (o bloqueio da conta é feito em /admin/users/:id/status)' })
  confirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmCaseDto) {
    return this.fraud.confirm(user, id, dto.reason);
  }

  @Get('signals')
  @RequirePermissions('fraud.read')
  signals(@CurrentUser() user: AuthUser, @Query() query: RiskSignalsQueryDto) {
    return this.fraud.listSignals(user.tenantId, query);
  }

  @Get('users/:userId')
  @RequirePermissions('fraud.read')
  @ApiOperation({ summary: 'Perfil de risco de uma conta: score, sinais, aparelhos e contas relacionadas' })
  subject(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.fraud.subject(user.tenantId, userId);
  }

  @Post('users/:userId/signals')
  @RequirePermissions('fraud.manage')
  manualSignal(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: ManualSignalDto) {
    return this.fraud.addManualSignal(user, userId, dto.message, dto.points);
  }

  @Post('users/:userId/revoke-trust')
  @RequirePermissions('fraud.manage')
  revokeTrust(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.fraud.revokeTrust(user, userId);
  }

  @Post('scan')
  @RequirePermissions('fraud.manage')
  @ApiOperation({ summary: 'Executar agora a varredura de cancelamentos e desistências (roda toda madrugada)' })
  scan(@CurrentUser() user: AuthUser) {
    return this.fraud.scanTenant(user.tenantId);
  }
}

@ApiTags('Admin • Inteligência')
@ApiBearerAuth()
@Controller('admin/intelligence')
export class IntelligenceController {
  constructor(
    private readonly forecast: ForecastService,
    private readonly anomalies: AnomalyService,
    private readonly eta: EtaService,
    private readonly surcharges: SurchargesService,
    private readonly reviews: ReviewInsightsService,
    private readonly support: SupportAssistService,
    private readonly ai: AiService,
  ) {}

  @Get('forecast')
  @RequirePermissions('operations.view')
  @ApiOperation({ summary: 'Previsão de demanda e de entregadores por cidade (últimas 24 h + próximas horas) e precisão' })
  forecastView(@CurrentUser() user: AuthUser, @Query() query: CityQueryDto) {
    return this.forecast.view(user.tenantId, query.city);
  }

  @Post('forecast/run')
  @RequirePermissions('operations.view')
  @Throttle(limit(6))
  runForecast(@CurrentUser() user: AuthUser) {
    return this.forecast.run(user.tenantId);
  }

  @Get('anomalies')
  @RequirePermissions('operations.view')
  anomaliesList(@CurrentUser() user: AuthUser, @Query() query: AnomaliesQueryDto) {
    return this.anomalies.list(user.tenantId, query.status);
  }

  @Post('anomalies/scan')
  @RequirePermissions('operations.view')
  @Throttle(limit(6))
  scanAnomalies(@CurrentUser() user: AuthUser) {
    return this.anomalies.detect(user.tenantId);
  }

  @Post('anomalies/:id/acknowledge')
  @HttpCode(204)
  @RequirePermissions('operations.view')
  async acknowledge(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.anomalies.acknowledge(user, id);
  }

  @Post('anomalies/:id/resolve')
  @HttpCode(204)
  @RequirePermissions('operations.view')
  async resolve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.anomalies.resolve(user, id);
  }

  @Get('eta')
  @RequirePermissions('operations.view')
  @ApiOperation({ summary: 'Calibração do tempo de entrega (fatores, esperas e erro médio) e preparo real das lojas' })
  etaView(@CurrentUser() user: AuthUser) {
    return this.eta.view(user.tenantId);
  }

  @Post('eta/calibrate')
  @RequirePermissions('operations.view')
  @Throttle(limit(6))
  async calibrate(@CurrentUser() user: AuthUser) {
    const calibration = await this.eta.calibrate(user.tenantId);
    const companies = await this.eta.learnPrepTimes(user.tenantId);
    return { ...calibration, companies };
  }

  @Get('pricing/suggestions')
  @RequirePermissions('pricing.read')
  suggestions(@CurrentUser() user: AuthUser, @Query() query: SuggestionsQueryDto) {
    return this.surcharges.suggestions(user.tenantId, query.status);
  }

  @Post('pricing/suggestions/:id/apply')
  @RequirePermissions('pricing.manage')
  @ApiOperation({ summary: 'Aprovar a sugestão: cria o adicional programado (percentual pode ser ajustado)' })
  apply(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplySuggestionDto) {
    return this.surcharges.applySuggestion(user, id, dto.surchargeBps);
  }

  @Post('pricing/suggestions/:id/dismiss')
  @HttpCode(204)
  @RequirePermissions('pricing.manage')
  async dismissSuggestion(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.surcharges.dismissSuggestion(user, id);
  }

  @Get('pricing/surcharges')
  @RequirePermissions('pricing.read')
  surchargesList(@CurrentUser() user: AuthUser) {
    return this.surcharges.list(user.tenantId);
  }

  @Post('pricing/surcharges')
  @RequirePermissions('pricing.manage')
  createSurcharge(@CurrentUser() user: AuthUser, @Body() dto: SurchargeDto) {
    return this.surcharges.create(user, dto);
  }

  @Post('pricing/surcharges/:id/cancel')
  @HttpCode(204)
  @RequirePermissions('pricing.manage')
  async cancelSurcharge(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.surcharges.cancel(user, id);
  }

  @Get('reviews/summary')
  @RequirePermissions('reviews.moderate')
  @ApiOperation({ summary: 'Sentimento e temas das avaliações (plataforma, uma loja, um entregador)' })
  reviewSummary(@CurrentUser() user: AuthUser, @Query() query: ReviewSummaryQueryDto) {
    return this.reviews.summary(user.tenantId, query);
  }

  @Post('reviews/process')
  @RequirePermissions('reviews.moderate')
  @Throttle(limit(6))
  processReviews() {
    return this.reviews.process();
  }

  @Post('support/:ticketId/draft')
  @RequirePermissions('support.tickets.manage')
  @Throttle(limit(20))
  @ApiOperation({ summary: 'Rascunho de resposta para o chamado (não é enviado: o atendente revisa e envia)' })
  draft(@CurrentUser() user: AuthUser, @Param('ticketId', ParseUUIDPipe) ticketId: string) {
    return this.support.draft(user, ticketId);
  }

  @Get('ai')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Provedor de IA, recursos habilitados e uso nos últimos 30 dias' })
  aiStatus(@CurrentUser() user: AuthUser) {
    return this.ai.status(user.tenantId);
  }
}

@ApiTags('Empresas • Assistente')
@ApiBearerAuth()
@Controller('companies/:companyId/assistant')
export class CompanyAssistantController {
  constructor(private readonly assistant: CompanyAssistantService) {}

  @Get()
  @CompanyPermission('company.reports.read', 'reports.read')
  @ApiOperation({ summary: 'Indicadores, previsão de pedidos e recomendações da loja' })
  insights(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.assistant.insights(user, companyId);
  }

  @Post('ask')
  @HttpCode(200)
  @CompanyPermission('company.reports.read', 'reports.read')
  @Throttle(limit(10))
  @ApiOperation({ summary: 'Pergunta ao assistente (IA com acesso somente leitura aos dados da loja)' })
  ask(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: AskAssistantDto) {
    return this.assistant.ask(user, companyId, dto.messages);
  }
}
