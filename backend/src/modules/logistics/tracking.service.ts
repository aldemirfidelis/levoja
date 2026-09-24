import { ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { haversineKm, LatLng } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { ACTIVE_DELIVERY_STATUSES, DeliveriesService, deliveryInclude } from './deliveries.service';
import { LocationPointDto } from './deliveries.dto';
import { optimizeRoute } from '../../common/route-optimizer';
import { RISK_SIGNAL, RiskSignalEvent } from '../../common/intelligence-events';
import { impossibleJumps, TimedPoint } from '../intelligence/risk.engine';

const STALE_ONLINE_MINUTES = 5;

/**
 * Disponibilidade e localização do entregador.
 * - A posição só é registrada enquanto o entregador está online (economia de bateria/dados e LGPD).
 * - Pontos de rota são gravados apenas durante entregas ativas.
 * - Geofence: chegada à coleta/destino detectada automaticamente pela distância.
 */
@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly deliveries: DeliveriesService,
    private readonly events: EventEmitter2,
  ) {}

  private driverId(user: AuthUser): string {
    if (!user.driverId) throw new ForbiddenException('Perfil de entregador não encontrado.');
    return user.driverId;
  }

  async setAvailability(user: AuthUser, online: boolean, location?: LatLng) {
    const driverId = this.driverId(user);
    const driver = await this.prisma.driver.findUniqueOrThrow({
      where: { id: driverId },
      include: { activeVehicle: { select: { status: true } } },
    });
    if (online) {
      if (driver.status !== 'APPROVED') throw new ForbiddenException('Seu cadastro precisa estar aprovado para ficar online.');
      if (driver.activeVehicle?.status !== 'APPROVED') throw new ForbiddenException('Selecione um veículo aprovado para ficar online.');
      const consent = await this.prisma.consent.findFirst({ where: { userId: user.userId, type: 'LOCATION_TRACKING' }, orderBy: { createdAt: 'desc' } });
      if (!consent?.granted) throw new ForbiddenException('Autorize o uso da localização durante as entregas para ficar online.');
    } else {
      const active = await this.prisma.delivery.count({ where: { driverId, status: { in: ACTIVE_DELIVERY_STATUSES } } });
      if (active > 0) throw new ConflictException('Conclua suas entregas em andamento antes de ficar offline.');
      await this.prisma.deliveryOffer.updateMany({ where: { driverId, status: 'PENDING' }, data: { status: 'CANCELED' } });
    }
    const active = online ? await this.prisma.delivery.count({ where: { driverId, status: { in: ACTIVE_DELIVERY_STATUSES } } }) : 0;
    await this.prisma.driver.update({
      where: { id: driverId },
      data: {
        availability: online ? (active > 0 ? 'BUSY' : 'ONLINE') : 'OFFLINE',
        onlineSince: online ? (driver.onlineSince ?? new Date()) : null,
        ...(location ? { lastLat: location.lat, lastLng: location.lng, lastLocationAt: new Date() } : {}),
      },
    });
    await this.audit.log({ action: online ? 'driver.online' : 'driver.offline', entityType: 'Driver', entityId: driverId });
    this.realtime.toOps(user.tenantId, 'driver.availability', { driverId, online, lat: location?.lat, lng: location?.lng });
    return this.dashboard(user);
  }

  /** Recebe um ou vários pontos (sincronização após perda de conexão), em ordem cronológica. */
  async updateLocation(user: AuthUser, points: LocationPointDto[]) {
    const driverId = this.driverId(user);
    const driver = await this.prisma.driver.findUniqueOrThrow({
      where: { id: driverId },
      select: { availability: true, tenantId: true, lastLat: true, lastLng: true, lastLocationAt: true },
    });
    if (driver.availability === 'OFFLINE') return { accepted: 0, tracking: false };

    const now = Date.now();
    const sorted = points
      .map((point) => ({ ...point, at: point.recordedAt ? new Date(point.recordedAt) : new Date() }))
      // Descarta leituras do futuro (relógio adiantado) ou muito antigas (> 24h).
      .filter((point) => point.at.getTime() <= now + 60_000 && point.at.getTime() >= now - 86_400_000)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    if (!sorted.length) return { accepted: 0, tracking: false };
    const latest = sorted[sorted.length - 1];

    await this.prisma.driver.update({
      where: { id: driverId },
      data: { lastLat: latest.lat, lastLng: latest.lng, lastLocationAt: latest.at, lastLocationMocked: !!latest.mocked },
    });
    await this.inspectGps(user, driver, sorted);

    const active = await this.prisma.delivery.findMany({ where: { driverId, status: { in: ACTIVE_DELIVERY_STATUSES } } });
    if (active.length) {
      await this.prisma.deliveryTrackingPoint.createMany({
        data: active.flatMap((delivery) =>
          sorted.map((point) => ({
            deliveryId: delivery.id,
            driverId,
            lat: point.lat,
            lng: point.lng,
            accuracy: point.accuracy,
            speed: point.speed,
            heading: point.heading,
            recordedAt: point.at,
            mocked: !!point.mocked,
          })),
        ),
      });
      const { geofenceMeters } = await this.settings.get(driver.tenantId, 'dispatch');
      for (const delivery of active) {
        const payload = { deliveryId: delivery.id, code: delivery.code, lat: latest.lat, lng: latest.lng, heading: latest.heading, at: latest.at };
        this.realtime.toUser(delivery.requesterUserId, 'delivery.location', payload);
        if (delivery.companyId) this.realtime.toCompany(delivery.companyId, 'delivery.location', payload);
        await this.checkGeofence(user, delivery, latest, geofenceMeters);
      }
    }
    this.realtime.toOps(driver.tenantId, 'driver.location', { driverId, lat: latest.lat, lng: latest.lng, busy: active.length > 0 });
    return { accepted: sorted.length, tracking: active.length > 0 };
  }

  /**
   * Antifraude de GPS: leituras marcadas como simuladas e saltos impossíveis entre leituras
   * viram sinais de risco (no máximo um de cada tipo por hora) para revisão da equipe.
   */
  private async inspectGps(
    user: AuthUser,
    previous: { tenantId: string; lastLat: number | null; lastLng: number | null; lastLocationAt: Date | null },
    points: (LocationPointDto & { at: Date })[],
  ) {
    const hour = new Date().toISOString().slice(0, 13);
    const mocked = points.filter((point) => point.mocked);
    if (mocked.length) {
      this.events.emit(RISK_SIGNAL, {
        tenantId: previous.tenantId,
        userId: user.userId,
        type: 'MOCK_LOCATION',
        message: `${mocked.length} leitura(s) de GPS marcadas como localização simulada pelo aparelho.`,
        details: { readings: mocked.length, first: { lat: mocked[0].lat, lng: mocked[0].lng, at: mocked[0].at } },
        dedupeKey: `mock:${user.userId}:${hour}`,
      } satisfies RiskSignalEvent);
    }
    const { maxSpeedKmh } = await this.settings.get(previous.tenantId, 'fraud');
    const trail: TimedPoint[] = points.map((point) => ({ lat: point.lat, lng: point.lng, at: point.at, accuracy: point.accuracy }));
    // A última posição conhecida entra só se for recente (depois de horas offline o salto é normal).
    if (previous.lastLat != null && previous.lastLng != null && previous.lastLocationAt && Date.now() - previous.lastLocationAt.getTime() < 3_600_000) {
      trail.unshift({ lat: previous.lastLat, lng: previous.lastLng, at: previous.lastLocationAt });
    }
    const jumps = impossibleJumps(trail, maxSpeedKmh);
    if (jumps.length) {
      const worst = jumps.reduce((best, jump) => (jump.kmh > best.kmh ? jump : best));
      this.events.emit(RISK_SIGNAL, {
        tenantId: previous.tenantId,
        userId: user.userId,
        type: 'IMPOSSIBLE_SPEED',
        message: `Deslocamento de ${worst.km.toLocaleString('pt-BR')} km a ${worst.kmh} km/h entre duas leituras de GPS.`,
        details: { km: worst.km, kmh: worst.kmh, from: worst.from, to: worst.to, jumps: jumps.length },
        dedupeKey: `speed:${user.userId}:${hour}`,
      } satisfies RiskSignalEvent);
    }
  }

  private async checkGeofence(user: AuthUser, delivery: { id: string; status: string; pickupLat: number; pickupLng: number; dropoffLat: number; dropoffLng: number }, point: LatLng, meters: number) {
    const near = (target: LatLng) => haversineKm(point, target) * 1000 <= meters;
    try {
      if (delivery.status === 'DRIVER_ASSIGNED' && near({ lat: delivery.pickupLat, lng: delivery.pickupLng })) {
        await this.deliveries.transition(delivery.id, 'AT_PICKUP', { type: 'SYSTEM', id: user.userId }, { reason: 'Chegada detectada (geofence)', lat: point.lat, lng: point.lng });
      } else if (['PICKED_UP', 'IN_TRANSIT'].includes(delivery.status) && near({ lat: delivery.dropoffLat, lng: delivery.dropoffLng })) {
        if (delivery.status === 'PICKED_UP') await this.deliveries.transition(delivery.id, 'IN_TRANSIT', { type: 'SYSTEM', id: user.userId });
        await this.deliveries.transition(delivery.id, 'AT_DROPOFF', { type: 'SYSTEM', id: user.userId }, { reason: 'Chegada detectada (geofence)', lat: point.lat, lng: point.lng });
      }
    } catch {
      // Transição concorrente (ex.: o entregador tocou no botão ao mesmo tempo) — ignorar.
    }
  }

  /** Entregas ativas do entregador, com as paradas em ordem otimizada (coletas antes das entregas). */
  async activeRoute(user: AuthUser) {
    const driverId = this.driverId(user);
    const [driver, deliveries] = await Promise.all([
      this.prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { lastLat: true, lastLng: true } }),
      this.prisma.delivery.findMany({ where: { driverId, status: { in: ACTIVE_DELIVERY_STATUSES } }, include: deliveryInclude, orderBy: { assignedAt: 'asc' } }),
    ]);
    type Stop = { deliveryId: string; code: string; type: 'PICKUP' | 'DROPOFF'; lat: number; lng: number; label: string };
    const pending: Stop[] = [];
    for (const delivery of deliveries) {
      const pickedUp = ['PICKED_UP', 'IN_TRANSIT', 'AT_DROPOFF'].includes(delivery.status);
      if (!pickedUp) pending.push({ deliveryId: delivery.id, code: delivery.code, type: 'PICKUP', lat: delivery.pickupLat, lng: delivery.pickupLng, label: delivery.company?.tradeName ?? 'Coleta' });
      pending.push({ deliveryId: delivery.id, code: delivery.code, type: 'DROPOFF', lat: delivery.dropoffLat, lng: delivery.dropoffLng, label: 'Entrega' });
    }
    // Vizinho mais próximo + 2-opt/or-opt, sempre com a entrega depois da sua coleta.
    const current: LatLng | null = driver.lastLat != null && driver.lastLng != null ? { lat: driver.lastLat, lng: driver.lastLng } : null;
    const ordered = optimizeRoute(current, pending);
    return { deliveries: deliveries.map((delivery) => this.deliveries.driverView(delivery)), stops: ordered };
  }

  /** Painel inicial do app do entregador. */
  async dashboard(user: AuthUser) {
    const driverId = this.driverId(user);
    const driver = await this.prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay.getTime() - ((startOfDay.getDay() + 6) % 7) * 86_400_000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const earnings = async (since: Date) => {
      const result = await this.prisma.delivery.aggregate({
        where: { driverId, status: 'DELIVERED', deliveredAt: { gte: since } },
        _sum: { payoutCents: true, tipCents: true },
        _count: { _all: true },
      });
      return { cents: (result._sum.payoutCents ?? 0) + (result._sum.tipCents ?? 0), deliveries: result._count._all };
    };
    const [today, week, month, active] = await Promise.all([
      earnings(startOfDay),
      earnings(startOfWeek),
      earnings(startOfMonth),
      this.prisma.delivery.count({ where: { driverId, status: { in: ACTIVE_DELIVERY_STATUSES } } }),
    ]);
    const answered = driver.acceptedOffers + driver.declinedOffers + driver.expiredOffers;
    const finished = driver.completedDeliveries + driver.canceledDeliveries;
    return {
      availability: driver.availability,
      onlineSince: driver.onlineSince,
      activeDeliveries: active,
      earnings: { today, week, month },
      completedDeliveries: driver.completedDeliveries,
      rating: { average: driver.ratingAvg, count: driver.ratingCount },
      acceptanceRate: answered ? Math.round((driver.acceptedOffers / answered) * 1000) / 10 : null,
      cancellationRate: finished ? Math.round((driver.canceledDeliveries / finished) * 1000) / 10 : null,
    };
  }

  /** Entregadores "online" sem sinal há minutos (app fechado/sem internet) passam a offline. */
  @Cron(CronExpression.EVERY_MINUTE)
  async markStaleOffline(): Promise<void> {
    try {
      const threshold = new Date(Date.now() - STALE_ONLINE_MINUTES * 60_000);
      const stale = await this.prisma.driver.findMany({
        where: { availability: 'ONLINE', OR: [{ lastLocationAt: { lt: threshold } }, { lastLocationAt: null }], deliveries: { none: { status: { in: ACTIVE_DELIVERY_STATUSES } } } },
        select: { id: true },
        take: 500,
      });
      if (stale.length) {
        await this.prisma.driver.updateMany({ where: { id: { in: stale.map((driver) => driver.id) } }, data: { availability: 'OFFLINE', onlineSince: null } });
        this.logger.log(`${stale.length} entregador(es) sem sinal marcados como offline.`);
      }
    } catch (error) {
      this.logger.error(`Falha ao atualizar entregadores sem sinal: ${(error as Error).message}`);
    }
  }
}
