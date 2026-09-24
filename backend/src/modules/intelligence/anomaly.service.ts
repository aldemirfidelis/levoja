import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ANOMALY_KIND_LABELS, cityKey } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuditService } from '../audit/audit.service';
import { OperationsService, TowerAlert } from '../operations/operations.service';
import { utcTimestamp } from '../../common/sql';
import type { AuthUser } from '../../common/auth/auth-user';
import type { AnomalyKind, AnomalySeverity, AnomalyStatus } from '../../generated/prisma/enums';
import { binomialZ, demandDeviation, median } from './forecast.engine';

const HOUR = 3_600_000;
const floorHour = (date: Date) => new Date(Math.floor(date.getTime() / HOUR) * HOUR);

interface Detection {
  kind: AnomalyKind;
  severity: AnomalySeverity;
  city?: string | null;
  windowStart: Date;
  windowEnd: Date;
  observed: number;
  expected: number;
  zScore: number;
  message: string;
  dedupeKey: string;
}

const pct = (value: number) => `${(Math.round(value * 1000) / 10).toLocaleString('pt-BR')}%`;

/**
 * Detecção de anomalias operacionais (a cada 10 minutos):
 * - volume de entregas fora do intervalo previsto (pico ou queda — queda brusca costuma ser falha);
 * - pico de cancelamentos e de pagamentos recusados em relação aos últimos 7 dias;
 * - despacho muito mais lento que o normal.
 * Anomalias aparecem na torre de controle e são normalizadas automaticamente quando o indicador volta.
 */
@Injectable()
export class AnomalyService implements OnModuleInit {
  private readonly logger = new Logger(AnomalyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly operations: OperationsService,
  ) {}

  onModuleInit(): void {
    this.operations.registerAlertSource((tenantId) => this.towerAlerts(tenantId));
  }

  @Cron('0 */10 * * * *')
  async scan(now = new Date()) {
    const tenants = await this.prisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    for (const tenant of tenants) {
      try {
        await this.detect(tenant.id, now);
      } catch (error) {
        this.logger.error(`Detecção de anomalias do tenant ${tenant.id} falhou: ${(error as Error).message}`);
      }
    }
  }

