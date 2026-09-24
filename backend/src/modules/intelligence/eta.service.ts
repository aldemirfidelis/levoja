import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { cityKey, etaBand } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { DeliveriesService } from '../logistics/deliveries.service';
import { OrdersService } from '../orders/orders.service';
import { utcTimestamp } from '../../common/sql';
import type { EtaCalibrationValue, EtaModel } from '../../common/eta-model';
import { median } from './forecast.engine';

interface Sample {
  city: string;
  vehicle: string;
  band: number;
  estimated: number;
  transit: number;
  pickup: number | null;
  dispatch: number | null;
}

interface TenantModel {
  timeZone: string;
  groups: Map<string, EtaCalibrationValue>;
}

const key = (city: string, vehicle: string, band: number) => `${city}|${vehicle}|${band}`;
const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Previsão do tempo de entrega calibrada pelo histórico:
 * - fator de trajeto (real ÷ estimado pela rota) por cidade, veículo e faixa horária, com
 *   recuo para grupos mais amplos quando há poucas amostras;
 * - medianas de espera por entregador e de deslocamento até a coleta;
 * - tempo de preparo real de cada loja (mediana confirmação → pronto).
 * Recalculada todas as noites; o erro médio antes/depois fica registrado para acompanhamento.
 */
@Injectable()
export class EtaService implements EtaModel, OnApplicationBootstrap {
  private readonly logger = new Logger(EtaService.name);
  private readonly models = new Map<string, TenantModel>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly deliveries: DeliveriesService,
    private readonly orders: OrdersService,
  ) {}

  async onApplicationBootstrap() {
    this.deliveries.registerEtaModel(this);
    this.orders.registerEtaModel(this);
    await this.load().catch((error) => this.logger.warn(`Calibração do tempo de entrega não carregada: ${(error as Error).message}`));
  }

  /** Carrega as calibrações gravadas (cada instância da API mantém a sua cópia em memória). */
  async load(tenantId?: string) {
    const rows = await this.prisma.etaCalibration.findMany({ where: tenantId ? { tenantId } : {} });
    const tenants = new Set(rows.map((row) => row.tenantId));
    if (tenantId) tenants.add(tenantId);
    for (const tenant of tenants) {
      const { timeZone } = await this.settings.get(tenant, 'operations');
      const groups = new Map<string, EtaCalibrationValue>();
      for (const row of rows.filter((item) => item.tenantId === tenant)) {
        groups.set(key(row.city, row.vehicle, row.band), { transitFactor: row.transitFactor, pickupMinutes: row.pickupMinutes, dispatchMinutes: row.dispatchMinutes });
      }
      this.models.set(tenant, { timeZone, groups });
    }
  }

  calibration(input: { tenantId: string; city?: string | null; state?: string | null; vehicleType?: string | null; at?: Date }): EtaCalibrationValue | null {
    const model = this.models.get(input.tenantId);
    if (!model?.groups.size) return null;
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: model.timeZone, hour: 'numeric', hourCycle: 'h23' }).format(input.at ?? new Date()));
    const band = etaBand(hour);
    const city = input.city ? cityKey(input.city, input.state) : '*';
    const vehicle = input.vehicleType ?? '*';
    for (const candidate of [key(city, vehicle, band), key(city, '*', band), key('*', vehicle, band), key('*', '*', band), key('*', '*', -1)]) {
      const found = model.groups.get(candidate);
      if (found) return found;
    }
    return null;
  }

  @Cron('0 40 3 * * *')
  async nightly() {
    const tenants = await this.prisma.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    for (const tenant of tenants) {
      try {
        await this.calibrate(tenant.id);
        await this.learnPrepTimes(tenant.id);
      } catch (error) {
        this.logger.error(`Calibração do tenant ${tenant.id} falhou: ${(error as Error).message}`);
      }
    }
  }

  async calibrate(tenantId: string, now = new Date()) {
    const [{ etaWindowDays, etaMinSamples }, { timeZone }] = await Promise.all([this.settings.get(tenantId, 'intelligence'), this.settings.get(tenantId, 'operations')]);
    const since = new Date(now.getTime() - etaWindowDays * 86_400_000);
    const rows = await this.prisma.$queryRaw<{ city: string | null; state: string | null; vehicleType: string; hour: number; estimated: number; transit: number; pickup: number | null; dispatch: number | null }[]>`
      SELECT city, state, "vehicleType"::text AS "vehicleType",
             extract(hour from (("pickedUpAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}))::int AS hour,
             "durationMin"::float8 AS estimated,
             (extract(epoch from ("deliveredAt" - "pickedUpAt")) / 60)::float8 AS transit,
             (extract(epoch from ("pickedUpAt" - "assignedAt")) / 60)::float8 AS pickup,
             (extract(epoch from ("assignedAt" - COALESCE("searchStartedAt", "createdAt"))) / 60)::float8 AS dispatch
      FROM deliveries
      WHERE "tenantId" = ${tenantId}::uuid AND status = 'DELIVERED' AND "deliveredAt" >= ${utcTimestamp(since)}
        AND "pickedUpAt" IS NOT NULL AND "durationMin" > 0 AND "deliveredAt" > "pickedUpAt"
      ORDER BY "deliveredAt" DESC
      LIMIT 50000`;
    // Descarta registros absurdos (entrega esquecida aberta, relógio errado).
    const samples: Sample[] = rows
      .filter((row) => row.transit > 0 && row.transit <= Math.max(240, row.estimated * 8))
      .map((row) => ({
        city: row.city ? cityKey(row.city, row.state) : '*',
        vehicle: row.vehicleType,
        band: etaBand(row.hour),
        estimated: row.estimated,
        transit: row.transit,
        pickup: row.pickup != null && row.pickup >= 0 && row.pickup <= 240 ? row.pickup : null,
        dispatch: row.dispatch != null && row.dispatch >= 0 && row.dispatch <= 240 ? row.dispatch : null,
      }));

    const groups = new Map<string, { city: string; vehicle: string; band: number; items: Sample[] }>();
    const add = (city: string, vehicle: string, band: number, sample: Sample) => {
      const id = key(city, vehicle, band);
      let group = groups.get(id);
      if (!group) groups.set(id, (group = { city, vehicle, band, items: [] }));
      group.items.push(sample);
    };
    for (const sample of samples) {
      add(sample.city, sample.vehicle, sample.band, sample);
      add(sample.city, '*', sample.band, sample);
      add('*', sample.vehicle, sample.band, sample);
      add('*', '*', sample.band, sample);
      add('*', '*', -1, sample);
    }
    const data = [...groups.values()]
      .filter((group) => group.items.length >= etaMinSamples)
      .map((group) => {
        const factor = Math.min(4, Math.max(0.5, median(group.items.map((item) => item.transit / item.estimated)) ?? 1));
        const mae = (predict: (item: Sample) => number) => round1(group.items.reduce((sum, item) => sum + Math.abs(item.transit - predict(item)), 0) / group.items.length);
        const pickups = group.items.map((item) => item.pickup).filter((value): value is number => value != null);
        const dispatches = group.items.map((item) => item.dispatch).filter((value): value is number => value != null);
        return {
          tenantId,
          city: group.city,
          vehicle: group.vehicle,
          band: group.band,
          transitFactor: Math.round(factor * 1000) / 1000,
          pickupMinutes: pickups.length ? round1(median(pickups)!) : null,
          dispatchMinutes: dispatches.length ? round1(median(dispatches)!) : null,
          samples: group.items.length,
          maeBeforeMin: mae((item) => item.estimated),
          maeAfterMin: mae((item) => item.estimated * factor),
        };
      });
    await this.prisma.$transaction([this.prisma.etaCalibration.deleteMany({ where: { tenantId } }), this.prisma.etaCalibration.createMany({ data })]);
    await this.load(tenantId);
    return { samples: samples.length, groups: data.length };
  }

  /** Tempo de preparo real por loja (mediana confirmação → pronto), com no mínimo 10 pedidos. */
  async learnPrepTimes(tenantId: string, now = new Date()) {
    const { etaWindowDays } = await this.settings.get(tenantId, 'intelligence');
    const since = new Date(now.getTime() - etaWindowDays * 86_400_000);
    const rows = await this.prisma.$queryRaw<{ companyId: string; minutes: number; samples: number }[]>`
      SELECT "companyId", percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch from ("readyAt" - "confirmedAt")) / 60)::float8 AS minutes, count(*)::int AS samples
      FROM orders
      WHERE "tenantId" = ${tenantId}::uuid AND "confirmedAt" >= ${utcTimestamp(since)} AND "readyAt" > "confirmedAt"
        AND "readyAt" - "confirmedAt" < interval '4 hours'
      GROUP BY "companyId"`;
    const learned = rows.filter((row) => row.samples >= 10);
    for (const row of learned) {
      await this.prisma.company.update({ where: { id: row.companyId }, data: { learnedPrepMinutes: Math.max(1, Math.min(240, Math.round(row.minutes))) } });
    }
    // Lojas sem histórico suficiente voltam a usar o tempo informado por elas.
    await this.prisma.company.updateMany({ where: { tenantId, learnedPrepMinutes: { not: null }, id: { notIn: learned.map((row) => row.companyId) } }, data: { learnedPrepMinutes: null } });
    return learned.length;
  }

  async view(tenantId: string) {
    const [rows, companies] = await Promise.all([
      this.prisma.etaCalibration.findMany({ where: { tenantId }, orderBy: [{ city: 'asc' }, { vehicle: 'asc' }, { band: 'asc' }] }),
      this.prisma.company.findMany({
        where: { tenantId, learnedPrepMinutes: { not: null } },
        select: { id: true, tradeName: true, averagePrepMinutes: true, learnedPrepMinutes: true },
        orderBy: { tradeName: 'asc' },
        take: 200,
      }),
    ]);
    const overall = rows.find((row) => row.city === '*' && row.vehicle === '*' && row.band === -1) ?? null;
    return { overall, groups: rows, companies, updatedAt: rows.reduce<Date | null>((latest, row) => (!latest || row.updatedAt > latest ? row.updatedAt : latest), null) };
  }
}
