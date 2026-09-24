import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { Prisma } from '../../generated/prisma/client';
import { formatLocalDate, Period, periodRange, reportRange, startOfLocalDay } from '../../common/time-range';
import { localTime, utcTimestamp } from '../../common/sql';

export type ReportKind = 'commercial' | 'operational' | 'financial' | 'drivers' | 'corporate';
export type Granularity = 'day' | 'week' | 'month';

export interface ReportQuery {
  from?: string;
  to?: string;
  granularity?: Granularity;
  city?: string;
  companyId?: string;
  segmentId?: string;
  costCenterId?: string;
}

export type ColumnType = 'text' | 'int' | 'money' | 'percent' | 'minutes' | 'decimal';

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

export interface ReportTable {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
}

export interface ReportMetric {
  key: string;
  label: string;
  type: ColumnType;
  value: number | null;
}

export interface ReportResult {
  kind: ReportKind;
  title: string;
  range: { from: string; to: string; granularity: Granularity; timeZone: string };
  summary: ReportMetric[];
  series: { buckets: string[]; lines: { key: string; label: string; type: ColumnType; values: number[] }[] };
  tables: Record<string, ReportTable>;
}

interface Context {
  tenantId: string;
  tz: string;
  from: Date;
  to: Date;
  fromSql: Prisma.Sql;
  toSql: Prisma.Sql;
  fromDate: string;
  toDate: string;
  granularity: Granularity;
  buckets: string[];
  lateToleranceMinutes: number;
  bufferMinutes: number;
}

const DAY_MS = 86_400_000;
const num = (value: unknown) => (value == null ? 0 : Number(value));
const ratio = (part: number, total: number) => (total ? Math.round((part / total) * 1000) / 10 : null);
const round1 = (value: unknown) => (value == null ? null : Math.round(Number(value) * 10) / 10);

/** Chaves dos períodos (AAAA-MM-DD do início de cada dia/semana/mês) entre duas datas locais. */
export function bucketKeys(fromDate: string, toDate: string, granularity: Granularity): string[] {
  const parse = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  let cursor = parse(fromDate);
  const end = parse(toDate);
  if (granularity === 'week') cursor -= ((new Date(cursor).getUTCDay() + 6) % 7) * DAY_MS;
  if (granularity === 'month') cursor = Date.UTC(new Date(cursor).getUTCFullYear(), new Date(cursor).getUTCMonth(), 1);
  const keys: string[] = [];
  while (cursor <= end && keys.length < 1000) {
    keys.push(new Date(cursor).toISOString().slice(0, 10));
    if (granularity === 'day') cursor += DAY_MS;
    else if (granularity === 'week') cursor += 7 * DAY_MS;
    else cursor = Date.UTC(new Date(cursor).getUTCFullYear(), new Date(cursor).getUTCMonth() + 1, 1);
  }
  return keys;
}