  async detect(tenantId: string, now = new Date()) {
    const config = await this.settings.get(tenantId, 'intelligence');
    const options = { minVolume: config.anomalyMinVolume, zThreshold: config.anomalyZ };
    const detections: Detection[] = [];
    const normal = new Set<AnomalyKind>();
    const windowStart = new Date(now.getTime() - HOUR);
    const hourKey = floorHour(now).toISOString();

    // 1) Volume da última hora completa × previsão, por cidade.
    const lastHour = new Date(floorHour(now).getTime() - HOUR);
    const forecasts = await this.prisma.demandForecast.findMany({ where: { tenantId, hourStart: lastHour } });
    if (forecasts.length) {
      const rows = await this.prisma.$queryRaw<{ city: string | null; state: string | null; n: number }[]>`
        SELECT city, state, count(*)::int AS n FROM deliveries
        WHERE "tenantId" = ${tenantId}::uuid
          AND COALESCE("scheduledFor", "createdAt") >= ${utcTimestamp(lastHour)} AND COALESCE("scheduledFor", "createdAt") < ${utcTimestamp(new Date(lastHour.getTime() + HOUR))}
        GROUP BY 1, 2`;
      const actual = new Map<string, number>();
      for (const row of rows) {
        const key = cityKey(row.city, row.state);
        actual.set(key, (actual.get(key) ?? 0) + row.n);
      }
      for (const forecast of forecasts) {
        const observed = actual.get(forecast.city) ?? 0;
        const deviation = demandDeviation(observed, forecast, options);
        if (!deviation) continue;
        const drop = deviation.kind === 'DROP';
        detections.push({
          kind: drop ? 'DEMAND_DROP' : 'DEMAND_SPIKE',
          severity: Math.abs(deviation.z) >= options.zThreshold * 2 || (drop && observed === 0) ? 'CRITICAL' : 'WARNING',
          city: forecast.city,
          windowStart: lastHour,
          windowEnd: new Date(lastHour.getTime() + HOUR),
          observed,
          expected: forecast.predicted,
          zScore: deviation.z,
          message: drop
            ? `${forecast.city}: ${observed} entrega(s) na última hora, previsão de ${forecast.predicted.toLocaleString('pt-BR')}. Verifique falhas no app, pagamentos ou lojas fechadas.`
            : `${forecast.city}: ${observed} entrega(s) na última hora, previsão de ${forecast.predicted.toLocaleString('pt-BR')}. Reforce a oferta de entregadores.`,
          dedupeKey: `demand:${forecast.city}:${lastHour.toISOString()}`,
        });
      }
    }

    // 2) Cancelamentos (pedidos + entregas avulsas) na última hora × taxa dos últimos 7 dias.
    const weekAgo = new Date(now.getTime() - 7 * 24 * HOUR);
    const [recent] = await this.prisma.$queryRaw<{ created: number; canceled: number }[]>`
      SELECT
        ((SELECT count(*) FROM orders WHERE "tenantId" = ${tenantId}::uuid AND "createdAt" >= ${utcTimestamp(windowStart)})
         + (SELECT count(*) FROM deliveries WHERE "tenantId" = ${tenantId}::uuid AND "orderId" IS NULL AND "createdAt" >= ${utcTimestamp(windowStart)}))::int AS created,
        ((SELECT count(*) FROM orders WHERE "tenantId" = ${tenantId}::uuid AND "canceledAt" >= ${utcTimestamp(windowStart)})
         + (SELECT count(*) FROM deliveries WHERE "tenantId" = ${tenantId}::uuid AND "orderId" IS NULL AND "canceledAt" >= ${utcTimestamp(windowStart)}))::int AS canceled`;
    const [baseline] = await this.prisma.$queryRaw<{ created: number; canceled: number }[]>`
      SELECT
        ((SELECT count(*) FROM orders WHERE "tenantId" = ${tenantId}::uuid AND "createdAt" >= ${utcTimestamp(weekAgo)} AND "createdAt" < ${utcTimestamp(windowStart)})
         + (SELECT count(*) FROM deliveries WHERE "tenantId" = ${tenantId}::uuid AND "orderId" IS NULL AND "createdAt" >= ${utcTimestamp(weekAgo)} AND "createdAt" < ${utcTimestamp(windowStart)}))::int AS created,
        ((SELECT count(*) FROM orders WHERE "tenantId" = ${tenantId}::uuid AND "canceledAt" >= ${utcTimestamp(weekAgo)} AND "canceledAt" < ${utcTimestamp(windowStart)})
         + (SELECT count(*) FROM deliveries WHERE "tenantId" = ${tenantId}::uuid AND "orderId" IS NULL AND "canceledAt" >= ${utcTimestamp(weekAgo)} AND "canceledAt" < ${utcTimestamp(windowStart)}))::int AS canceled`;
    const cancelTotal = Math.max(recent.created, recent.canceled);
    const cancelBaseline = baseline.created > 0 ? baseline.canceled / baseline.created : 0.05;
    const cancelZ = binomialZ(recent.canceled, cancelTotal, cancelBaseline);
    if (cancelTotal >= options.minVolume && recent.canceled >= 3 && cancelZ >= options.zThreshold) {
      detections.push({
        kind: 'CANCELLATION_SPIKE',
        severity: cancelZ >= options.zThreshold * 2 ? 'CRITICAL' : 'WARNING',
        windowStart,
        windowEnd: now,
        observed: recent.canceled / cancelTotal,
        expected: cancelBaseline,
        zScore: cancelZ,
        message: `${recent.canceled} cancelamento(s) na última hora (${pct(recent.canceled / cancelTotal)}; normal ${pct(cancelBaseline)}).`,
        dedupeKey: `cancel:${hourKey}`,
      });
    } else normal.add('CANCELLATION_SPIKE');

    // 3) Pagamentos online recusados na última hora × últimos 7 dias.
    const payments = await this.prisma.$queryRaw<{ recent: boolean; total: number; failed: number }[]>`
      SELECT ("createdAt" >= ${utcTimestamp(windowStart)}) AS recent, count(*)::int AS total, (count(*) FILTER (WHERE status = 'FAILED'))::int AS failed
      FROM payments
      WHERE "tenantId" = ${tenantId}::uuid AND method IN ('PIX', 'CREDIT_CARD', 'DEBIT_CARD') AND "createdAt" >= ${utcTimestamp(weekAgo)}
      GROUP BY 1`;
    const paymentsNow = payments.find((row) => row.recent) ?? { total: 0, failed: 0 };
    const paymentsBefore = payments.find((row) => !row.recent) ?? { total: 0, failed: 0 };
    const failBaseline = paymentsBefore.total > 0 ? paymentsBefore.failed / paymentsBefore.total : 0.05;
    const failZ = binomialZ(paymentsNow.failed, paymentsNow.total, failBaseline);
    if (paymentsNow.total >= options.minVolume && paymentsNow.failed >= 3 && failZ >= options.zThreshold) {
      detections.push({
        kind: 'PAYMENT_FAILURE_SPIKE',
        severity: failZ >= options.zThreshold * 2 ? 'CRITICAL' : 'WARNING',
        windowStart,
        windowEnd: now,
        observed: paymentsNow.failed / paymentsNow.total,
        expected: failBaseline,
        zScore: failZ,
        message: `${paymentsNow.failed} de ${paymentsNow.total} pagamentos recusados na última hora (${pct(paymentsNow.failed / paymentsNow.total)}; normal ${pct(failBaseline)}). Verifique o provedor de pagamentos.`,
        dedupeKey: `payments:${hourKey}`,
      });
    } else normal.add('PAYMENT_FAILURE_SPIKE');

    // 4) Tempo até encontrar entregador na última hora × mediana dos últimos 7 dias.
    const waits = await this.prisma.$queryRaw<{ recent: boolean; minutes: number }[]>`
      SELECT ("assignedAt" >= ${utcTimestamp(windowStart)}) AS recent, (extract(epoch from ("assignedAt" - COALESCE("searchStartedAt", "createdAt"))) / 60)::float8 AS minutes
      FROM deliveries
      WHERE "tenantId" = ${tenantId}::uuid AND "assignedAt" >= ${utcTimestamp(weekAgo)} AND "assignedAt" >= COALESCE("searchStartedAt", "createdAt")
      LIMIT 20000`;
    const recentWaits = waits.filter((row) => row.recent).map((row) => row.minutes);
    const olderWaits = waits.filter((row) => !row.recent).map((row) => row.minutes);
    const current = median(recentWaits);
    const usual = median(olderWaits);
    if (current != null && usual != null && recentWaits.length >= options.minVolume && olderWaits.length >= 20) {
      const mad = median(olderWaits.map((value) => Math.abs(value - usual))) ?? 0;
      const z = Math.round(((current - usual) / Math.max(0.5, 1.4826 * mad)) * 100) / 100;
      if (current >= 5 && current >= usual * 2 && z >= options.zThreshold) {
        detections.push({
          kind: 'DISPATCH_DELAY',
          severity: current >= usual * 4 ? 'CRITICAL' : 'WARNING',
          windowStart,
          windowEnd: now,
          observed: Math.round(current * 10) / 10,
          expected: Math.round(usual * 10) / 10,
          zScore: z,
          message: `Entregas levaram ${Math.round(current)} min (mediana) para encontrar entregador na última hora; o normal é ${Math.round(usual)} min.`,
          dedupeKey: `dispatch:${hourKey}`,
        });
      } else normal.add('DISPATCH_DELAY');
    } else normal.add('DISPATCH_DELAY');

    const created: string[] = [];
    for (const detection of detections) {
      const existing = await this.prisma.opsAnomaly.findUnique({ where: { tenantId_dedupeKey: { tenantId, dedupeKey: detection.dedupeKey } } });
      if (existing) {
        await this.prisma.opsAnomaly.update({
          where: { id: existing.id },
          data: { observed: detection.observed, zScore: detection.zScore, message: detection.message, severity: detection.severity, windowEnd: detection.windowEnd },
        });
        continue;
      }
      const anomaly = await this.prisma.opsAnomaly.create({ data: { tenantId, ...detection, city: detection.city ?? null } });
      created.push(anomaly.id);
      this.realtime.toOps(tenantId, 'ops.anomaly', { id: anomaly.id, kind: anomaly.kind, severity: anomaly.severity, message: anomaly.message });
    }
    // Indicador voltou ao normal: encerra as anomalias abertas daquele tipo.
    if (normal.size) {
      await this.prisma.opsAnomaly.updateMany({ where: { tenantId, kind: { in: [...normal] }, status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, data: { status: 'RESOLVED', resolvedAt: now } });
    }
    // Desvios de volume valem para a hora em que ocorreram.
    await this.prisma.opsAnomaly.updateMany({
      where: { tenantId, kind: { in: ['DEMAND_SPIKE', 'DEMAND_DROP'] }, status: { in: ['OPEN', 'ACKNOWLEDGED'] }, windowEnd: { lt: new Date(now.getTime() - 2 * HOUR) } },
      data: { status: 'RESOLVED', resolvedAt: now },
    });
    return { detected: detections.length, created: created.length };
  }

  async list(tenantId: string, status?: AnomalyStatus) {
    return this.prisma.opsAnomaly.findMany({
      where: { tenantId, ...(status ? { status } : { status: { in: ['OPEN', 'ACKNOWLEDGED'] } }) },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });
  }

  async acknowledge(actor: AuthUser, id: string) {
    const updated = await this.prisma.opsAnomaly.updateMany({
      where: { id, tenantId: actor.tenantId, status: 'OPEN' },
      data: { status: 'ACKNOWLEDGED', acknowledgedById: actor.userId, acknowledgedAt: new Date() },
    });
    if (!updated.count) throw new ConflictException('Anomalia não encontrada ou já tratada.');
    await this.audit.log({ action: 'ops.anomaly.acknowledge', entityType: 'OpsAnomaly', entityId: id });
  }

  async resolve(actor: AuthUser, id: string) {
    const anomaly = await this.prisma.opsAnomaly.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!anomaly) throw new NotFoundException('Anomalia não encontrada.');
    if (anomaly.status === 'RESOLVED') throw new ConflictException('Esta anomalia já foi encerrada.');
    await this.prisma.opsAnomaly.update({ where: { id }, data: { status: 'RESOLVED', resolvedAt: new Date(), acknowledgedById: anomaly.acknowledgedById ?? actor.userId } });
    await this.audit.log({ action: 'ops.anomaly.resolve', entityType: 'OpsAnomaly', entityId: id });
  }

