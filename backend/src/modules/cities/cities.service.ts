import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { CITY_STATUS_LABELS, cityKey } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CacheService } from '../../infra/cache/cache.service';
import { MailService } from '../../infra/mail/mail.service';
import { JobsService } from '../../infra/jobs/jobs.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService, diff } from '../audit/audit.service';
import { TenantsService } from '../tenants/tenants.service';
import { utcTimestamp } from '../../common/sql';
import { Prisma } from '../../generated/prisma/client';
import type { CityStatus } from '../../generated/prisma/enums';

export interface CityInput {
  name: string;
  state: string;
  status?: CityStatus;
  timeZone?: string;
  centerLat?: number | null;
  centerLng?: number | null;
  message?: string | null;
}

export interface WaitlistInput {
  city: string;
  state: string;
  email: string;
  name?: string;
  profile: 'CUSTOMER' | 'COMPANY' | 'DRIVER';
}

export type CityGate = { operating: true; city: { id: string; name: string; status: CityStatus } | null } | { operating: false; reason: string; cityKey: string };

interface CachedCity {
  id: string;
  key: string;
  name: string;
  state: string;
  status: CityStatus;
  message: string | null;
}

const DAY = 86_400_000;

/**
 * Multi-cidade: cidades em que o tenant opera, com status (em preparação, em operação, pausada).
 * - Cidade pausada ou em preparação recusa novos pedidos e entregas (com mensagem própria);
 * - com `cities.restrictToRegistered`, cidades sem cadastro também são recusadas;
 * - interessados entram na lista de espera ("avise-me") e recebem e-mail no lançamento;
 * - indicadores por cidade orientam a expansão (empresas, entregadores, demanda, lista de espera).
 */
@Injectable()
export class CitiesService implements OnModuleInit {
  private readonly logger = new Logger(CitiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly mail: MailService,
    private readonly jobs: JobsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly tenants: TenantsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register<{ cityId: string }>('cities.notifyWaitlist', async ({ cityId }) => {
      await this.notifyWaitlist(cityId);
    });
  }

  // ---------------------------------------------------------------------------
  // Verificação de atendimento
  // ---------------------------------------------------------------------------

  private cities(tenantId: string): Promise<CachedCity[]> {
    return this.cache.wrap(`cities:${tenantId}`, 60, () =>
      this.prisma.city.findMany({ where: { tenantId }, select: { id: true, key: true, name: true, state: true, status: true, message: true } }),
    );
  }

  private async invalidate(tenantId: string) {
    await this.cache.del(`cities:${tenantId}`);
  }

  async gate(tenantId: string, city?: string | null, state?: string | null): Promise<CityGate> {
    const key = cityKey(city, state);
    const found = (await this.cities(tenantId)).find((item) => item.key === key);
    if (found?.status === 'ACTIVE') return { operating: true, city: { id: found.id, name: found.name, status: found.status } };
    if (found) {
      const reason =
        found.message ||
        (found.status === 'PAUSED'
          ? `A operação em ${found.name}/${found.state} está pausada no momento.`
          : `Ainda não atendemos ${found.name}/${found.state}. Entre na lista de espera para ser avisado no lançamento.`);
      return { operating: false, reason, cityKey: key };
    }
    const { restrictToRegistered } = await this.settings.get(tenantId, 'cities');
    if (!restrictToRegistered) return { operating: true, city: null };
    return { operating: false, reason: `Ainda não atendemos ${city ?? 'esta cidade'}${state ? `/${state.toUpperCase()}` : ''}. Entre na lista de espera para ser avisado quando chegarmos.`, cityKey: key };
  }

  /** Recusa pedidos e entregas em cidade sem operação. */
  async assertOperating(tenantId: string, city?: string | null, state?: string | null): Promise<void> {
    const gate = await this.gate(tenantId, city, state);
    if (!gate.operating) throw new UnprocessableEntityException({ message: gate.reason, details: { cityKey: gate.cityKey, waitlist: true } });
  }

  // ---------------------------------------------------------------------------
  // Lista de espera
  // ---------------------------------------------------------------------------

