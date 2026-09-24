import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { geohash } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { Prisma } from '../../generated/prisma/client';
import type { DeliveryStatus } from '../../generated/prisma/enums';
import { Period, periodRange, startOfLocalDay } from '../../common/time-range';
import { localTime, utcTimestamp } from '../../common/sql';
import { ACTIVE_DELIVERY_STATUSES } from '../logistics/deliveries.service';

export type HeatLayer = 'demand' | 'orders' | 'deliveries' | 'drivers';
export type HeatPrecision = 'fine' | 'medium' | 'coarse';

export interface HeatmapQuery {
  layer: HeatLayer;
  period: Period;
  precision?: HeatPrecision;
  fromHour?: number;
  toHour?: number;
  city?: string;
  /** "sul,oeste,norte,leste" */
  bbox?: string;
}

/** Alerta da torre de controle. */
export interface TowerAlert {
  type: string;
  severity: 'critical' | 'warning';
  message: string;
  deliveryId?: string;
  deliveryCode?: string;
  orderId?: string;
  orderNumber?: number;
  driverId?: string;
  companyId?: string;
  anomalyId?: string;
}

/** Outros módulos (ex.: inteligência) acrescentam alertas à torre. */
export type TowerAlertSource = (tenantId: string) => Promise<TowerAlert[]>;

const WAITING: DeliveryStatus[] = ['PENDING', 'SEARCHING_DRIVER'];
/** Tamanho da célula do mapa de calor em graus (~275 m, ~550 m e ~1,1 km no Brasil). */
const CELL: Record<HeatPrecision, number> = { fine: 0.0025, medium: 0.005, coarse: 0.01 };
const SAMPLE_MINUTES = 5;

const minutesBetween = (from: Date | null | undefined, to: Date | null | undefined) =>
  from && to ? (to.getTime() - from.getTime()) / 60_000 : null;
const average = (values: (number | null)[]) => {
  const list = values.filter((value): value is number => value != null && Number.isFinite(value));
  return list.length ? Math.round((list.reduce((sum, value) => sum + value, 0) / list.length) * 10) / 10 : null;
};

/**
 * Torre de controle: visão em tempo real (entregadores, entregas, atrasos, oferta x demanda) e
 * mapas de calor históricos. A presença de entregadores é guardada só de forma agregada por
 * célula — sem identificar ninguém (LGPD).
 */
@Injectable()
export class OperationsService {
  private readonly logger = new Logger(OperationsService.name);