  /** Alertas extras da torre: anomalias abertas, casos de risco alto e sugestões de preço pendentes. */
  private async towerAlerts(tenantId: string): Promise<TowerAlert[]> {
    const [anomalies, highRisk, suggestions] = await Promise.all([
      this.prisma.opsAnomaly.findMany({ where: { tenantId, status: 'OPEN' }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.riskCase.count({ where: { tenantId, status: { in: ['OPEN', 'IN_REVIEW'] }, level: 'HIGH' } }),
      this.prisma.pricingSuggestion.count({ where: { tenantId, status: 'PENDING', windowEnd: { gt: new Date() } } }),
    ]);
    const alerts: TowerAlert[] = anomalies.map((anomaly) => ({
      type: 'anomaly',
      severity: anomaly.severity === 'CRITICAL' ? 'critical' : 'warning',
      message: `${ANOMALY_KIND_LABELS[anomaly.kind]}: ${anomaly.message}`,
      anomalyId: anomaly.id,
    }));
    if (highRisk) alerts.push({ type: 'risk_cases', severity: 'warning', message: `${highRisk} caso(s) de risco alto aguardando revisão no antifraude.` });
    if (suggestions) alerts.push({ type: 'pricing_suggestions', severity: 'warning', message: `${suggestions} sugestão(ões) de adicional por falta prevista de entregadores aguardando decisão.` });
    return alerts;
  }
}