/**
 * Relatórios gerenciais (BI): comercial, operacional, financeiro e entregadores, além dos painéis
 * da empresa e da plataforma. Tudo agregado no banco; exportação CSV pronta para planilhas.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async context(tenantId: string, query: ReportQuery): Promise<Context> {
    const ops = await this.settings.get(tenantId, 'operations');
    const range = reportRange(query.from, query.to, ops.timeZone);
    const days = (range.to.getTime() - range.from.getTime()) / DAY_MS;
    const granularity = query.granularity ?? (days > 400 ? 'month' : days > 92 ? 'week' : 'day');
    return {
      tenantId,
      tz: ops.timeZone,
      ...range,
      fromSql: utcTimestamp(range.from),
      toSql: utcTimestamp(range.to),
      granularity,
      buckets: bucketKeys(range.fromDate, range.toDate, granularity),
      lateToleranceMinutes: ops.lateToleranceMinutes,
      bufferMinutes: ops.deliveryPromiseBufferMinutes,
    };
  }

  private bucket(ctx: Context, column: Prisma.Sql) {
    return Prisma.sql`to_char(date_trunc(${ctx.granularity}, ${localTime(column, ctx.tz)}), 'YYYY-MM-DD')`;
  }

  private line<T extends { bucket: string }>(ctx: Context, rows: T[], key: keyof T, label: string, type: ColumnType) {
    const byBucket = new Map(rows.map((row) => [row.bucket, num(row[key])]));
    return { key: String(key), label, type, values: ctx.buckets.map((bucket) => byBucket.get(bucket) ?? 0) };
  }

  private seriesTable(result: Pick<ReportResult, 'series'>): ReportTable {
    return {
      title: 'Evolução no período',
      columns: [{ key: 'bucket', label: 'Período', type: 'text' }, ...result.series.lines.map((line) => ({ key: line.key, label: line.label, type: line.type }))],
      rows: result.series.buckets.map((bucket, index) => ({ bucket, ...Object.fromEntries(result.series.lines.map((line) => [line.key, line.values[index]])) })),
    };
  }

  private rangeOf(ctx: Context) {
    return { from: ctx.fromDate, to: ctx.toDate, granularity: ctx.granularity, timeZone: ctx.tz };
  }

  // ---------------------------------------------------------------------------
  // Comercial: vendas, ticket médio, clientes e empresas
  // ---------------------------------------------------------------------------

  async commercial(user: AuthUser, query: ReportQuery): Promise<ReportResult> {
    const ctx = await this.context(user.tenantId, query);
    const base = Prisma.sql`
      SELECT o.id, o."customerId", o."companyId", o.status, o."totalCents", o."subtotalCents", o."discountCents",
             o."paymentMethod", o.fulfillment, o."createdAt", c."segmentId", c."tradeName"
      FROM orders o
      JOIN companies c ON c.id = o."companyId"
      LEFT JOIN addresses a ON a.id = c."addressId"
      WHERE o."tenantId" = ${ctx.tenantId}::uuid AND o.status <> 'PENDING_PAYMENT'
        AND o."createdAt" >= ${ctx.fromSql} AND o."createdAt" < ${ctx.toSql}
        ${query.companyId ? Prisma.sql`AND o."companyId" = ${query.companyId}::uuid` : Prisma.empty}
        ${query.segmentId ? Prisma.sql`AND c."segmentId" = ${query.segmentId}::uuid` : Prisma.empty}
        ${query.city ? Prisma.sql`AND lower(a.city) = lower(${query.city})` : Prisma.empty}`;
    const sold = Prisma.sql`status <> 'CANCELED'`;

    const [totals, newCustomers, series, segments, companies, methods, onDemand] = await Promise.all([
      this.prisma.$queryRaw<Record<string, number>[]>`
        WITH base AS (${base})
        SELECT count(*)::int AS orders,
               (count(*) FILTER (WHERE status = 'DELIVERED'))::int AS completed,
               (count(*) FILTER (WHERE status = 'CANCELED'))::int AS canceled,
               COALESCE(sum("totalCents") FILTER (WHERE ${sold}), 0)::float8 AS gmv,
               COALESCE(sum("subtotalCents") FILTER (WHERE ${sold}), 0)::float8 AS products,
               COALESCE(sum("discountCents") FILTER (WHERE ${sold}), 0)::float8 AS discounts,
               (count(DISTINCT "customerId") FILTER (WHERE ${sold}))::int AS customers,
               (count(DISTINCT "companyId") FILTER (WHERE ${sold}))::int AS companies
        FROM base`,
      this.prisma.$queryRaw<{ count: number }[]>`
        WITH base AS (${base})
        SELECT count(*)::int AS count FROM (
          SELECT "customerId", min("createdAt") AS first FROM orders
          WHERE "tenantId" = ${ctx.tenantId}::uuid AND status <> 'PENDING_PAYMENT'
          GROUP BY 1
        ) f
        WHERE f.first >= ${ctx.fromSql} AND f.first < ${ctx.toSql} AND f."customerId" IN (SELECT "customerId" FROM base)`,
      this.prisma.$queryRaw<{ bucket: string; orders: number; gmv: number; customers: number; canceled: number }[]>`
        WITH base AS (${base})
        SELECT ${this.bucket(ctx, Prisma.sql`"createdAt"`)} AS bucket,
               (count(*) FILTER (WHERE ${sold}))::int AS orders,
               (count(*) FILTER (WHERE status = 'CANCELED'))::int AS canceled,
               COALESCE(sum("totalCents") FILTER (WHERE ${sold}), 0)::float8 AS gmv,
               (count(DISTINCT "customerId") FILTER (WHERE ${sold}))::int AS customers
        FROM base GROUP BY 1`,
      this.prisma.$queryRaw<{ segment: string; orders: number; gmv: number }[]>`
        WITH base AS (${base})
        SELECT s.name AS segment, (count(*) FILTER (WHERE ${sold}))::int AS orders, COALESCE(sum(b."totalCents") FILTER (WHERE ${sold}), 0)::float8 AS gmv
        FROM base b JOIN segments s ON s.id = b."segmentId"
        GROUP BY 1 ORDER BY gmv DESC`,
      this.prisma.$queryRaw<{ company: string; orders: number; canceled: number; gmv: number; customers: number }[]>`
        WITH base AS (${base})
        SELECT "tradeName" AS company,
               (count(*) FILTER (WHERE ${sold}))::int AS orders,
               (count(*) FILTER (WHERE status = 'CANCELED'))::int AS canceled,
               COALESCE(sum("totalCents") FILTER (WHERE ${sold}), 0)::float8 AS gmv,
               (count(DISTINCT "customerId") FILTER (WHERE ${sold}))::int AS customers
        FROM base GROUP BY "companyId", "tradeName" ORDER BY gmv DESC LIMIT 50`,
      this.prisma.$queryRaw<{ method: string; orders: number; gmv: number }[]>`
        WITH base AS (${base})
        SELECT "paymentMethod"::text AS method, (count(*) FILTER (WHERE ${sold}))::int AS orders, COALESCE(sum("totalCents") FILTER (WHERE ${sold}), 0)::float8 AS gmv
        FROM base GROUP BY 1 ORDER BY gmv DESC`,
      this.prisma.$queryRaw<{ count: number; fees: number }[]>`
        SELECT count(*)::int AS count, COALESCE(sum(d."feeCents"), 0)::float8 AS fees
        FROM deliveries d LEFT JOIN companies c ON c.id = d."companyId"
        WHERE d."tenantId" = ${ctx.tenantId}::uuid AND d.kind = 'ON_DEMAND' AND d.status NOT IN ('CANCELED', 'PENDING')
          AND d."createdAt" >= ${ctx.fromSql} AND d."createdAt" < ${ctx.toSql}
          ${query.companyId ? Prisma.sql`AND d."companyId" = ${query.companyId}::uuid` : Prisma.empty}
          ${query.segmentId ? Prisma.sql`AND c."segmentId" = ${query.segmentId}::uuid` : Prisma.empty}
          ${query.city ? Prisma.sql`AND lower(d.city) = lower(${query.city})` : Prisma.empty}`,
    ]);

    const t = totals[0];
    const soldOrders = num(t.orders) - num(t.canceled);
    const methodLabels: Record<string, string> = { PIX: 'PIX', CREDIT_CARD: 'Cartão de crédito', DEBIT_CARD: 'Cartão de débito', WALLET: 'Carteira', CASH: 'Dinheiro', INVOICE: 'Faturado' };
    const result: ReportResult = {
      kind: 'commercial',
      title: 'Relatório comercial',
      range: this.rangeOf(ctx),
      summary: [
        { key: 'gmv', label: 'Vendas (GMV)', type: 'money', value: num(t.gmv) },
        { key: 'orders', label: 'Pedidos', type: 'int', value: soldOrders },
        { key: 'averageTicket', label: 'Ticket médio', type: 'money', value: soldOrders ? Math.round(num(t.gmv) / soldOrders) : null },
        { key: 'customers', label: 'Clientes compradores', type: 'int', value: num(t.customers) },
        { key: 'newCustomers', label: 'Novos clientes', type: 'int', value: num(newCustomers[0]?.count) },
        { key: 'companies', label: 'Empresas com vendas', type: 'int', value: num(t.companies) },
        { key: 'cancelRate', label: 'Cancelamentos', type: 'percent', value: ratio(num(t.canceled), num(t.orders)) },
        { key: 'discounts', label: 'Descontos concedidos', type: 'money', value: num(t.discounts) },
        { key: 'onDemand', label: 'Entregas avulsas', type: 'int', value: num(onDemand[0]?.count) },
        { key: 'onDemandFees', label: 'Receita de entregas avulsas', type: 'money', value: num(onDemand[0]?.fees) },
      ],
      series: {
        buckets: ctx.buckets,
        lines: [
          this.line(ctx, series, 'gmv', 'Vendas (GMV)', 'money'),
          this.line(ctx, series, 'orders', 'Pedidos', 'int'),
          this.line(ctx, series, 'customers', 'Clientes', 'int'),
          this.line(ctx, series, 'canceled', 'Cancelados', 'int'),
        ],
      },
      tables: {},
    };
    result.tables = {
      series: this.seriesTable(result),
      companies: {
        title: 'Empresas (maiores vendas)',
        columns: [
          { key: 'company', label: 'Empresa', type: 'text' },
          { key: 'orders', label: 'Pedidos', type: 'int' },
          { key: 'gmv', label: 'Vendas', type: 'money' },
          { key: 'averageTicket', label: 'Ticket médio', type: 'money' },
          { key: 'customers', label: 'Clientes', type: 'int' },
          { key: 'canceled', label: 'Cancelados', type: 'int' },
        ],
        rows: companies.map((row) => ({ ...row, averageTicket: row.orders ? Math.round(num(row.gmv) / row.orders) : null })),
      },
      segments: {
        title: 'Por segmento',
        columns: [
          { key: 'segment', label: 'Segmento', type: 'text' },
          { key: 'orders', label: 'Pedidos', type: 'int' },
          { key: 'gmv', label: 'Vendas', type: 'money' },
          { key: 'share', label: 'Participação', type: 'percent' },
        ],
        rows: segments.map((row) => ({ ...row, share: ratio(num(row.gmv), num(t.gmv)) })),
      },
      payments: {
        title: 'Por forma de pagamento',
        columns: [
          { key: 'method', label: 'Forma de pagamento', type: 'text' },
          { key: 'orders', label: 'Pedidos', type: 'int' },
          { key: 'gmv', label: 'Vendas', type: 'money' },
          { key: 'share', label: 'Participação', type: 'percent' },
        ],
        rows: methods.map((row) => ({ method: methodLabels[row.method] ?? row.method, orders: row.orders, gmv: row.gmv, share: ratio(num(row.gmv), num(t.gmv)) })),
      },
    };
    return result;
  }

  // ---------------------------------------------------------------------------
  // Operacional: entregas, SLA, atrasos e cancelamentos
  // ---------------------------------------------------------------------------

  async operational(user: AuthUser, query: ReportQuery): Promise<ReportResult> {
    const ctx = await this.context(user.tenantId, query);
    const tolerance = Prisma.sql`make_interval(mins => ${ctx.lateToleranceMinutes}::int)`;
    const base = Prisma.sql`
      SELECT d.id, d.status, d.kind, d.city, d."createdAt", d."searchStartedAt", d."assignedAt", d."pickedUpAt", d."deliveredAt",
             d."distanceKm", d."cancelReason", d."failReason",
             COALESCE(o."estimatedDeliveryAt", COALESCE(d."scheduledFor", d."createdAt") + make_interval(mins => d."durationMin" + ${ctx.bufferMinutes}::int)) AS promised,
             COALESCE(o."createdAt", d."scheduledFor", d."createdAt") AS started
      FROM deliveries d
      LEFT JOIN orders o ON o.id = d."orderId"
      LEFT JOIN companies c ON c.id = d."companyId"
      WHERE d."tenantId" = ${ctx.tenantId}::uuid
        AND d."createdAt" >= ${ctx.fromSql} AND d."createdAt" < ${ctx.toSql}
        ${query.companyId ? Prisma.sql`AND d."companyId" = ${query.companyId}::uuid` : Prisma.empty}
        ${query.segmentId ? Prisma.sql`AND c."segmentId" = ${query.segmentId}::uuid` : Prisma.empty}
        ${query.city ? Prisma.sql`AND lower(d.city) = lower(${query.city})` : Prisma.empty}`;
    const delivered = Prisma.sql`status = 'DELIVERED'`;
    const onTime = Prisma.sql`status = 'DELIVERED' AND "deliveredAt" <= promised + ${tolerance}`;
    const minutes = (from: string, to: string) => Prisma.raw(`EXTRACT(EPOCH FROM ("${to}" - "${from}")) / 60`);

    const orderBase = Prisma.sql`
      FROM orders o JOIN companies c ON c.id = o."companyId" LEFT JOIN addresses a ON a.id = c."addressId"
      WHERE o."tenantId" = ${ctx.tenantId}::uuid AND o.status = 'CANCELED'
        AND o."createdAt" >= ${ctx.fromSql} AND o."createdAt" < ${ctx.toSql}
        ${query.companyId ? Prisma.sql`AND o."companyId" = ${query.companyId}::uuid` : Prisma.empty}
        ${query.segmentId ? Prisma.sql`AND c."segmentId" = ${query.segmentId}::uuid` : Prisma.empty}
        ${query.city ? Prisma.sql`AND lower(a.city) = lower(${query.city})` : Prisma.empty}`;

    const [totals, series, cities, cancelReasons, failReasons, orderCancels, byHour] = await Promise.all([
      this.prisma.$queryRaw<Record<string, number | null>[]>`
        WITH base AS (${base})
        SELECT count(*)::int AS total,
               (count(*) FILTER (WHERE ${delivered}))::int AS delivered,
               (count(*) FILTER (WHERE status = 'CANCELED'))::int AS canceled,
               (count(*) FILTER (WHERE status = 'FAILED'))::int AS failed,
               (count(*) FILTER (WHERE ${onTime}))::int AS on_time,
               (avg(${minutes('searchStartedAt', 'assignedAt')}) FILTER (WHERE ${delivered}))::float8 AS avg_assign,
               (avg(${minutes('assignedAt', 'pickedUpAt')}) FILTER (WHERE ${delivered}))::float8 AS avg_pickup,
               (avg(${minutes('pickedUpAt', 'deliveredAt')}) FILTER (WHERE ${delivered}))::float8 AS avg_route,
               (avg(${minutes('started', 'deliveredAt')}) FILTER (WHERE ${delivered}))::float8 AS avg_total,
               (avg("distanceKm") FILTER (WHERE ${delivered}))::float8 AS avg_km
        FROM base`,
      this.prisma.$queryRaw<{ bucket: string; total: number; delivered: number; late: number; canceled: number; on_time: number }[]>`
        WITH base AS (${base})
        SELECT ${this.bucket(ctx, Prisma.sql`"createdAt"`)} AS bucket,
               count(*)::int AS total,
               (count(*) FILTER (WHERE ${delivered}))::int AS delivered,
               (count(*) FILTER (WHERE ${delivered} AND NOT (${onTime})))::int AS late,
               (count(*) FILTER (WHERE status IN ('CANCELED', 'FAILED')))::int AS canceled,
               (count(*) FILTER (WHERE ${onTime}))::int AS on_time
        FROM base GROUP BY 1`,
      this.prisma.$queryRaw<{ city: string; total: number; delivered: number; on_time: number; canceled: number; avg_total: number | null }[]>`
        WITH base AS (${base})
        SELECT COALESCE(city, '—') AS city, count(*)::int AS total,
               (count(*) FILTER (WHERE ${delivered}))::int AS delivered,
               (count(*) FILTER (WHERE ${onTime}))::int AS on_time,
               (count(*) FILTER (WHERE status IN ('CANCELED', 'FAILED')))::int AS canceled,
               (avg(${minutes('started', 'deliveredAt')}) FILTER (WHERE ${delivered}))::float8 AS avg_total
        FROM base GROUP BY 1 ORDER BY total DESC LIMIT 50`,
      this.prisma.$queryRaw<{ reason: string; count: number }[]>`
        WITH base AS (${base})
        SELECT COALESCE(NULLIF(trim("cancelReason"), ''), 'Sem motivo informado') AS reason, count(*)::int AS count
        FROM base WHERE status = 'CANCELED' GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
      this.prisma.$queryRaw<{ reason: string; count: number }[]>`
        WITH base AS (${base})
        SELECT COALESCE(NULLIF(trim("failReason"), ''), 'Sem motivo informado') AS reason, count(*)::int AS count
        FROM base WHERE status = 'FAILED' GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
      this.prisma.$queryRaw<{ actor: string | null; reason: string; count: number }[]>`
        SELECT o."canceledBy"::text AS actor, COALESCE(NULLIF(trim(o."cancelReason"), ''), 'Sem motivo informado') AS reason, count(*)::int AS count
        ${orderBase}
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30`,
      this.prisma.$queryRaw<{ hour: number; total: number }[]>`
        WITH base AS (${base})
        SELECT EXTRACT(HOUR FROM ${localTime(Prisma.sql`"createdAt"`, ctx.tz)})::int AS hour, count(*)::int AS total
        FROM base GROUP BY 1 ORDER BY 1`,
    ]);

    const t = totals[0];
    const actorLabels: Record<string, string> = { CUSTOMER: 'Cliente', COMPANY: 'Empresa', DRIVER: 'Entregador', PLATFORM: 'Plataforma', SYSTEM: 'Sistema (automático)' };
    const slaSeries = series.map((row) => ({ bucket: row.bucket, sla: ratio(row.on_time, row.delivered) ?? 0 }));
    const result: ReportResult = {
      kind: 'operational',
      title: 'Relatório operacional',
      range: this.rangeOf(ctx),
      summary: [
        { key: 'deliveries', label: 'Entregas solicitadas', type: 'int', value: num(t.total) },
        { key: 'delivered', label: 'Concluídas', type: 'int', value: num(t.delivered) },
        { key: 'sla', label: 'SLA (no prazo)', type: 'percent', value: ratio(num(t.on_time), num(t.delivered)) },
        { key: 'late', label: 'Atrasadas', type: 'int', value: num(t.delivered) - num(t.on_time) },
        { key: 'canceled', label: 'Canceladas', type: 'int', value: num(t.canceled) },
        { key: 'failed', label: 'Não entregues', type: 'int', value: num(t.failed) },
        { key: 'cancelRate', label: 'Taxa de cancelamento', type: 'percent', value: ratio(num(t.canceled) + num(t.failed), num(t.total)) },
        { key: 'avgAssign', label: 'Tempo para achar entregador', type: 'minutes', value: round1(t.avg_assign) },
        { key: 'avgPickup', label: 'Tempo médio de coleta', type: 'minutes', value: round1(t.avg_pickup) },
        { key: 'avgRoute', label: 'Tempo médio de percurso', type: 'minutes', value: round1(t.avg_route) },
        { key: 'avgTotal', label: 'Tempo médio de entrega', type: 'minutes', value: round1(t.avg_total) },
        { key: 'avgKm', label: 'Distância média', type: 'decimal', value: round1(t.avg_km) },
      ],
      series: {
        buckets: ctx.buckets,
        lines: [
          this.line(ctx, series, 'total', 'Solicitadas', 'int'),
          this.line(ctx, series, 'delivered', 'Concluídas', 'int'),
          this.line(ctx, series, 'late', 'Atrasadas', 'int'),
          this.line(ctx, series, 'canceled', 'Canceladas/não entregues', 'int'),
          this.line(ctx, slaSeries, 'sla', 'SLA (%)', 'percent'),
        ],
      },
      tables: {},
    };
    result.tables = {
      series: this.seriesTable(result),
      cities: {
        title: 'Por cidade',
        columns: [
          { key: 'city', label: 'Cidade', type: 'text' },
          { key: 'total', label: 'Solicitadas', type: 'int' },
          { key: 'delivered', label: 'Concluídas', type: 'int' },
          { key: 'sla', label: 'SLA', type: 'percent' },
          { key: 'canceled', label: 'Canceladas', type: 'int' },
          { key: 'avgTotal', label: 'Tempo médio (min)', type: 'minutes' },
        ],
        rows: cities.map((row) => ({ city: row.city, total: row.total, delivered: row.delivered, sla: ratio(row.on_time, row.delivered), canceled: row.canceled, avgTotal: round1(row.avg_total) })),
      },
      deliveryCancellations: {
        title: 'Motivos de cancelamento de entregas',
        columns: [
          { key: 'reason', label: 'Motivo', type: 'text' },
          { key: 'count', label: 'Entregas', type: 'int' },
        ],
        rows: cancelReasons,
      },
      failures: {
        title: 'Motivos de entregas não realizadas',
        columns: [
          { key: 'reason', label: 'Motivo', type: 'text' },
          { key: 'count', label: 'Entregas', type: 'int' },
        ],
        rows: failReasons,
      },
      orderCancellations: {
        title: 'Cancelamentos de pedidos',
        columns: [
          { key: 'actor', label: 'Cancelado por', type: 'text' },
          { key: 'reason', label: 'Motivo', type: 'text' },
          { key: 'count', label: 'Pedidos', type: 'int' },
        ],
        rows: orderCancels.map((row) => ({ actor: row.actor ? (actorLabels[row.actor] ?? row.actor) : '—', reason: row.reason, count: row.count })),
      },
      hours: {
        title: 'Solicitações por hora do dia',
        columns: [
          { key: 'hour', label: 'Hora', type: 'text' },
          { key: 'total', label: 'Entregas', type: 'int' },
        ],
        rows: Array.from({ length: 24 }, (_, hour) => ({ hour: `${String(hour).padStart(2, '0')}h`, total: byHour.find((row) => row.hour === hour)?.total ?? 0 })),
      },
    };
    return result;
  }

  // ---------------------------------------------------------------------------
  // Financeiro: receita, comissão, taxas, pagamentos e estornos (razão da plataforma)
  // ---------------------------------------------------------------------------

  async financial(user: AuthUser, query: ReportQuery): Promise<ReportResult> {
    const ctx = await this.context(user.tenantId, query);
    const companyOfEntry = query.companyId
      ? Prisma.sql`AND (EXISTS (SELECT 1 FROM orders o WHERE o.id = t."orderId" AND o."companyId" = ${query.companyId}::uuid)
                    OR EXISTS (SELECT 1 FROM deliveries d WHERE d.id = t."deliveryId" AND d."companyId" = ${query.companyId}::uuid))`
      : Prisma.empty;
    const companyOfPayment = query.companyId
      ? Prisma.sql`AND (EXISTS (SELECT 1 FROM orders o WHERE o.id = p."orderId" AND o."companyId" = ${query.companyId}::uuid)
                    OR EXISTS (SELECT 1 FROM deliveries d WHERE d.id = p."deliveryId" AND d."companyId" = ${query.companyId}::uuid))`
      : Prisma.empty;
    const ledger = Prisma.sql`
      SELECT t."createdAt",
             t."amountCents",
             CASE
               WHEN t.type = 'COMMISSION' THEN 'commission'
               WHEN t.type = 'FEE' AND t."referenceKey" LIKE '%:service-fee' THEN 'serviceFees'
               WHEN t.type = 'FEE' THEN 'deliveryFees'
               WHEN t.type = 'EARNING' THEN 'driverPayouts'
               WHEN t.type = 'DISCOUNT' THEN 'discounts'
               WHEN t.type = 'REFUND' THEN 'refunds'
               WHEN t.type = 'ADJUSTMENT' THEN 'adjustments'
               ELSE 'other'
             END AS category
      FROM wallet_transactions t
      JOIN wallets w ON w.id = t."walletId"
      WHERE w."tenantId" = ${ctx.tenantId}::uuid AND w."ownerType" = 'PLATFORM' AND t.status <> 'CANCELED'
        AND t."createdAt" >= ${ctx.fromSql} AND t."createdAt" < ${ctx.toSql}
        ${companyOfEntry}`;

    const [byCategory, series, payments, paymentStatus, refunds, refundReasons, withdrawals] = await Promise.all([
      this.prisma.$queryRaw<{ category: string; amount: number }[]>`
        WITH ledger AS (${ledger}) SELECT category, COALESCE(sum("amountCents"), 0)::float8 AS amount FROM ledger GROUP BY 1`,
      this.prisma.$queryRaw<{ bucket: string; commission: number; fees: number; payouts: number; net: number }[]>`
        WITH ledger AS (${ledger})
        SELECT ${this.bucket(ctx, Prisma.sql`"createdAt"`)} AS bucket,
               COALESCE(sum("amountCents") FILTER (WHERE category = 'commission'), 0)::float8 AS commission,
               COALESCE(sum("amountCents") FILTER (WHERE category IN ('serviceFees', 'deliveryFees')), 0)::float8 AS fees,
               COALESCE(-sum("amountCents") FILTER (WHERE category = 'driverPayouts'), 0)::float8 AS payouts,
               COALESCE(sum("amountCents"), 0)::float8 AS net
        FROM ledger GROUP BY 1`,
      this.prisma.$queryRaw<{ method: string; count: number; amount: number; refunded: number }[]>`
        SELECT p.method::text AS method, count(*)::int AS count, COALESCE(sum(p."amountCents"), 0)::float8 AS amount, COALESCE(sum(p."refundedCents"), 0)::float8 AS refunded
        FROM payments p
        WHERE p."tenantId" = ${ctx.tenantId}::uuid AND p.status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
          AND p."paidAt" >= ${ctx.fromSql} AND p."paidAt" < ${ctx.toSql} ${companyOfPayment}
        GROUP BY 1 ORDER BY amount DESC`,
      this.prisma.$queryRaw<{ status: string; count: number }[]>`
        SELECT p.status::text AS status, count(*)::int AS count
        FROM payments p
        WHERE p."tenantId" = ${ctx.tenantId}::uuid AND p."createdAt" >= ${ctx.fromSql} AND p."createdAt" < ${ctx.toSql} ${companyOfPayment}
        GROUP BY 1`,
      this.prisma.$queryRaw<{ count: number; amount: number; to_wallet: number }[]>`
        SELECT count(*)::int AS count, COALESCE(sum(r."amountCents"), 0)::float8 AS amount, COALESCE(sum(r."amountCents") FILTER (WHERE r."toWallet"), 0)::float8 AS to_wallet
        FROM refunds r JOIN payments p ON p.id = r."paymentId"
        WHERE p."tenantId" = ${ctx.tenantId}::uuid AND r.status = 'SUCCEEDED' AND r."createdAt" >= ${ctx.fromSql} AND r."createdAt" < ${ctx.toSql} ${companyOfPayment}`,
      this.prisma.$queryRaw<{ reason: string; count: number; amount: number }[]>`
        SELECT r.reason, count(*)::int AS count, COALESCE(sum(r."amountCents"), 0)::float8 AS amount
        FROM refunds r JOIN payments p ON p.id = r."paymentId"
        WHERE p."tenantId" = ${ctx.tenantId}::uuid AND r.status = 'SUCCEEDED' AND r."createdAt" >= ${ctx.fromSql} AND r."createdAt" < ${ctx.toSql} ${companyOfPayment}
        GROUP BY 1 ORDER BY amount DESC LIMIT 15`,
      query.companyId
        ? Promise.resolve([] as { owner: string; count: number; amount: number }[])
        : this.prisma.$queryRaw<{ owner: string; count: number; amount: number }[]>`
            SELECT w."ownerType"::text AS owner, count(*)::int AS count, COALESCE(sum(x."amountCents"), 0)::float8 AS amount
            FROM withdrawals x JOIN wallets w ON w.id = x."walletId"
            WHERE x."tenantId" = ${ctx.tenantId}::uuid AND x.status = 'PAID' AND x."paidAt" >= ${ctx.fromSql} AND x."paidAt" < ${ctx.toSql}
            GROUP BY 1`,
    ]);

    const cat = Object.fromEntries(byCategory.map((row) => [row.category, num(row.amount)])) as Record<string, number>;
    const get = (key: string) => cat[key] ?? 0;
    const net = byCategory.reduce((sum, row) => sum + num(row.amount), 0);
    const paid = payments.reduce((sum, row) => sum + num(row.amount), 0);
    const statusMap = Object.fromEntries(paymentStatus.map((row) => [row.status, row.count])) as Record<string, number>;
    const attempts = Object.values(statusMap).reduce((sum, value) => sum + value, 0);
    const methodLabels: Record<string, string> = { PIX: 'PIX', CREDIT_CARD: 'Cartão de crédito', DEBIT_CARD: 'Cartão de débito', WALLET: 'Carteira', CASH: 'Dinheiro', INVOICE: 'Faturado' };
    const ownerLabels: Record<string, string> = { DRIVER: 'Entregadores', COMPANY: 'Empresas', CUSTOMER: 'Clientes', PLATFORM: 'Plataforma' };

    const result: ReportResult = {
      kind: 'financial',
      title: 'Relatório financeiro',
      range: this.rangeOf(ctx),
      summary: [
        { key: 'revenue', label: 'Receita líquida da plataforma', type: 'money', value: net },
        { key: 'commission', label: 'Comissões', type: 'money', value: get('commission') },
        { key: 'serviceFees', label: 'Taxas de serviço', type: 'money', value: get('serviceFees') },
        { key: 'deliveryFees', label: 'Taxas de entrega', type: 'money', value: get('deliveryFees') },
        { key: 'driverPayouts', label: 'Repasses a entregadores', type: 'money', value: -get('driverPayouts') },
        { key: 'discounts', label: 'Cupons custeados pela plataforma', type: 'money', value: -get('discounts') },
        { key: 'refunds', label: 'Estornos (parte da plataforma)', type: 'money', value: -get('refunds') },
        { key: 'paymentsReceived', label: 'Pagamentos recebidos', type: 'money', value: paid },
        { key: 'refundsTotal', label: 'Estornos aos clientes', type: 'money', value: num(refunds[0]?.amount) },
        { key: 'paymentApproval', label: 'Aprovação de pagamentos', type: 'percent', value: ratio((statusMap.PAID ?? 0) + (statusMap.PARTIALLY_REFUNDED ?? 0) + (statusMap.REFUNDED ?? 0) + (statusMap.AUTHORIZED ?? 0), attempts) },
      ],
      series: {
        buckets: ctx.buckets,
        lines: [
          this.line(ctx, series, 'net', 'Receita líquida', 'money'),
          this.line(ctx, series, 'commission', 'Comissões', 'money'),
          this.line(ctx, series, 'fees', 'Taxas', 'money'),
          this.line(ctx, series, 'payouts', 'Repasses a entregadores', 'money'),
        ],
      },
      tables: {},
    };
    result.tables = {
      series: this.seriesTable(result),
      composition: {
        title: 'Composição da receita',
        columns: [
          { key: 'item', label: 'Item', type: 'text' },
          { key: 'amount', label: 'Valor', type: 'money' },
        ],
        rows: [
          { item: 'Comissões', amount: get('commission') },
          { item: 'Taxas de serviço', amount: get('serviceFees') },
          { item: 'Taxas de entrega', amount: get('deliveryFees') },
          { item: 'Repasses a entregadores', amount: get('driverPayouts') },
          { item: 'Cupons (plataforma)', amount: get('discounts') },
          { item: 'Estornos (plataforma)', amount: get('refunds') },
          { item: 'Ajustes', amount: get('adjustments') },
          { item: 'Outros', amount: get('other') },
          { item: 'Receita líquida', amount: net },
        ],
      },
      payments: {
        title: 'Pagamentos recebidos por forma',
        columns: [
          { key: 'method', label: 'Forma', type: 'text' },
          { key: 'count', label: 'Pagamentos', type: 'int' },
          { key: 'amount', label: 'Valor', type: 'money' },
          { key: 'refunded', label: 'Estornado', type: 'money' },
        ],
        rows: payments.map((row) => ({ ...row, method: methodLabels[row.method] ?? row.method })),
      },
      refunds: {
        title: 'Estornos por motivo',
        columns: [
          { key: 'reason', label: 'Motivo', type: 'text' },
          { key: 'count', label: 'Estornos', type: 'int' },
          { key: 'amount', label: 'Valor', type: 'money' },
        ],
        rows: refundReasons,
      },
      withdrawals: {
        title: 'Saques pagos',
        columns: [
          { key: 'owner', label: 'Para', type: 'text' },
          { key: 'count', label: 'Saques', type: 'int' },
          { key: 'amount', label: 'Valor', type: 'money' },
        ],
        rows: withdrawals.map((row) => ({ ...row, owner: ownerLabels[row.owner] ?? row.owner })),
      },
    };
    return result;
  }

  // ---------------------------------------------------------------------------
  // Entregadores: ganhos, entregas, km e avaliações
  // ---------------------------------------------------------------------------

  async drivers(user: AuthUser, query: ReportQuery): Promise<ReportResult> {
    const ctx = await this.context(user.tenantId, query);
    const tolerance = Prisma.sql`make_interval(mins => ${ctx.lateToleranceMinutes}::int)`;
    const base = Prisma.sql`
      SELECT d."driverId", d.status, d."distanceKm", d."payoutCents", d."tipCents", d."deliveredAt",
             COALESCE(d."deliveredAt", d."canceledAt", d."failedAt") AS finished,
             COALESCE(o."estimatedDeliveryAt", COALESCE(d."scheduledFor", d."createdAt") + make_interval(mins => d."durationMin" + ${ctx.bufferMinutes}::int)) AS promised
      FROM deliveries d
      LEFT JOIN orders o ON o.id = d."orderId"
      WHERE d."tenantId" = ${ctx.tenantId}::uuid AND d."driverId" IS NOT NULL AND d.status IN ('DELIVERED', 'CANCELED', 'FAILED')
        AND COALESCE(d."deliveredAt", d."canceledAt", d."failedAt") >= ${ctx.fromSql}
        AND COALESCE(d."deliveredAt", d."canceledAt", d."failedAt") < ${ctx.toSql}
        ${query.city ? Prisma.sql`AND lower(d.city) = lower(${query.city})` : Prisma.empty}`;
    const delivered = Prisma.sql`status = 'DELIVERED'`;

    const [totals, series, perDriver, ratings, offers] = await Promise.all([
      this.prisma.$queryRaw<Record<string, number>[]>`
        WITH base AS (${base})
        SELECT (count(DISTINCT "driverId") FILTER (WHERE ${delivered}))::int AS drivers,
               (count(*) FILTER (WHERE ${delivered}))::int AS delivered,
               (count(*) FILTER (WHERE status <> 'DELIVERED'))::int AS not_completed,
               COALESCE(sum("distanceKm") FILTER (WHERE ${delivered}), 0)::float8 AS km,
               COALESCE(sum("payoutCents" + "tipCents") FILTER (WHERE ${delivered}), 0)::float8 AS earnings,
               COALESCE(sum("tipCents") FILTER (WHERE ${delivered}), 0)::float8 AS tips,
               (count(*) FILTER (WHERE ${delivered} AND "deliveredAt" <= promised + ${tolerance}))::int AS on_time
        FROM base`,
      this.prisma.$queryRaw<{ bucket: string; delivered: number; earnings: number; km: number; drivers: number }[]>`
        WITH base AS (${base})
        SELECT ${this.bucket(ctx, Prisma.sql`finished`)} AS bucket,
               (count(*) FILTER (WHERE ${delivered}))::int AS delivered,
               COALESCE(sum("payoutCents" + "tipCents") FILTER (WHERE ${delivered}), 0)::float8 AS earnings,
               COALESCE(sum("distanceKm") FILTER (WHERE ${delivered}), 0)::float8 AS km,
               (count(DISTINCT "driverId") FILTER (WHERE ${delivered}))::int AS drivers
        FROM base GROUP BY 1`,
      this.prisma.$queryRaw<{ driver_id: string; name: string; delivered: number; not_completed: number; km: number; earnings: number; tips: number; on_time: number }[]>`
        WITH base AS (${base})
        SELECT b."driverId" AS driver_id, u.name,
               (count(*) FILTER (WHERE b.${delivered}))::int AS delivered,
               (count(*) FILTER (WHERE b.status <> 'DELIVERED'))::int AS not_completed,
               COALESCE(sum(b."distanceKm") FILTER (WHERE b.${delivered}), 0)::float8 AS km,
               COALESCE(sum(b."payoutCents" + b."tipCents") FILTER (WHERE b.${delivered}), 0)::float8 AS earnings,
               COALESCE(sum(b."tipCents") FILTER (WHERE b.${delivered}), 0)::float8 AS tips,
               (count(*) FILTER (WHERE b.${delivered} AND b."deliveredAt" <= b.promised + ${tolerance}))::int AS on_time
        FROM base b JOIN drivers dr ON dr.id = b."driverId" JOIN users u ON u.id = dr."userId"
        GROUP BY b."driverId", u.name ORDER BY delivered DESC, earnings DESC LIMIT 500`,
      this.prisma.$queryRaw<{ driver_id: string; average: number; count: number }[]>`
        SELECT r."subjectId" AS driver_id, avg(r.rating)::float8 AS average, count(*)::int AS count
        FROM reviews r
        WHERE r."tenantId" = ${ctx.tenantId}::uuid AND r."subjectType" = 'DRIVER' AND NOT r."isHidden"
          AND r."createdAt" >= ${ctx.fromSql} AND r."createdAt" < ${ctx.toSql}
        GROUP BY 1`,
      this.prisma.$queryRaw<{ driver_id: string; accepted: number; answered: number }[]>`
        SELECT f."driverId" AS driver_id,
               (count(*) FILTER (WHERE f.status = 'ACCEPTED'))::int AS accepted,
               (count(*) FILTER (WHERE f.status IN ('ACCEPTED', 'DECLINED', 'EXPIRED')))::int AS answered
        FROM delivery_offers f JOIN drivers dr ON dr.id = f."driverId"
        WHERE dr."tenantId" = ${ctx.tenantId}::uuid AND f."createdAt" >= ${ctx.fromSql} AND f."createdAt" < ${ctx.toSql}
        GROUP BY 1`,
    ]);

    const t = totals[0];
    const ratingOf = new Map(ratings.map((row) => [row.driver_id, row]));
    const offersOf = new Map(offers.map((row) => [row.driver_id, row]));
    const ratingCount = ratings.reduce((sum, row) => sum + row.count, 0);
    const ratingAvg = ratingCount ? ratings.reduce((sum, row) => sum + row.average * row.count, 0) / ratingCount : null;
    const accepted = offers.reduce((sum, row) => sum + row.accepted, 0);
    const answered = offers.reduce((sum, row) => sum + row.answered, 0);

    const result: ReportResult = {
      kind: 'drivers',
      title: 'Relatório de entregadores',
      range: this.rangeOf(ctx),
      summary: [
        { key: 'activeDrivers', label: 'Entregadores ativos', type: 'int', value: num(t.drivers) },
        { key: 'delivered', label: 'Entregas concluídas', type: 'int', value: num(t.delivered) },
        { key: 'earnings', label: 'Ganhos dos entregadores', type: 'money', value: num(t.earnings) },
        { key: 'tips', label: 'Gorjetas', type: 'money', value: num(t.tips) },
        { key: 'avgPerDelivery', label: 'Ganho médio por entrega', type: 'money', value: num(t.delivered) ? Math.round(num(t.earnings) / num(t.delivered)) : null },
        { key: 'km', label: 'Km rodados (rotas)', type: 'decimal', value: round1(t.km) },
        { key: 'rating', label: 'Avaliação média', type: 'decimal', value: ratingAvg == null ? null : Math.round(ratingAvg * 100) / 100 },
        { key: 'acceptance', label: 'Aceite de ofertas', type: 'percent', value: ratio(accepted, answered) },
        { key: 'sla', label: 'Entregas no prazo', type: 'percent', value: ratio(num(t.on_time), num(t.delivered)) },
      ],
      series: {
        buckets: ctx.buckets,
        lines: [
          this.line(ctx, series, 'delivered', 'Entregas', 'int'),
          this.line(ctx, series, 'earnings', 'Ganhos', 'money'),
          this.line(ctx, series, 'km', 'Km', 'decimal'),
          this.line(ctx, series, 'drivers', 'Entregadores ativos', 'int'),
        ],
      },
      tables: {},
    };
    result.tables = {
      drivers: {
        title: 'Desempenho por entregador',
        columns: [
          { key: 'name', label: 'Entregador', type: 'text' },
          { key: 'delivered', label: 'Entregas', type: 'int' },
          { key: 'notCompleted', label: 'Canceladas/falhas', type: 'int' },
          { key: 'km', label: 'Km', type: 'decimal' },
          { key: 'earnings', label: 'Ganhos', type: 'money' },
          { key: 'tips', label: 'Gorjetas', type: 'money' },
          { key: 'sla', label: 'No prazo', type: 'percent' },
          { key: 'rating', label: 'Avaliação', type: 'decimal' },
          { key: 'ratings', label: 'Nº de avaliações', type: 'int' },
          { key: 'acceptance', label: 'Aceite', type: 'percent' },
        ],
        rows: perDriver.map((row) => {
          const rating = ratingOf.get(row.driver_id);
          const offer = offersOf.get(row.driver_id);
          return {
            id: row.driver_id,
            name: row.name,
            delivered: row.delivered,
            notCompleted: row.not_completed,
            km: round1(row.km),
            earnings: row.earnings,
            tips: row.tips,
            sla: ratio(row.on_time, row.delivered),
            rating: rating ? Math.round(rating.average * 100) / 100 : null,
            ratings: rating?.count ?? 0,
            acceptance: offer ? ratio(offer.accepted, offer.answered) : null,
          };
        }),
      },
    };
    result.tables.series = this.seriesTable(result);
    return result;
  }

  async report(kind: ReportKind, user: AuthUser, query: ReportQuery): Promise<ReportResult> {
    switch (kind) {
      case 'commercial':
        return this.commercial(user, query);
      case 'operational':
        return this.operational(user, query);
      case 'financial':
        return this.financial(user, query);
      case 'drivers':
        return this.drivers(user, query);
      case 'corporate':
        if (!query.companyId) throw new NotFoundException('Empresa não informada.');
        return this.corporate(user.tenantId, query.companyId, query);
    }
  }

  // ---------------------------------------------------------------------------
  // Corporativo (portal da empresa): entregas, gasto, SLA e centros de custo
  // ---------------------------------------------------------------------------

  async corporate(tenantId: string, companyId: string, query: ReportQuery): Promise<ReportResult> {
    const ctx = await this.context(tenantId, query);
    const tolerance = Prisma.sql`make_interval(mins => ${ctx.lateToleranceMinutes}::int)`;
    const base = Prisma.sql`
      SELECT d.id, d.status, d."createdAt", d."deliveredAt", d."pickedUpAt", d."costCenterId", d."batchId", d."paymentMethod", d."distanceKm",
             CASE WHEN d.status = 'CANCELED' THEN 0 WHEN d.status = 'FAILED' THEN d."feeCents" ELSE d."feeCents" + d."tipCents" END AS charged,
             COALESCE(d."scheduledFor", d."createdAt") + make_interval(mins => d."durationMin" + ${ctx.bufferMinutes}::int) AS promised,
             COALESCE(d."scheduledFor", d."createdAt") AS started,
             d.dropoff->>'city' AS city
      FROM deliveries d
      WHERE d."companyId" = ${companyId}::uuid AND d.kind = 'ON_DEMAND' AND d."tenantId" = ${tenantId}::uuid
        AND d."createdAt" >= ${ctx.fromSql} AND d."createdAt" < ${ctx.toSql}
        ${query.costCenterId ? Prisma.sql`AND d."costCenterId" = ${query.costCenterId}::uuid` : Prisma.empty}`;
    const delivered = Prisma.sql`status = 'DELIVERED'`;
    const onTime = Prisma.sql`status = 'DELIVERED' AND "deliveredAt" <= promised + ${tolerance}`;

    const [totals, series, centers, cities] = await Promise.all([
      this.prisma.$queryRaw<Record<string, number | null>[]>`
        WITH base AS (${base})
        SELECT count(*)::int AS total,
               (count(*) FILTER (WHERE ${delivered}))::int AS delivered,
               (count(*) FILTER (WHERE status = 'FAILED'))::int AS failed,
               (count(*) FILTER (WHERE status = 'CANCELED'))::int AS canceled,
               (count(*) FILTER (WHERE ${onTime}))::int AS on_time,
               COALESCE(sum(charged), 0)::float8 AS spend,
               COALESCE(sum(charged) FILTER (WHERE "paymentMethod" = 'INVOICE'), 0)::float8 AS invoiced,
               (count(*) FILTER (WHERE "batchId" IS NOT NULL))::int AS batched,
               (avg(EXTRACT(EPOCH FROM ("deliveredAt" - started)) / 60) FILTER (WHERE ${delivered}))::float8 AS avg_total,
               COALESCE(sum("distanceKm") FILTER (WHERE ${delivered}), 0)::float8 AS km
        FROM base`,
      this.prisma.$queryRaw<{ bucket: string; total: number; delivered: number; spend: number; on_time: number }[]>`
        WITH base AS (${base})
        SELECT ${this.bucket(ctx, Prisma.sql`"createdAt"`)} AS bucket, count(*)::int AS total,
               (count(*) FILTER (WHERE ${delivered}))::int AS delivered,
               COALESCE(sum(charged), 0)::float8 AS spend,
               (count(*) FILTER (WHERE ${onTime}))::int AS on_time
        FROM base GROUP BY 1`,
      this.prisma.$queryRaw<{ cost_center_id: string | null; total: number; delivered: number; on_time: number; spend: number }[]>`
        WITH base AS (${base})
        SELECT "costCenterId" AS cost_center_id, count(*)::int AS total,
               (count(*) FILTER (WHERE ${delivered}))::int AS delivered,
               (count(*) FILTER (WHERE ${onTime}))::int AS on_time,
               COALESCE(sum(charged), 0)::float8 AS spend
        FROM base GROUP BY 1 ORDER BY spend DESC`,
      this.prisma.$queryRaw<{ city: string | null; total: number; spend: number }[]>`
        WITH base AS (${base})
        SELECT city, count(*)::int AS total, COALESCE(sum(charged), 0)::float8 AS spend
        FROM base GROUP BY 1 ORDER BY total DESC LIMIT 30`,
    ]);
    const names = await this.prisma.costCenter.findMany({ where: { companyId }, select: { id: true, code: true, name: true, monthlyBudgetCents: true } });
    const nameOf = new Map(names.map((center) => [center.id, center]));
    const t = totals[0];
    const slaSeries = series.map((row) => ({ bucket: row.bucket, sla: ratio(row.on_time, row.delivered) ?? 0 }));
    const result: ReportResult = {
      kind: 'corporate',
      title: 'Relatório corporativo',
      range: this.rangeOf(ctx),
      summary: [
        { key: 'deliveries', label: 'Entregas solicitadas', type: 'int', value: num(t.total) },
        { key: 'delivered', label: 'Entregues', type: 'int', value: num(t.delivered) },
        { key: 'spend', label: 'Gasto no período', type: 'money', value: num(t.spend) },
        { key: 'invoiced', label: 'Faturado (contrato)', type: 'money', value: num(t.invoiced) },
        { key: 'avgCost', label: 'Custo médio por entrega', type: 'money', value: num(t.delivered) + num(t.failed) ? Math.round(num(t.spend) / (num(t.delivered) + num(t.failed))) : null },
        { key: 'sla', label: 'Entregas no prazo', type: 'percent', value: ratio(num(t.on_time), num(t.delivered)) },
        { key: 'avgTotal', label: 'Tempo médio de entrega', type: 'minutes', value: round1(t.avg_total) },
        { key: 'failed', label: 'Não realizadas', type: 'int', value: num(t.failed) },
        { key: 'canceled', label: 'Canceladas', type: 'int', value: num(t.canceled) },
        { key: 'batched', label: 'Entregas em lote', type: 'int', value: num(t.batched) },
      ],
      series: {
        buckets: ctx.buckets,
        lines: [
          this.line(ctx, series, 'spend', 'Gasto', 'money'),
          this.line(ctx, series, 'total', 'Entregas', 'int'),
          this.line(ctx, series, 'delivered', 'Entregues', 'int'),
          this.line(ctx, slaSeries, 'sla', 'No prazo (%)', 'percent'),
        ],
      },
      tables: {},
    };
    result.tables = {
      costCenters: {
        title: 'Por centro de custo',
        columns: [
          { key: 'costCenter', label: 'Centro de custo', type: 'text' },
          { key: 'total', label: 'Entregas', type: 'int' },
          { key: 'delivered', label: 'Entregues', type: 'int' },
          { key: 'sla', label: 'No prazo', type: 'percent' },
          { key: 'spend', label: 'Gasto', type: 'money' },
          { key: 'budget', label: 'Orçamento mensal', type: 'money' },
        ],
        rows: centers.map((row) => {
          const center = row.cost_center_id ? nameOf.get(row.cost_center_id) : undefined;
          return {
            costCenter: center ? `${center.code} — ${center.name}` : 'Sem centro de custo',
            total: row.total,
            delivered: row.delivered,
            sla: ratio(row.on_time, row.delivered),
            spend: row.spend,
            budget: center?.monthlyBudgetCents ?? null,
          };
        }),
      },
      cities: {
        title: 'Destinos por cidade',
        columns: [
          { key: 'city', label: 'Cidade', type: 'text' },
          { key: 'total', label: 'Entregas', type: 'int' },
          { key: 'spend', label: 'Gasto', type: 'money' },
        ],
        rows: cities.map((row) => ({ city: row.city ?? '—', total: row.total, spend: row.spend })),
      },
    };
    result.tables.series = this.seriesTable(result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // CSV (separador ";" e BOM, como o Excel em português espera)
  // ---------------------------------------------------------------------------

  toCsv(table: ReportTable): string {
    const format = (value: unknown, type: ColumnType): string => {
      if (value == null || value === '') return '';
      switch (type) {
        case 'money':
          return (Number(value) / 100).toFixed(2).replace('.', ',');
        case 'percent':
        case 'decimal':
        case 'minutes':
          return Number(value).toFixed(1).replace('.', ',');
        case 'int':
          return String(Math.round(Number(value)));
        default: {
          const text = String(value);
          // Proteção contra injeção de fórmulas ao abrir na planilha.
          return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
        }
      }
    };
    const escape = (text: string) => (/[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
    const lines = [
      table.columns.map((column) => escape(column.label)).join(';'),
      ...table.rows.map((row) => table.columns.map((column) => escape(format(row[column.key], column.type))).join(';')),
    ];
    return `﻿${lines.join('\r\n')}\r\n`;
  }

  // ---------------------------------------------------------------------------
  // Painel da empresa
  // ---------------------------------------------------------------------------

  async companyDashboard(companyId: string, period: Period) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { id: true, timezone: true, ratingAvg: true, ratingCount: true } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    const tz = company.timezone;
    const { from, to } = periodRange(period, tz);
    const fromSql = utcTimestamp(from);
    const toSql = utcTimestamp(to);
    const base = Prisma.sql`
      SELECT o.id, o.status, o.fulfillment, o."totalCents", o."subtotalCents", o."createdAt", o."confirmedAt", o."readyAt", o."deliveredAt", o."canceledBy"
      FROM orders o
      WHERE o."companyId" = ${companyId}::uuid AND o.status <> 'PENDING_PAYMENT' AND o."createdAt" >= ${fromSql} AND o."createdAt" < ${toSql}`;
    const sold = Prisma.sql`status <> 'CANCELED'`;
    const bucketUnit = period === 'today' ? 'hour' : 'day';
    const bucketExpr = Prisma.sql`to_char(date_trunc(${bucketUnit}, ${localTime(Prisma.sql`"createdAt"`, tz)}), ${period === 'today' ? 'HH24' : 'YYYY-MM-DD'})`;

    const [totals, inProgress, series, products, ledger, visits, reviews, cancellations] = await Promise.all([
      this.prisma.$queryRaw<Record<string, number | null>[]>`
        WITH base AS (${base})
        SELECT count(*)::int AS received,
               (count(*) FILTER (WHERE ${sold}))::int AS orders,
               (count(*) FILTER (WHERE status = 'DELIVERED'))::int AS completed,
               (count(*) FILTER (WHERE status = 'CANCELED'))::int AS canceled,
               (count(*) FILTER (WHERE "confirmedAt" IS NOT NULL))::int AS accepted,
               COALESCE(sum("totalCents") FILTER (WHERE ${sold}), 0)::float8 AS gmv,
               COALESCE(sum("subtotalCents") FILTER (WHERE ${sold}), 0)::float8 AS sales,
               (avg(EXTRACT(EPOCH FROM ("readyAt" - "confirmedAt")) / 60) FILTER (WHERE "readyAt" IS NOT NULL AND "confirmedAt" IS NOT NULL))::float8 AS avg_prep,
               (avg(EXTRACT(EPOCH FROM ("deliveredAt" - "createdAt")) / 60) FILTER (WHERE status = 'DELIVERED' AND fulfillment = 'DELIVERY'))::float8 AS avg_delivery
        FROM base`,
      this.prisma.order.count({ where: { companyId, status: { in: ['NEW', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'DRIVER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'] } } }),
      this.prisma.$queryRaw<{ bucket: string; orders: number; gmv: number }[]>`
        WITH base AS (${base})
        SELECT ${bucketExpr} AS bucket, (count(*) FILTER (WHERE ${sold}))::int AS orders, COALESCE(sum("totalCents") FILTER (WHERE ${sold}), 0)::float8 AS gmv
        FROM base GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ product: string; quantity: number; revenue: number }[]>`
        SELECT i."productName" AS product, sum(i.quantity)::int AS quantity, sum(i."totalCents")::float8 AS revenue
        FROM order_items i JOIN orders o ON o.id = i."orderId"
        WHERE o."companyId" = ${companyId}::uuid AND o.status NOT IN ('PENDING_PAYMENT', 'CANCELED') AND o."createdAt" >= ${fromSql} AND o."createdAt" < ${toSql}
        GROUP BY 1 ORDER BY revenue DESC LIMIT 10`,
      this.prisma.$queryRaw<{ type: string; amount: number }[]>`
        SELECT t.type::text AS type, COALESCE(sum(t."amountCents"), 0)::float8 AS amount
        FROM wallet_transactions t JOIN wallets w ON w.id = t."walletId"
        WHERE w."companyId" = ${companyId}::uuid AND t.status <> 'CANCELED' AND t."createdAt" >= ${fromSql} AND t."createdAt" < ${toSql}
        GROUP BY 1`,
      this.prisma.$queryRaw<{ visits: number }[]>`
        SELECT COALESCE(sum(visits), 0)::int AS visits FROM store_visits_daily
        WHERE "companyId" = ${companyId}::uuid AND day >= ${formatLocalDate(from, tz)}::date AND day <= ${formatLocalDate(to, tz)}::date`,
      this.prisma.review.aggregate({
        where: { subjectType: 'COMPANY', subjectId: companyId, isHidden: false, createdAt: { gte: from, lt: to } },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<{ actor: string | null; count: number }[]>`
        WITH base AS (${base}) SELECT "canceledBy"::text AS actor, count(*)::int AS count FROM base WHERE status = 'CANCELED' GROUP BY 1`,
    ]);

    const t = totals[0];
    const entry = Object.fromEntries(ledger.map((row) => [row.type, num(row.amount)])) as Record<string, number>;
    const fees = -((entry.COMMISSION ?? 0) + (entry.FEE ?? 0));
    const net = ['SALE', 'TIP', 'COMMISSION', 'FEE', 'DISCOUNT', 'REFUND', 'ADJUSTMENT'].reduce((sum, key) => sum + (entry[key] ?? 0), 0);
    const orders = num(t.orders);
    const buckets =
      period === 'today'
        ? Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'))
        : bucketKeys(formatLocalDate(from, tz), formatLocalDate(to, tz), 'day');
    const byBucket = new Map(series.map((row) => [row.bucket, row]));
    return {
      period,
      from,
      to,
      timeZone: tz,
      sales: { gmvCents: num(t.gmv), productSalesCents: num(t.sales), averageTicketCents: orders ? Math.round(num(t.gmv) / orders) : null },
      orders: { received: num(t.received), sold: orders, inProgress, completed: num(t.completed), canceled: num(t.canceled) },
      finance: {
        /** Recebido no período (vendas + gorjetas − comissão − taxas − cupons custeados − estornos). */
        netRevenueCents: net,
        salesCents: entry.SALE ?? 0,
        feesCents: fees,
        commissionCents: -(entry.COMMISSION ?? 0),
        discountsCents: -(entry.DISCOUNT ?? 0),
      },
      rates: {
        acceptance: ratio(num(t.accepted), num(t.received)),
        cancellation: ratio(num(t.canceled), num(t.received)),
        conversion: ratio(num(t.received), num(visits[0]?.visits)),
        storeVisits: num(visits[0]?.visits),
      },
      times: { avgPrepMinutes: round1(t.avg_prep), avgDeliveryMinutes: round1(t.avg_delivery) },
      rating: {
        average: company.ratingAvg ? Math.round(company.ratingAvg * 100) / 100 : null,
        count: company.ratingCount,
        periodAverage: reviews._avg.rating == null ? null : Math.round(reviews._avg.rating * 100) / 100,
        periodCount: reviews._count._all,
      },
      topProducts: products,
      series: {
        unit: bucketUnit,
        buckets,
        orders: buckets.map((bucket) => num(byBucket.get(bucket)?.orders)),
        gmv: buckets.map((bucket) => num(byBucket.get(bucket)?.gmv)),
      },
      cancellations: cancellations.map((row) => ({ actor: row.actor ?? 'UNKNOWN', count: row.count })),
    };
  }

  // ---------------------------------------------------------------------------
  // Painel geral da plataforma (complementa o painel administrativo)
  // ---------------------------------------------------------------------------

  async platformOverview(user: AuthUser) {
    const tenantId = user.tenantId;
    const ops = await this.settings.get(tenantId, 'operations');
    const now = new Date();
    const dayStart = startOfLocalDay(now, ops.timeZone);
    const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
    const canOrders = user.can('orders.read');
    const canFinance = user.can('finance.reports');
    const canSupport = user.can('support.tickets.read');

    const soldStatuses = { notIn: ['PENDING_PAYMENT', 'CANCELED'] as ('PENDING_PAYMENT' | 'CANCELED')[] };
    const [today, today30, deliveriesToday, driversNow, tickets, ratings, revenue] = await Promise.all([
      canOrders
        ? Promise.all([
            this.prisma.order.aggregate({ where: { tenantId, createdAt: { gte: dayStart }, status: soldStatuses }, _sum: { totalCents: true }, _count: { _all: true } }),
            this.prisma.order.count({ where: { tenantId, createdAt: { gte: dayStart }, status: 'CANCELED' } }),
          ])
        : null,
      canOrders
        ? Promise.all([
            this.prisma.order.aggregate({ where: { tenantId, createdAt: { gte: monthAgo }, status: soldStatuses }, _sum: { totalCents: true }, _count: { _all: true } }),
            this.prisma.order.count({ where: { tenantId, createdAt: { gte: monthAgo }, status: 'CANCELED' } }),
          ])
        : null,
      canOrders
        ? this.prisma.delivery.groupBy({ by: ['status'], where: { tenantId, OR: [{ createdAt: { gte: dayStart } }, { deliveredAt: { gte: dayStart } }] }, _count: { _all: true } })
        : null,
      this.prisma.driver.groupBy({ by: ['availability'], where: { tenantId, availability: { in: ['ONLINE', 'BUSY'] } }, _count: { _all: true } }),
      canSupport
        ? Promise.all([
            this.prisma.supportTicket.count({ where: { tenantId, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_REQUESTER'] } } }),
            this.prisma.supportTicket.count({ where: { tenantId, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_REQUESTER'] }, slaBreachedAt: { not: null } } }),
          ])
        : null,
      this.prisma.review.groupBy({ by: ['subjectType'], where: { tenantId, isHidden: false, createdAt: { gte: monthAgo } }, _avg: { rating: true }, _count: { _all: true } }),
      canFinance
        ? this.prisma.$queryRaw<{ type: string; amount: number }[]>`
            SELECT t.type::text AS type, COALESCE(sum(t."amountCents"), 0)::float8 AS amount
            FROM wallet_transactions t JOIN wallets w ON w.id = t."walletId"
            WHERE w."tenantId" = ${tenantId}::uuid AND w."ownerType" = 'PLATFORM' AND t.status <> 'CANCELED' AND t."createdAt" >= ${utcTimestamp(monthAgo)}
            GROUP BY 1`
        : null,
    ]);

    const deliveries = deliveriesToday ? (Object.fromEntries(deliveriesToday.map((row) => [row.status, row._count._all])) as Record<string, number>) : null;
    const drivers = Object.fromEntries(driversNow.map((row) => [row.availability, row._count._all])) as Record<string, number>;
    const ledger = revenue ? (Object.fromEntries(revenue.map((row) => [row.type, num(row.amount)])) as Record<string, number>) : null;
    const rating = (subject: string) => {
      const row = ratings.find((item) => item.subjectType === subject);
      return row ? { average: row._avg.rating == null ? null : Math.round(row._avg.rating * 100) / 100, count: row._count._all } : { average: null, count: 0 };
    };
    return {
      timeZone: ops.timeZone,
      today: today
        ? {
            orders: today[0]._count._all,
            gmvCents: today[0]._sum.totalCents ?? 0,
            averageTicketCents: today[0]._count._all ? Math.round((today[0]._sum.totalCents ?? 0) / today[0]._count._all) : null,
            canceledOrders: today[1],
            deliveriesCompleted: deliveries?.DELIVERED ?? 0,
            deliveriesCanceled: (deliveries?.CANCELED ?? 0) + (deliveries?.FAILED ?? 0),
          }
        : null,
      last30Days: today30
        ? {
            orders: today30[0]._count._all,
            gmvCents: today30[0]._sum.totalCents ?? 0,
            cancellationRate: ratio(today30[1], today30[0]._count._all + today30[1]),
            ...(ledger
              ? {
                  commissionCents: ledger.COMMISSION ?? 0,
                  feesCents: ledger.FEE ?? 0,
                  netRevenueCents: Object.entries(ledger)
                    .filter(([type]) => !['WITHDRAWAL', 'WITHDRAWAL_REVERSAL', 'PAYMENT'].includes(type))
                    .reduce((sum, [, amount]) => sum + amount, 0),
                }
              : {}),
          }
        : null,
      driversNow: { online: drivers.ONLINE ?? 0, busy: drivers.BUSY ?? 0 },
      tickets: tickets ? { open: tickets[0], slaBreached: tickets[1] } : null,
      ratings: { companies: rating('COMPANY'), drivers: rating('DRIVER'), customers: rating('CUSTOMER') },
    };
  }
}