  private readonly alertSources: TowerAlertSource[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  registerAlertSource(source: TowerAlertSource): void {
    this.alertSources.push(source);
  }

  /** Prazo prometido: previsão do pedido ou, na entrega avulsa, início + rota + folga configurada. */
  private promisedAt(
    delivery: { createdAt: Date; scheduledFor: Date | null; durationMin: number; order: { estimatedDeliveryAt: Date | null } | null },
    bufferMinutes: number,
  ): Date {
    if (delivery.order?.estimatedDeliveryAt) return delivery.order.estimatedDeliveryAt;
    const start = delivery.scheduledFor ?? delivery.createdAt;
    return new Date(start.getTime() + (delivery.durationMin + bufferMinutes) * 60_000);
  }

  // ---------------------------------------------------------------------------
  // Torre de controle
  // ---------------------------------------------------------------------------

  async snapshot(user: AuthUser, query: { city?: string } = {}) {
    const tenantId = user.tenantId;
    const [ops, dispatch, acceptTimeout] = await Promise.all([
      this.settings.get(tenantId, 'operations'),
      this.settings.get(tenantId, 'dispatch'),
      this.settings.get(tenantId, 'marketplace.acceptTimeoutMinutes'),
    ]);
    const now = new Date();
    const dayStart = startOfLocalDay(now, ops.timeZone);
    const hourAgo = new Date(now.getTime() - 3_600_000);
    const city = query.city?.trim();
    const cityFilter: Prisma.DeliveryWhereInput = city ? { city: { equals: city, mode: 'insensitive' } } : {};
    const orderCityFilter: Prisma.OrderWhereInput = city ? { company: { address: { city: { equals: city, mode: 'insensitive' } } } } : {};

    const [drivers, open, finishedToday, ordersByStatus, ordersLastHour, ordersToday, lateOrders, waitingAcceptance, ticketsBreached] = await Promise.all([
      this.prisma.driver.findMany({
        where: { tenantId, availability: { in: ['ONLINE', 'BUSY'] } },
        select: {
          id: true,
          availability: true,
          lastLat: true,
          lastLng: true,
          lastLocationAt: true,
          onlineSince: true,
          user: { select: { name: true } },
          activeVehicle: { select: { type: true } },
        },
        take: 5000,
      }),
      this.prisma.delivery.findMany({
        where: {
          tenantId,
          ...cityFilter,
          OR: [{ status: { in: [...WAITING, ...ACTIVE_DELIVERY_STATUSES] } }, { status: 'SCHEDULED', scheduledFor: { lte: new Date(now.getTime() + 3_600_000) } }],
        },
        select: {
          id: true,
          code: true,
          kind: true,
          status: true,
          city: true,
          pickupLat: true,
          pickupLng: true,
          dropoffLat: true,
          dropoffLng: true,
          driverId: true,
          vehicleType: true,
          createdAt: true,
          scheduledFor: true,
          searchStartedAt: true,
          dispatchAttempts: true,
          durationMin: true,
          company: { select: { tradeName: true } },
          order: { select: { id: true, number: true, estimatedDeliveryAt: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 5000,
      }),
      this.prisma.delivery.findMany({
        where: { tenantId, ...cityFilter, OR: [{ deliveredAt: { gte: dayStart } }, { canceledAt: { gte: dayStart } }, { failedAt: { gte: dayStart } }] },
        select: {
          status: true,
          createdAt: true,
          scheduledFor: true,
          searchStartedAt: true,
          assignedAt: true,
          pickedUpAt: true,
          deliveredAt: true,
          durationMin: true,
          order: { select: { estimatedDeliveryAt: true, createdAt: true } },
        },
        take: 20_000,
      }),
      this.prisma.order.groupBy({
        by: ['status'],
        where: { tenantId, ...orderCityFilter, status: { in: ['NEW', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'DRIVER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'] } },
        _count: { _all: true },
      }),
      this.prisma.order.count({ where: { tenantId, ...orderCityFilter, createdAt: { gte: hourAgo }, status: { not: 'PENDING_PAYMENT' } } }),
      this.prisma.order.count({ where: { tenantId, ...orderCityFilter, createdAt: { gte: dayStart }, status: { not: 'PENDING_PAYMENT' } } }),
      this.prisma.order.findMany({
        where: {
          tenantId,
          ...orderCityFilter,
          status: { in: ['NEW', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'DRIVER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'] },
          estimatedDeliveryAt: { lt: new Date(now.getTime() - ops.lateToleranceMinutes * 60_000) },
        },
        select: { id: true, number: true, status: true, estimatedDeliveryAt: true, company: { select: { tradeName: true } } },
        orderBy: { estimatedDeliveryAt: 'asc' },
        take: 100,
      }),
      this.prisma.order.findMany({
        where: { tenantId, ...orderCityFilter, status: 'NEW', createdAt: { lt: new Date(now.getTime() - ops.acceptWarningMinutes * 60_000) } },
        select: { id: true, number: true, createdAt: true, company: { select: { id: true, tradeName: true } } },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
      this.prisma.supportTicket.count({ where: { tenantId, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_REQUESTER'] }, slaBreachedAt: { not: null } } }),
    ]);

    // --- Entregadores -------------------------------------------------------
    const freshMs = dispatch.locationFreshSeconds * 1000;
    const activeByDriver = new Map<string, number>();
    for (const delivery of open) if (delivery.driverId) activeByDriver.set(delivery.driverId, (activeByDriver.get(delivery.driverId) ?? 0) + 1);
    const driverViews = drivers.map((driver) => ({
      id: driver.id,
      name: driver.user.name,
      availability: driver.availability,
      vehicleType: driver.activeVehicle?.type ?? null,
      lat: driver.lastLat,
      lng: driver.lastLng,
      lastLocationAt: driver.lastLocationAt,
      onlineSince: driver.onlineSince,
      activeDeliveries: activeByDriver.get(driver.id) ?? 0,
      stale: !driver.lastLocationAt || now.getTime() - driver.lastLocationAt.getTime() > freshMs,
    }));
    const driverById = new Map(driverViews.map((driver) => [driver.id, driver]));

    // --- Entregas em aberto -------------------------------------------------
    const lateMs = ops.lateToleranceMinutes * 60_000;
    const deliveryViews = open.map((delivery) => {
      const promisedAt = this.promisedAt(delivery, ops.deliveryPromiseBufferMinutes);
      const waitingSince = delivery.searchStartedAt ?? delivery.scheduledFor ?? delivery.createdAt;
      return {
        id: delivery.id,
        code: delivery.code,
        kind: delivery.kind,
        status: delivery.status,
        city: delivery.city,
        company: delivery.company?.tradeName ?? null,
        order: delivery.order ? { id: delivery.order.id, number: delivery.order.number } : null,
        pickup: { lat: delivery.pickupLat, lng: delivery.pickupLng },
        dropoff: { lat: delivery.dropoffLat, lng: delivery.dropoffLng },
        driverId: delivery.driverId,
        driverName: delivery.driverId ? (driverById.get(delivery.driverId)?.name ?? null) : null,
        vehicleType: delivery.vehicleType,
        dispatchAttempts: delivery.dispatchAttempts,
        promisedAt,
        late: now.getTime() > promisedAt.getTime() + lateMs,
        waitingMinutes: WAITING.includes(delivery.status) ? Math.max(0, Math.round((now.getTime() - waitingSince.getTime()) / 60_000)) : null,
      };
    });

    // --- Indicadores do dia --------------------------------------------------
    const delivered = finishedToday.filter((delivery) => delivery.status === 'DELIVERED');
    const onTime = delivered.filter((delivery) => delivery.deliveredAt!.getTime() <= this.promisedAt(delivery, ops.deliveryPromiseBufferMinutes).getTime() + lateMs);
    const statusCount = Object.fromEntries(ordersByStatus.map((row) => [row.status, row._count._all])) as Record<string, number>;
    const online = driverViews.filter((driver) => driver.availability === 'ONLINE').length;
    const busy = driverViews.length - online;
    const waitingDeliveries = deliveryViews.filter((delivery) => WAITING.includes(delivery.status));
    const metrics = {
      driversOnline: online,
      driversBusy: busy,
      activeDrivers: driverViews.length,
      deliveriesWaiting: waitingDeliveries.length,
      deliveriesInProgress: deliveryViews.filter((delivery) => ACTIVE_DELIVERY_STATUSES.includes(delivery.status)).length,
      deliveriesLate: deliveryViews.filter((delivery) => delivery.late).length,
      deliveredToday: delivered.length,
      canceledToday: finishedToday.filter((delivery) => delivery.status === 'CANCELED').length,
      failedToday: finishedToday.filter((delivery) => delivery.status === 'FAILED').length,
      ordersToday,
      ordersLastHour,
      ordersInProgress: Object.values(statusCount).reduce((sum, value) => sum + value, 0),
      ordersByStatus: statusCount,
      ordersLate: lateOrders.length,
      /** % das entregas concluídas hoje dentro do prazo prometido (com tolerância). */
      slaToday: delivered.length ? Math.round((onTime.length / delivered.length) * 1000) / 10 : null,
      avgAssignMinutes: average(delivered.map((delivery) => minutesBetween(delivery.searchStartedAt, delivery.assignedAt))),
      avgPickupMinutes: average(delivered.map((delivery) => minutesBetween(delivery.assignedAt, delivery.pickedUpAt))),
      avgRouteMinutes: average(delivered.map((delivery) => minutesBetween(delivery.pickedUpAt, delivery.deliveredAt))),
      avgDeliveryMinutes: average(delivered.map((delivery) => minutesBetween(delivery.order?.createdAt ?? delivery.scheduledFor ?? delivery.createdAt, delivery.deliveredAt))),
      supplyDemandRatio: waitingDeliveries.length ? Math.round((online / waitingDeliveries.length) * 100) / 100 : null,
      ticketsSlaBreached: ticketsBreached,
    };

    // --- Oferta x demanda por região (células geohash de ~5 km) --------------
    const regions = new Map<string, { geohash: string; latSum: number; lngSum: number; points: number; idleDrivers: number; busyDrivers: number; waiting: number; inProgress: number }>();
    const cell = (lat: number, lng: number) => {
      const key = geohash({ lat, lng }, 5);
      let region = regions.get(key);
      if (!region) regions.set(key, (region = { geohash: key, latSum: 0, lngSum: 0, points: 0, idleDrivers: 0, busyDrivers: 0, waiting: 0, inProgress: 0 }));
      region.latSum += lat;
      region.lngSum += lng;
      region.points += 1;
      return region;
    };
    for (const driver of driverViews) {
      if (driver.lat == null || driver.lng == null || driver.stale) continue;
      const region = cell(driver.lat, driver.lng);
      if (driver.availability === 'ONLINE') region.idleDrivers += 1;
      else region.busyDrivers += 1;
    }
    for (const delivery of deliveryViews) {
      const region = cell(delivery.pickup.lat, delivery.pickup.lng);
      if (WAITING.includes(delivery.status)) region.waiting += 1;
      else if (ACTIVE_DELIVERY_STATUSES.includes(delivery.status)) region.inProgress += 1;
    }
    const supplyDemand = [...regions.values()]
      .map((region) => {
        const status = region.waiting > region.idleDrivers ? 'shortage' : region.idleDrivers > region.waiting * 2 + 2 ? 'surplus' : 'balanced';
        return {
          geohash: region.geohash,
          lat: region.latSum / region.points,
          lng: region.lngSum / region.points,
          idleDrivers: region.idleDrivers,
          busyDrivers: region.busyDrivers,
          waiting: region.waiting,
          inProgress: region.inProgress,
          status,
        };
      })
      .sort((a, b) => b.waiting - b.idleDrivers - (a.waiting - a.idleDrivers));

    // --- Alertas --------------------------------------------------------------
    const alerts: TowerAlert[] = [];
    for (const delivery of deliveryViews) {
      if (delivery.status === 'SEARCHING_DRIVER' && (delivery.waitingMinutes ?? 0) >= ops.stalledDispatchMinutes) {
        alerts.push({
          type: 'dispatch_stalled',
          severity: (delivery.waitingMinutes ?? 0) >= ops.stalledDispatchMinutes * 3 ? 'critical' : 'warning',
          message: `Entrega ${delivery.code} sem entregador há ${delivery.waitingMinutes} min (${delivery.dispatchAttempts} tentativa(s)).`,
          deliveryId: delivery.id,
          deliveryCode: delivery.code,
        });
      }
      if (delivery.late) {
        alerts.push({ type: 'late', severity: 'warning', message: `Entrega ${delivery.code} passou do prazo prometido.`, deliveryId: delivery.id, deliveryCode: delivery.code });
      }
    }
    const staleLimit = ops.staleLocationMinutes * 60_000;
    for (const driver of driverViews) {
      const silentFor = driver.lastLocationAt ? now.getTime() - driver.lastLocationAt.getTime() : Infinity;
      if (driver.activeDeliveries > 0 && silentFor > staleLimit) {
        alerts.push({
          type: 'driver_no_signal',
          severity: 'critical',
          message: `${driver.name} está com entrega em andamento e sem sinal ${Number.isFinite(silentFor) ? `há ${Math.round(silentFor / 60_000)} min` : ''}.`.replace(' .', '.'),
          driverId: driver.id,
        });
      }
    }
    for (const order of waitingAcceptance) {
      const minutes = Math.round((now.getTime() - order.createdAt.getTime()) / 60_000);
      alerts.push({
        type: 'order_not_accepted',
        severity: minutes >= acceptTimeout - 1 ? 'critical' : 'warning',
        message: `Pedido #${order.number} (${order.company.tradeName}) aguarda aceite há ${minutes} min.`,
        orderId: order.id,
        orderNumber: order.number,
        companyId: order.company.id,
      });
    }
    for (const order of lateOrders) {
      alerts.push({ type: 'order_late', severity: 'warning', message: `Pedido #${order.number} (${order.company.tradeName}) passou do prazo previsto.`, orderId: order.id, orderNumber: order.number });
    }
    for (const region of supplyDemand.filter((item) => item.status === 'shortage' && item.waiting >= 2)) {
      alerts.push({ type: 'supply_shortage', severity: region.idleDrivers === 0 ? 'critical' : 'warning', message: `Região ${region.geohash}: ${region.waiting} entrega(s) aguardando e ${region.idleDrivers} entregador(es) livre(s).` });
    }
    if (ticketsBreached > 0) alerts.push({ type: 'tickets_sla', severity: 'warning', message: `${ticketsBreached} chamado(s) com SLA estourado.` });
    for (const source of this.alertSources) {
      try {
        alerts.push(...(await source(tenantId)));
      } catch (error) {
        this.logger.warn(`Fonte de alertas falhou: ${(error as Error).message}`);
      }
    }
    alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));

    return {
      generatedAt: now,
      timeZone: ops.timeZone,
      metrics,
      drivers: driverViews,
      deliveries: deliveryViews,
      lateOrders: lateOrders.map((order) => ({ id: order.id, number: order.number, status: order.status, company: order.company.tradeName, estimatedDeliveryAt: order.estimatedDeliveryAt })),
      supplyDemand,
      alerts: alerts.slice(0, 200),
    };
  }

  // ---------------------------------------------------------------------------
  // Mapa de calor
  // ---------------------------------------------------------------------------

  async heatmap(user: AuthUser, query: HeatmapQuery) {
    const tenantId = user.tenantId;
    const ops = await this.settings.get(tenantId, 'operations');
    const tz = ops.timeZone;
    const { from, to } = periodRange(query.period, tz);
    const fromSql = utcTimestamp(from);
    const toSql = utcTimestamp(to);
    const size = CELL[query.precision ?? 'medium'];
    const city = query.city?.trim() || null;

    const hourSql = (column: Prisma.Sql) => {
      if (query.fromHour == null && query.toHour == null) return Prisma.empty;
      const start = query.fromHour ?? 0;
      const end = query.toHour ?? 23;
      const hour = Prisma.sql`EXTRACT(HOUR FROM ${localTime(column, tz)})`;
      return start <= end ? Prisma.sql`AND ${hour} BETWEEN ${start} AND ${end}` : Prisma.sql`AND (${hour} >= ${start} OR ${hour} <= ${end})`;
    };
    let bboxSql: (lat: Prisma.Sql, lng: Prisma.Sql) => Prisma.Sql = () => Prisma.empty;
    if (query.bbox) {
      const [south, west, north, east] = query.bbox.split(',').map(Number);
      if ([south, west, north, east].every(Number.isFinite)) bboxSql = (lat, lng) => Prisma.sql`AND ${lat} BETWEEN ${south} AND ${north} AND ${lng} BETWEEN ${west} AND ${east}`;
    }

    // Cada camada vira um conjunto de pontos (lat, lng, instante, peso) agregado na grade.
    let points: Prisma.Sql;
    let at: Prisma.Sql;
    switch (query.layer) {
      case 'orders': {
        const lat = Prisma.sql`(o."deliveryAddress"->>'lat')::float8`;
        const lng = Prisma.sql`(o."deliveryAddress"->>'lng')::float8`;
        at = Prisma.sql`o."createdAt"`;
        points = Prisma.sql`
          SELECT ${lat} AS lat, ${lng} AS lng, o."createdAt" AS at, 1::float8 AS weight
          FROM orders o
          WHERE o."tenantId" = ${tenantId}::uuid AND o.status <> 'PENDING_PAYMENT' AND o."deliveryAddress" IS NOT NULL
            AND o."deliveryAddress"->>'lat' IS NOT NULL
            AND o."createdAt" >= ${fromSql} AND o."createdAt" < ${toSql}
            ${city ? Prisma.sql`AND lower(o."deliveryAddress"->>'city') = lower(${city})` : Prisma.empty}
            ${hourSql(at)} ${bboxSql(lat, lng)}`;
        break;
      }
      case 'deliveries': {
        at = Prisma.sql`d."deliveredAt"`;
        points = Prisma.sql`
          SELECT d."dropoffLat" AS lat, d."dropoffLng" AS lng, d."deliveredAt" AS at, 1::float8 AS weight
          FROM deliveries d
          WHERE d."tenantId" = ${tenantId}::uuid AND d.status = 'DELIVERED'
            AND d."deliveredAt" >= ${fromSql} AND d."deliveredAt" < ${toSql}
            ${city ? Prisma.sql`AND lower(d.city) = lower(${city})` : Prisma.empty}
            ${hourSql(at)} ${bboxSql(Prisma.sql`d."dropoffLat"`, Prisma.sql`d."dropoffLng"`)}`;
        break;
      }
      case 'demand': {
        // Demanda por entregador: onde as coletas foram solicitadas (inclui as canceladas por falta de entregador).
        at = Prisma.sql`d."createdAt"`;
        points = Prisma.sql`
          SELECT d."pickupLat" AS lat, d."pickupLng" AS lng, d."createdAt" AS at, 1::float8 AS weight
          FROM deliveries d
          WHERE d."tenantId" = ${tenantId}::uuid
            AND d."createdAt" >= ${fromSql} AND d."createdAt" < ${toSql}
            ${city ? Prisma.sql`AND lower(d.city) = lower(${city})` : Prisma.empty}
            ${hourSql(at)} ${bboxSql(Prisma.sql`d."pickupLat"`, Prisma.sql`d."pickupLng"`)}`;
        break;
      }
      case 'drivers': {
        at = Prisma.sql`s."bucketStart"`;
        points = Prisma.sql`
          SELECT s.lat, s.lng, s."bucketStart" AS at, s."onlineCount"::float8 AS weight
          FROM driver_presence_samples s
          WHERE s."tenantId" = ${tenantId}::uuid
            AND s."bucketStart" >= ${fromSql} AND s."bucketStart" < ${toSql}
            ${hourSql(at)} ${bboxSql(Prisma.sql`s.lat`, Prisma.sql`s.lng`)}`;
        break;
      }
    }

    const [cells, hours, buckets] = await Promise.all([
      this.prisma.$queryRaw<{ gy: number; gx: number; total: number }[]>`
        SELECT floor(p.lat / ${size})::int AS gy, floor(p.lng / ${size})::int AS gx, sum(p.weight)::float8 AS total
        FROM (${points}) p
        WHERE p.lat IS NOT NULL AND p.lng IS NOT NULL
        GROUP BY 1, 2
        ORDER BY total DESC
        LIMIT 5000`,
      this.prisma.$queryRaw<{ hour: number; total: number }[]>`
        SELECT EXTRACT(HOUR FROM ${localTime(Prisma.sql`p.at`, tz)})::int AS hour, sum(p.weight)::float8 AS total
        FROM (${points}) p
        GROUP BY 1 ORDER BY 1`,
      query.layer === 'drivers'
        ? this.prisma.$queryRaw<{ count: number }[]>`SELECT count(DISTINCT p.at)::int AS count FROM (${points}) p`
        : Promise.resolve([{ count: 1 }]),
    ]);

    // Entregadores: média de entregadores online por célula ao longo das amostras do período.
    const divisor = query.layer === 'drivers' ? Math.max(1, buckets[0]?.count ?? 1) : 1;
    const hourDivisor = query.layer === 'drivers' ? Math.max(1, Math.round(divisor / 24)) : 1;
    const round = (value: number) => Math.round(value * 100) / 100;
    const data = cells.map((row) => ({
      lat: round((row.gy + 0.5) * size * 1e4) / 1e4,
      lng: round((row.gx + 0.5) * size * 1e4) / 1e4,
      bounds: [
        [row.gy * size, row.gx * size],
        [(row.gy + 1) * size, (row.gx + 1) * size],
      ] as [[number, number], [number, number]],
      value: round(row.total / divisor),
    }));
    const byHour = Array.from({ length: 24 }, (_, hour) => round((hours.find((row) => row.hour === hour)?.total ?? 0) / hourDivisor));
    return {
      layer: query.layer,
      period: query.period,
      from,
      to,
      timeZone: tz,
      cellSizeDegrees: size,
      unit: query.layer === 'drivers' ? 'média de entregadores online' : query.layer === 'orders' ? 'pedidos' : query.layer === 'deliveries' ? 'entregas concluídas' : 'solicitações de entrega',
      total: query.layer === 'drivers' ? null : round(data.reduce((sum, cell) => sum + cell.value, 0)),
      max: data.reduce((max, cell) => Math.max(max, cell.value), 0),
      cells: data,
      byHour,
    };
  }

  /** Cidades com entregas nos últimos 90 dias (filtro do painel). */
  async cities(user: AuthUser) {
    const rows = await this.prisma.delivery.groupBy({
      by: ['city', 'state'],
      where: { tenantId: user.tenantId, city: { not: null }, createdAt: { gte: new Date(Date.now() - 90 * 86_400_000) } },
      _count: { _all: true },
      orderBy: { _count: { city: 'desc' } },
      take: 100,
    });
    return rows.map((row) => ({ city: row.city!, state: row.state, deliveries: row._count._all }));
  }

  // ---------------------------------------------------------------------------
  // Amostras de presença (agregadas, sem identificação)
  // ---------------------------------------------------------------------------

  @Cron('0 */5 * * * *')
  async samplePresence(now = new Date()): Promise<number> {
    try {
      const bucketStart = new Date(Math.floor(now.getTime() / (SAMPLE_MINUTES * 60_000)) * SAMPLE_MINUTES * 60_000);
      const fresh = new Date(now.getTime() - SAMPLE_MINUTES * 60_000);
      const drivers = await this.prisma.driver.findMany({
        where: { availability: { in: ['ONLINE', 'BUSY'] }, lastLocationAt: { gte: fresh }, lastLat: { not: null }, lastLng: { not: null } },
        select: { tenantId: true, availability: true, lastLat: true, lastLng: true },
        take: 50_000,
      });
      const cells = new Map<string, { tenantId: string; geohash: string; latSum: number; lngSum: number; online: number; busy: number }>();
      for (const driver of drivers) {
        const hash = geohash({ lat: driver.lastLat!, lng: driver.lastLng! }, 6);
        const key = `${driver.tenantId}:${hash}`;
        let cell = cells.get(key);
        if (!cell) cells.set(key, (cell = { tenantId: driver.tenantId, geohash: hash, latSum: 0, lngSum: 0, online: 0, busy: 0 }));
        cell.latSum += driver.lastLat!;
        cell.lngSum += driver.lastLng!;
        cell.online += 1;
        if (driver.availability === 'BUSY') cell.busy += 1;
      }
      if (!cells.size) return 0;
      // Posição da célula = média arredondada (~100 m): não revela a posição exata de ninguém.
      const result = await this.prisma.driverPresenceSample.createMany({
        data: [...cells.values()].map((cell) => ({
          tenantId: cell.tenantId,
          geohash: cell.geohash,
          lat: Math.round((cell.latSum / cell.online) * 1000) / 1000,
          lng: Math.round((cell.lngSum / cell.online) * 1000) / 1000,
          bucketStart,
          onlineCount: cell.online,
          busyCount: cell.busy,
        })),
        skipDuplicates: true,
      });
      return result.count;
    } catch (error) {
      this.logger.error(`Falha ao registrar amostras de presença: ${(error as Error).message}`);
      return 0;
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeSamples(): Promise<number> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    let removed = 0;
    for (const tenant of tenants) {
      const { presenceRetentionDays } = await this.settings.get(tenant.id, 'operations');
      const result = await this.prisma.driverPresenceSample.deleteMany({
        where: { tenantId: tenant.id, bucketStart: { lt: new Date(Date.now() - presenceRetentionDays * 86_400_000) } },
      });
      removed += result.count;
    }
    return removed;
  }
}