  /** Entra na lista de espera; cidade ainda não cadastrada é criada "em preparação" (mapa de demanda). */
  async joinWaitlist(tenantId: string, input: WaitlistInput, userId?: string) {
    const key = cityKey(input.city, input.state);
    let city = await this.prisma.city.findUnique({ where: { tenantId_key: { tenantId, key } } });
    if (!city) {
      city = await this.prisma.city
        .create({ data: { tenantId, key, name: input.city.trim(), state: input.state.trim().toUpperCase(), status: 'PREPARING' } })
        .catch(async (error) => {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return this.prisma.city.findUniqueOrThrow({ where: { tenantId_key: { tenantId, key } } });
          throw error;
        });
      await this.invalidate(tenantId);
    }
    if (city.status === 'ACTIVE') return { city: this.publicView(city), joined: false, operating: true };
    await this.prisma.cityWaitlist.upsert({
      where: { cityId_email: { cityId: city.id, email: input.email.trim().toLowerCase() } },
      create: { tenantId, cityId: city.id, email: input.email.trim().toLowerCase(), name: input.name?.trim() || null, profile: input.profile, userId: userId ?? null },
      update: { name: input.name?.trim() || undefined, profile: input.profile, userId: userId ?? undefined },
    });
    return { city: this.publicView(city), joined: true, operating: false };
  }

  /** E-mail "chegamos na sua cidade" para quem ainda não foi avisado. */
  async notifyWaitlist(cityId: string) {
    const city = await this.prisma.city.findUnique({ where: { id: cityId } });
    if (!city || city.status !== 'ACTIVE') return 0;
    const [tenant, pending] = await Promise.all([
      this.tenants.info(city.tenantId),
      this.prisma.cityWaitlist.findMany({ where: { cityId, notifiedAt: null }, take: 5000 }),
    ]);
    let sent = 0;
    for (const entry of pending) {
      try {
        await this.mail.send({
          brand: tenant.appName,
          to: entry.email,
          subject: `${tenant.appName} chegou em ${city.name}!`,
          paragraphs: [
            `Olá${entry.name ? `, ${entry.name.split(' ')[0]}` : ''}!`,
            `Você pediu para ser avisado: a partir de hoje o ${tenant.appName} já atende ${city.name}/${city.state}.`,
            entry.profile === 'COMPANY'
              ? 'Cadastre sua empresa para começar a vender e entregar.'
              : entry.profile === 'DRIVER'
                ? 'Cadastre-se como entregador para começar a receber entregas.'
                : 'Peça nas lojas da sua região ou envie documentos e encomendas.',
          ],
          action: { label: 'Começar agora', url: `${tenant.webUrl}/cadastro` },
        });
        await this.prisma.cityWaitlist.update({ where: { id: entry.id }, data: { notifiedAt: new Date() } });
        sent++;
      } catch (error) {
        this.logger.warn(`Aviso de lançamento não enviado (${entry.id}): ${(error as Error).message}`);
      }
    }
    return sent;
  }

  // ---------------------------------------------------------------------------
  // Administração
  // ---------------------------------------------------------------------------

  private publicView(city: { name: string; state: string; status: CityStatus; message: string | null }) {
    return { name: city.name, state: city.state, status: city.status, statusLabel: CITY_STATUS_LABELS[city.status], message: city.message };
  }

  async publicList(tenantId: string) {
    const cities = await this.prisma.city.findMany({ where: { tenantId, status: { in: ['ACTIVE', 'PREPARING'] } }, orderBy: [{ status: 'asc' }, { name: 'asc' }] });
    return cities.map((city) => this.publicView(city));
  }

  async create(tenantId: string, input: CityInput) {
    const key = cityKey(input.name, input.state);
    try {
      const city = await this.prisma.city.create({
        data: {
          tenantId,
          key,
          name: input.name.trim(),
          state: input.state.trim().toUpperCase(),
          status: input.status ?? 'PREPARING',
          timeZone: input.timeZone ?? 'America/Sao_Paulo',
          centerLat: input.centerLat ?? null,
          centerLng: input.centerLng ?? null,
          message: input.message?.trim() || null,
          launchedAt: input.status === 'ACTIVE' ? new Date() : null,
        },
      });
      await this.invalidate(tenantId);
      await this.audit.log({ action: 'city.create', entityType: 'City', entityId: city.id, after: { key, status: city.status } });
      return city;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Esta cidade já está cadastrada.');
      throw error;
    }
  }

  async update(tenantId: string, id: string, input: Partial<CityInput>) {
    const city = await this.prisma.city.findFirst({ where: { id, tenantId } });
    if (!city) throw new NotFoundException('Cidade não encontrada.');
    const launching = input.status === 'ACTIVE' && city.status !== 'ACTIVE';
    const pausing = input.status === 'PAUSED' && city.status !== 'PAUSED';
    const updated = await this.prisma.city.update({
      where: { id },
      data: {
        status: input.status,
        timeZone: input.timeZone,
        centerLat: input.centerLat,
        centerLng: input.centerLng,
        message: input.message === undefined ? undefined : input.message?.trim() || null,
        launchedAt: launching && !city.launchedAt ? new Date() : undefined,
        pausedAt: pausing ? new Date() : input.status === 'ACTIVE' ? null : undefined,
      },
    });
    await this.invalidate(tenantId);
    await this.audit.log({ action: launching ? 'city.launch' : pausing ? 'city.pause' : 'city.update', entityType: 'City', entityId: id, ...diff(city, updated) });
    if (launching) await this.jobs.enqueue('cities.notifyWaitlist', { cityId: id }, { jobId: `city-launch:${id}:${Date.now()}` });
    return updated;
  }

