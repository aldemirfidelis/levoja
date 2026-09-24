import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { cityKey } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { utcTimestamp } from '../../common/sql';
import { SettingsService, SettingValue } from '../settings/settings.service';
import { driversNeeded, forecastAccuracy, seasonalForecast, trendFactor } from './forecast.engine';

type IntelligenceSettings = SettingValue<'intelligence'>;

const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;
const floorHour = (date: Date) => new Date(Math.floor(date.getTime() / HOUR) * HOUR);

interface CityHistory {
  key: string;
  label: string;
  /** hora (ms) → entregas solicitadas */
  hours: Map<number, number>;
  firstHour: number;
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

/**
 * Previsão de demanda por cidade (entregas solicitadas por hora) e da necessidade de
 * entregadores, comparada à presença habitual de entregadores na mesma hora. Recalculada a
 * cada hora; quando a falta prevista passa do limite configurado, gera uma sugestão de adicional
 * de preço — que só vale depois de aprovada por uma pessoa com permissão de precificação.
 */
@Injectable()
export class ForecastService {
  private readonly logger = new Logger(ForecastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Cron('0 5 * * * *')
  async hourly(now = new Date()) {
    const tenants = await this.prisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    for (const tenant of tenants) {
      try {
        await this.run(tenant.id, now);
      } catch (error) {
        this.logger.error(`Previsão do tenant ${tenant.id} falhou: ${(error as Error).message}`);
      }
    }
  }

  /** Histórico horário por cidade (normalizada), com a área de atuação para medir a presença. */
  private async history(tenantId: string, since: Date, until: Date): Promise<Map<string, CityHistory>> {
    const rows = await this.prisma.$queryRaw<{ city: string; state: string | null; hour: number; n: number; minLat: number; maxLat: number; minLng: number; maxLng: number }[]>`
      SELECT city, state, (extract(epoch from date_trunc('hour', COALESCE("scheduledFor", "createdAt"))) * 1000)::float8 AS hour, count(*)::int AS n,
             min("pickupLat") AS "minLat", max("pickupLat") AS "maxLat", min("pickupLng") AS "minLng", max("pickupLng") AS "maxLng"
      FROM deliveries
      WHERE "tenantId" = ${tenantId}::uuid AND city IS NOT NULL
        AND COALESCE("scheduledFor", "createdAt") >= ${utcTimestamp(since)} AND COALESCE("scheduledFor", "createdAt") < ${utcTimestamp(until)}
      GROUP BY 1, 2, 3`;
    const cities = new Map<string, CityHistory & { labels: Map<string, number> }>();
    for (const row of rows) {
      const key = cityKey(row.city, row.state);
      let entry = cities.get(key);
      if (!entry) {
        entry = { key, label: '', labels: new Map(), hours: new Map(), firstHour: Infinity, bbox: { minLat: row.minLat, maxLat: row.maxLat, minLng: row.minLng, maxLng: row.maxLng } };
        cities.set(key, entry);
      }
      const hour = Number(row.hour);
      entry.hours.set(hour, (entry.hours.get(hour) ?? 0) + row.n);
      entry.firstHour = Math.min(entry.firstHour, hour);
      const label = `${row.city}${row.state ? `/${row.state.toUpperCase()}` : ''}`;
      entry.labels.set(label, (entry.labels.get(label) ?? 0) + row.n);
      entry.bbox = {
        minLat: Math.min(entry.bbox.minLat, row.minLat),
        maxLat: Math.max(entry.bbox.maxLat, row.maxLat),
        minLng: Math.min(entry.bbox.minLng, row.minLng),
        maxLng: Math.max(entry.bbox.maxLng, row.maxLng),
      };
    }
    for (const entry of cities.values()) entry.label = [...entry.labels.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return cities;
  }

  /** Média de entregadores online por hora na área da cidade (amostras agregadas da torre). */
  private async presence(tenantId: string, bbox: CityHistory['bbox'], since: Date, until: Date): Promise<Map<number, number>> {
    const pad = 0.03;
    const rows = await this.prisma.$queryRaw<{ hour: number; online: number }[]>`
      SELECT (extract(epoch from date_trunc('hour', "bucketStart")) * 1000)::float8 AS hour, avg(total)::float8 AS online
      FROM (
        SELECT "bucketStart", sum("onlineCount") AS total
        FROM driver_presence_samples
        WHERE "tenantId" = ${tenantId}::uuid AND "bucketStart" >= ${utcTimestamp(since)} AND "bucketStart" < ${utcTimestamp(until)}
          AND lat BETWEEN ${bbox.minLat - pad} AND ${bbox.maxLat + pad}
          AND lng BETWEEN ${bbox.minLng - pad} AND ${bbox.maxLng + pad}
        GROUP BY "bucketStart"
      ) buckets
      GROUP BY 1`;
    return new Map(rows.map((row) => [Number(row.hour), Math.round(row.online * 10) / 10]));
  }

  /** Gera/atualiza as previsões das próximas horas, registra o realizado e as sugestões de preço. */
  async run(tenantId: string, now = new Date()) {
    const config = await this.settings.get(tenantId, 'intelligence');
    const current = floorHour(now);
    const since = new Date(current.getTime() - config.forecastWeeks * WEEK);
    const cities = await this.history(tenantId, since, new Date(current.getTime() + config.horizonHours * HOUR));
    let forecasts = 0;
    for (const city of cities.values()) {
      const presence = await this.presence(tenantId, city.bbox, since, current);
      const past = (hour: number) => (hour >= city.firstHour && hour < current.getTime() ? (city.hours.get(hour) ?? 0) : null);
      const sumRange = (from: number, to: number) => {
        let total = 0;
        for (let hour = from; hour < to; hour += HOUR) total += city.hours.get(hour) ?? 0;
        return total;
      };
      const trend = trendFactor(sumRange(current.getTime() - WEEK, current.getTime()), sumRange(current.getTime() - 2 * WEEK, current.getTime() - WEEK));

      const rows: { hourStart: Date; predicted: number; low: number; high: number; driversNeeded: number; driversExpected: number | null }[] = [];
      for (let step = 0; step < config.horizonHours; step++) {
        const target = current.getTime() + step * HOUR;
        const samples: number[] = [];
        const supply: number[] = [];
        for (let week = 1; week <= config.forecastWeeks; week++) {
          const value = past(target - week * WEEK);
          if (value != null) samples.push(value);
          const online = presence.get(target - week * WEEK);
          if (online != null) supply.push(online);
        }
        if (!samples.length) continue;
        const forecast = seasonalForecast(samples, trend);
        // Entregas já agendadas para a hora são um piso da previsão.
        const booked = city.hours.get(target) ?? 0;
        if (booked > forecast.predicted) {
          const shift = booked - forecast.predicted;
          forecast.predicted = booked;
          forecast.low = Math.max(booked, Math.round((forecast.low + shift) * 10) / 10);
          forecast.high = Math.round((forecast.high + shift) * 10) / 10;
        }
        rows.push({
          hourStart: new Date(target),
          ...forecast,
          driversNeeded: driversNeeded(forecast.predicted, config.deliveriesPerDriverHour),
          driversExpected: supply.length ? seasonalForecast(supply).predicted : null,
        });
      }
      for (const row of rows) {
        await this.prisma.demandForecast.upsert({
          where: { tenantId_city_hourStart: { tenantId, city: city.key, hourStart: row.hourStart } },
          create: { tenantId, city: city.key, ...row },
          update: { ...row, generatedAt: new Date() },
        });
      }
      forecasts += rows.length;

      // Realizado das horas encerradas (última semana).
      const open = await this.prisma.demandForecast.findMany({
        where: { tenantId, city: city.key, hourStart: { gte: new Date(current.getTime() - WEEK), lt: current }, actual: null },
        select: { id: true, hourStart: true },
      });
      for (const row of open) {
        await this.prisma.demandForecast.update({
          where: { id: row.id },
          data: { actual: city.hours.get(row.hourStart.getTime()) ?? 0, driversOnline: presence.get(row.hourStart.getTime()) ?? null },
        });
      }
      if (config.suggestSurcharges) await this.suggest(tenantId, city.key, rows, config);
    }
    // Sugestões cujo horário já passou sem decisão.
    await this.prisma.pricingSuggestion.updateMany({ where: { tenantId, status: 'PENDING', windowEnd: { lte: now } }, data: { status: 'EXPIRED' } });
    return { cities: cities.size, forecasts };
  }

  /**
   * Horas seguidas com falta prevista de entregadores (necessários acima de esperados × limite)
   * viram uma sugestão de adicional proporcional à falta, limitada pelo teto configurado.
   */
  private async suggest(tenantId: string, city: string, rows: { hourStart: Date; predicted: number; driversNeeded: number; driversExpected: number | null }[], config: IntelligenceSettings) {
    const short = rows.filter((row) => row.driversExpected != null && row.driversNeeded >= 2 && row.driversNeeded > Math.max(0.5, row.driversExpected) * config.shortageRatio);
    const windows: (typeof short)[] = [];
    for (const row of short) {
      const last = windows.at(-1);
      if (last && row.hourStart.getTime() - last[last.length - 1].hourStart.getTime() === HOUR) last.push(row);
      else windows.push([row]);
    }
    for (const window of windows) {
      const start = window[0].hourStart;
      const end = new Date(window[window.length - 1].hourStart.getTime() + HOUR);
      if (end.getTime() <= Date.now()) continue;
      const needed = Math.max(...window.map((row) => row.driversNeeded));
      const expected = Math.min(...window.map((row) => row.driversExpected ?? 0));
      const ratio = needed / Math.max(0.5, expected);
      const bps = Math.min(config.maxSurchargeBps, Math.max(500, Math.round(((ratio - 1) * 4000) / 50) * 50));
      if (bps <= 0) continue;
      const predicted = Math.round(window.reduce((sum, row) => sum + row.predicted, 0) * 10) / 10;
      // Já existe adicional programado cobrindo o período: nada a sugerir.
      const covered = await this.prisma.pricingSurcharge.count({ where: { tenantId, canceledAt: null, startsAt: { lte: start }, endsAt: { gte: end }, OR: [{ city }, { city: null }] } });
      if (covered) continue;
      const reason = `Previsão de ${predicted.toLocaleString('pt-BR')} entrega(s) exigindo até ${needed} entregador(es); normalmente há ${expected.toLocaleString('pt-BR')} online nesse horário.`;
      const existing = await this.prisma.pricingSuggestion.findUnique({ where: { tenantId_city_windowStart: { tenantId, city, windowStart: start } } });
      if (existing && existing.status !== 'PENDING') continue;
      await this.prisma.pricingSuggestion.upsert({
        where: { tenantId_city_windowStart: { tenantId, city, windowStart: start } },
        create: { tenantId, city, windowStart: start, windowEnd: end, surchargeBps: bps, predicted, driversNeeded: needed, driversExpected: expected, reason },
        update: { windowEnd: end, surchargeBps: bps, predicted, driversNeeded: needed, driversExpected: expected, reason },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Consulta (painel)
  // ---------------------------------------------------------------------------

  async cities(tenantId: string) {
    const rows = await this.prisma.delivery.groupBy({
      by: ['city', 'state'],
      where: { tenantId, city: { not: null }, createdAt: { gte: new Date(Date.now() - 12 * WEEK) } },
      _count: { _all: true },
      orderBy: { _count: { city: 'desc' } },
      take: 200,
    });
    const merged = new Map<string, { key: string; label: string; deliveries: number }>();
    for (const row of rows) {
      const key = cityKey(row.city, row.state);
      const entry = merged.get(key);
      if (entry) entry.deliveries += row._count._all;
      else merged.set(key, { key, label: `${row.city}${row.state ? `/${row.state.toUpperCase()}` : ''}`, deliveries: row._count._all });
    }
    return [...merged.values()].sort((a, b) => b.deliveries - a.deliveries);
  }

  /** Série (últimas 24 h + horizonte) e precisão dos últimos 7 dias para uma cidade. */
  async view(tenantId: string, city?: string) {
    const cities = await this.cities(tenantId);
    const selected = city && cities.some((item) => item.key === city) ? city : cities[0]?.key;
    if (!selected) return { cities, city: null, series: [], accuracy: null, next24h: null, generatedAt: null };
    const now = floorHour(new Date());
    const [series, history] = await Promise.all([
      this.prisma.demandForecast.findMany({
        where: { tenantId, city: selected, hourStart: { gte: new Date(now.getTime() - 24 * HOUR), lt: new Date(now.getTime() + 7 * 24 * HOUR) } },
        orderBy: { hourStart: 'asc' },
      }),
      this.prisma.demandForecast.findMany({
        where: { tenantId, city: selected, hourStart: { gte: new Date(now.getTime() - WEEK), lt: now }, actual: { not: null } },
        select: { predicted: true, actual: true, low: true, high: true },
      }),
    ]);
    const accuracy = forecastAccuracy(history.map((row) => ({ predicted: row.predicted, actual: row.actual ?? 0 })));
    const inside = history.filter((row) => row.actual! >= Math.floor(row.low) && row.actual! <= Math.ceil(row.high)).length;
    const upcoming = series.filter((row) => row.hourStart >= now && row.hourStart.getTime() < now.getTime() + 24 * HOUR);
    const peak = upcoming.reduce<(typeof upcoming)[number] | null>((best, row) => (!best || row.predicted > best.predicted ? row : best), null);
    return {
      cities,
      city: selected,
      generatedAt: series.reduce<Date | null>((latest, row) => (!latest || row.generatedAt > latest ? row.generatedAt : latest), null),
      series: series.map((row) => ({
        hourStart: row.hourStart,
        predicted: row.predicted,
        low: row.low,
        high: row.high,
        driversNeeded: row.driversNeeded,
        driversExpected: row.driversExpected,
        actual: row.actual,
        driversOnline: row.driversOnline,
      })),
      accuracy: { ...accuracy, withinInterval: history.length ? Math.round((inside / history.length) * 1000) / 1000 : null },
      next24h: upcoming.length
        ? {
            deliveries: Math.round(upcoming.reduce((sum, row) => sum + row.predicted, 0)),
            peakHour: peak?.hourStart ?? null,
            peakDrivers: peak?.driversNeeded ?? 0,
            shortHours: upcoming.filter((row) => row.driversExpected != null && row.driversNeeded > row.driversExpected).length,
          }
        : null,
    };
  }

  /** Previsão de uma cidade para uma hora (usada pela detecção de anomalias). */
  async forecastFor(tenantId: string, city: string, hourStart: Date) {
    return this.prisma.demandForecast.findUnique({ where: { tenantId_city_hourStart: { tenantId, city, hourStart } } });
  }
}