  /** Cidades com indicadores de 30 dias (empresas, entregadores, pedidos, entregas e lista de espera). */
  async list(tenantId: string) {
    const since = new Date(Date.now() - 30 * DAY);
    const [cities, companies, drivers, deliveries, orders, waitlist] = await Promise.all([
      this.prisma.city.findMany({ where: { tenantId }, orderBy: [{ status: 'asc' }, { name: 'asc' }] }),
      this.prisma.$queryRaw<{ city: string; state: string; n: number }[]>`
        SELECT a.city, a.state, count(*)::int AS n FROM companies c JOIN addresses a ON a.id = c."addressId"
        WHERE c."tenantId" = ${tenantId}::uuid AND c.status = 'APPROVED' GROUP BY 1, 2`,
      this.prisma.$queryRaw<{ city: string; state: string; n: number }[]>`
        SELECT a.city, a.state, count(*)::int AS n FROM drivers d JOIN addresses a ON a.id = d."addressId"
        WHERE d."tenantId" = ${tenantId}::uuid AND d.status = 'APPROVED' GROUP BY 1, 2`,
      this.prisma.$queryRaw<{ city: string; state: string; n: number }[]>`
        SELECT city, state, count(*)::int AS n FROM deliveries
        WHERE "tenantId" = ${tenantId}::uuid AND city IS NOT NULL AND "createdAt" >= ${utcTimestamp(since)} GROUP BY 1, 2`,
      this.prisma.$queryRaw<{ city: string; state: string; n: number }[]>`
        SELECT "deliveryAddress"->>'city' AS city, "deliveryAddress"->>'state' AS state, count(*)::int AS n FROM orders
        WHERE "tenantId" = ${tenantId}::uuid AND "deliveryAddress" IS NOT NULL AND "createdAt" >= ${utcTimestamp(since)} GROUP BY 1, 2`,
      this.prisma.cityWaitlist.groupBy({ by: ['cityId'], where: { tenantId, notifiedAt: null }, _count: { _all: true } }),
    ]);
    const byKey = (rows: { city: string; state: string; n: number }[]) => {
      const map = new Map<string, number>();
      for (const row of rows) {
        if (!row.city) continue;
        const key = cityKey(row.city, row.state);
        map.set(key, (map.get(key) ?? 0) + row.n);
      }
      return map;
    };
    const [companyCount, driverCount, deliveryCount, orderCount] = [byKey(companies), byKey(drivers), byKey(deliveries), byKey(orders)];
    const waiting = new Map(waitlist.map((row) => [row.cityId, row._count._all]));
    const registered = new Set(cities.map((city) => city.key));
    // Cidades com movimento mas sem cadastro (candidatas a registrar).
    const unregistered = [...new Set([...companyCount.keys(), ...deliveryCount.keys(), ...orderCount.keys()])]
      .filter((key) => !registered.has(key) && key !== '/')
      .map((key) => ({ key, companies: companyCount.get(key) ?? 0, drivers: driverCount.get(key) ?? 0, deliveries30d: deliveryCount.get(key) ?? 0, orders30d: orderCount.get(key) ?? 0 }))
      .sort((a, b) => b.deliveries30d + b.orders30d - (a.deliveries30d + a.orders30d))
      .slice(0, 30);
    return {
      cities: cities.map((city) => ({
        ...city,
        companies: companyCount.get(city.key) ?? 0,
        drivers: driverCount.get(city.key) ?? 0,
        deliveries30d: deliveryCount.get(city.key) ?? 0,
        orders30d: orderCount.get(city.key) ?? 0,
        waitlist: waiting.get(city.id) ?? 0,
      })),
      unregistered,
    };
  }

  async waitlist(tenantId: string, cityId: string) {
    const city = await this.prisma.city.findFirst({ where: { id: cityId, tenantId } });
    if (!city) throw new NotFoundException('Cidade não encontrada.');
    const entries = await this.prisma.cityWaitlist.findMany({ where: { cityId }, orderBy: { createdAt: 'desc' }, take: 500 });
    const byProfile = entries.reduce<Record<string, number>>((acc, entry) => ({ ...acc, [entry.profile]: (acc[entry.profile] ?? 0) + 1 }), {});
    return { city, total: entries.length, byProfile, entries: entries.map((entry) => ({ id: entry.id, name: entry.name, email: entry.email, profile: entry.profile, notifiedAt: entry.notifiedAt, createdAt: entry.createdAt })) };
  }
}
