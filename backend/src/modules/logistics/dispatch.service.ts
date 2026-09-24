import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { haversineKm, VEHICLE_RANK } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { JobsService } from '../../infra/jobs/jobs.service';
import { SettingsService, SettingValue } from '../settings/settings.service';
import { PricingService } from '../pricing/pricing.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { ACTIVE_DELIVERY_STATUSES, DeliveriesService, deliveryInclude } from './deliveries.service';
import type { Delivery, Prisma } from '../../generated/prisma/client';

export const DELIVERY_OFFER_CREATED = 'delivery.offer.created';
export const DISPATCH_STALLED = 'delivery.dispatch.stalled';

export interface OfferCreatedEvent {
  offerId: string;
  deliveryId: string;
  driverId: string;
  driverUserId: string;
  payoutCents: number;
  expiresAt: Date;
}

type DispatchConfig = SettingValue<'dispatch'>;

export interface Candidate {
  driverId: string;
  userId: string;
  vehicleId: string;
  distanceKm: number;
  score: number;
}

export type CandidateFilter = (delivery: Delivery, candidates: Candidate[]) => Promise<Candidate[]>;

/**
 * Despacho de entregas: oferece cada entrega a um entregador por vez (sequencial),
 * com contador regressivo. Recusa ou expiração passa para o próximo candidato;
 * sem candidatos, o raio de busca aumenta a cada nova tentativa.
 *
 * Critérios: disponibilidade e localização recente, distância até a coleta, porte do veículo,
 * capacidade (multipedidos), frota (plataforma/própria), avaliação e taxa de aceitação.
 * A arquitetura isola o ranqueamento (`score`) para evoluir para modelos inteligentes.
 */
@Injectable()
export class DispatchService implements OnModuleInit {
  private readonly logger = new Logger(DispatchService.name);
  private candidateFilter?: CandidateFilter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly settings: SettingsService,
    private readonly deliveries: DeliveriesService,
    private readonly pricing: PricingService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit(): void {
    this.jobs.register<{ offerId: string }>('dispatch.offerTimeout', ({ offerId }) => this.expireOffer(offerId));
    this.jobs.register<{ deliveryId: string }>('dispatch.retry', ({ deliveryId }) => this.offerNext(deliveryId));
    this.jobs.register<{ deliveryId: string }>('dispatch.scheduledStart', ({ deliveryId }) => this.start(deliveryId));
    this.pricing.registerDemandSignal((tenantId, city) => this.demandPressure(tenantId, city));
  }

  // ---------------------------------------------------------------------------
  // Busca
  // ---------------------------------------------------------------------------

  async start(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery || !['PENDING', 'SCHEDULED'].includes(delivery.status)) return;
    const config = await this.settings.get(delivery.tenantId, 'dispatch');
    await this.deliveries.transition(deliveryId, 'SEARCHING_DRIVER', { type: 'SYSTEM' }, {
      data: { dispatchAttempts: 0, searchRadiusKm: config.initialRadiusKm, searchStartedAt: new Date() },
    });
    await this.offerNext(deliveryId);
  }

  /** Oferece a entrega ao melhor candidato disponível (ou agenda nova tentativa). */
  async offerNext(deliveryId: string): Promise<void> {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery || delivery.status !== 'SEARCHING_DRIVER') return;
    const pending = await this.prisma.deliveryOffer.findFirst({ where: { deliveryId, status: 'PENDING', expiresAt: { gt: new Date() } } });
    if (pending) return;

    const config = await this.settings.get(delivery.tenantId, 'dispatch');
    const searchingFor = (Date.now() - (delivery.searchStartedAt ?? delivery.createdAt).getTime()) / 60_000;
    if (searchingFor >= config.maxSearchMinutes) {
      await this.deliveries.transition(deliveryId, 'CANCELED', { type: 'SYSTEM' }, { reason: 'Nenhum entregador disponível no momento.' });
      return;
    }

    const [candidate] = await this.findCandidates(delivery, delivery.searchRadiusKm, config);
    if (!candidate) {
      const attempts = delivery.dispatchAttempts + 1;
      await this.prisma.delivery.update({
        where: { id: deliveryId },
        data: { dispatchAttempts: attempts, searchRadiusKm: Math.min(config.maxRadiusKm, delivery.searchRadiusKm + config.radiusStepKm) },
      });
      if (attempts === 3) this.events.emit(DISPATCH_STALLED, { deliveryId, tenantId: delivery.tenantId, attempts });
      await this.jobs.enqueue('dispatch.retry', { deliveryId }, { delayMs: config.retryDelaySeconds * 1000, jobId: `dispatch-retry:${deliveryId}:${attempts}` });
      return;
    }

    // Cria a oferta travando a entrega: se ela foi cancelada/atribuída durante a busca, nada é ofertado
    // (a transição concorrente espera esta transação e cancela as ofertas pendentes).
    const offer = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.delivery.updateMany({ where: { id: deliveryId, status: 'SEARCHING_DRIVER' }, data: { updatedAt: new Date() } });
      if (locked.count === 0) return null;
      return tx.deliveryOffer.create({
        data: {
          deliveryId,
          driverId: candidate.driverId,
          payoutCents: delivery.payoutCents + delivery.tipCents,
          distanceToPickupKm: Math.round(candidate.distanceKm * 100) / 100,
          expiresAt: new Date(Date.now() + config.offerTimeoutSeconds * 1000),
        },
      });
    });
    if (!offer) return;
    await this.jobs.enqueue('dispatch.offerTimeout', { offerId: offer.id }, { delayMs: config.offerTimeoutSeconds * 1000 + 500, jobId: `offer:${offer.id}` });
    this.events.emit(DELIVERY_OFFER_CREATED, {
      offerId: offer.id,
      deliveryId,
      driverId: candidate.driverId,
      driverUserId: candidate.userId,
      payoutCents: offer.payoutCents,
      expiresAt: offer.expiresAt,
    } satisfies OfferCreatedEvent);
  }

  async findCandidates(delivery: Delivery, radiusKm: number, config: DispatchConfig): Promise<Candidate[]> {
    const pickup = { lat: delivery.pickupLat, lng: delivery.pickupLng };
    const degrees = radiusKm / 111 + 0.01;
    const freshSince = new Date(Date.now() - config.locationFreshSeconds * 1000);

    const company = delivery.companyId
      ? await this.prisma.company.findUnique({ where: { id: delivery.companyId }, select: { fulfillmentMode: true } })
      : null;
    const mode = company?.fulfillmentMode ?? 'PLATFORM';
    const fleetFilter: Prisma.DriverWhereInput =
      mode === 'OWN_FLEET'
        ? { fleetType: 'COMPANY', fleetCompanyId: delivery.companyId }
        : mode === 'HYBRID'
          ? { OR: [{ fleetType: 'PLATFORM' }, { fleetType: 'COMPANY', fleetCompanyId: delivery.companyId }] }
          : { fleetType: 'PLATFORM' };

    const drivers = await this.prisma.driver.findMany({
      where: {
        tenantId: delivery.tenantId,
        status: 'APPROVED',
        availability: { in: ['ONLINE', 'BUSY'] },
        lastLocationAt: { gte: freshSince },
        lastLat: { gte: pickup.lat - degrees, lte: pickup.lat + degrees },
        lastLng: { gte: pickup.lng - degrees, lte: pickup.lng + degrees },
        user: { status: 'ACTIVE' },
        activeVehicle: { status: 'APPROVED', deletedAt: null },
        offers: { none: { deliveryId: delivery.id } },
        ...fleetFilter,
        NOT: { offers: { some: { status: 'PENDING', expiresAt: { gt: new Date() } } } },
      },
      include: {
        activeVehicle: { select: { id: true, type: true } },
        deliveries: { where: { status: { in: ACTIVE_DELIVERY_STATUSES } }, select: { status: true, pickupLat: true, pickupLng: true } },
      },
      take: 200,
    });

    const candidates: Candidate[] = [];
    for (const driver of drivers) {
      if (!driver.activeVehicle || driver.lastLat == null || driver.lastLng == null) continue;
      const distanceKm = haversineKm({ lat: driver.lastLat, lng: driver.lastLng }, pickup);
      if (distanceKm > radiusKm) continue;
      if (!this.vehicleFits(driver.activeVehicle.type, delivery)) continue;

      // Multipedidos: só agrupa com entregas ainda não coletadas e com coleta próxima.
      if (driver.deliveries.length >= config.maxConcurrentDeliveries) continue;
      if (driver.deliveries.length > 0) {
        const compatible = driver.deliveries.every(
          (active) =>
            ['DRIVER_ASSIGNED', 'AT_PICKUP'].includes(active.status) &&
            haversineKm({ lat: active.pickupLat, lng: active.pickupLng }, pickup) <= config.batchPickupRadiusKm,
        );
        if (!compatible) continue;
      }

      const answered = driver.acceptedOffers + driver.declinedOffers + driver.expiredOffers;
      const acceptance = answered >= 5 ? driver.acceptedOffers / answered : 0.9;
      const rating = driver.ratingCount >= 3 ? driver.ratingAvg : 4.5;
      const ownFleetBonus = mode === 'HYBRID' && driver.fleetType === 'COMPANY' ? -2 : 0;
      const score = distanceKm + (5 - rating) * 0.4 + (1 - acceptance) * 1.5 + ownFleetBonus;
      candidates.push({ driverId: driver.id, userId: driver.userId, vehicleId: driver.activeVehicle.id, distanceKm, score });
    }
    candidates.sort((a, b) => a.score - b.score);
    return this.candidateFilter ? this.candidateFilter(delivery, candidates) : candidates;
  }

  /** Regras externas de elegibilidade (ex.: financeiro bloqueia entregas em dinheiro para quem excedeu o limite de dívida). */
  registerCandidateFilter(filter: CandidateFilter): void {
    this.candidateFilter = filter;
  }

  /** Veículo compatível com a carga. Bicicletas levam volumes leves em trajetos curtos. */
  private vehicleFits(vehicle: keyof typeof VEHICLE_RANK, delivery: Delivery): boolean {
    if (VEHICLE_RANK[vehicle] >= VEHICLE_RANK[delivery.vehicleType]) return true;
    return vehicle === 'BICYCLE' && delivery.vehicleType === 'MOTORCYCLE' && (delivery.weightKg ?? 0) <= 5 && delivery.distanceKm <= 5;
  }

  // ---------------------------------------------------------------------------
  // Respostas do entregador
  // ---------------------------------------------------------------------------

  async currentOffers(user: AuthUser) {
    const driverId = this.driverId(user);
    const offers = await this.prisma.deliveryOffer.findMany({
      where: { driverId, status: 'PENDING', expiresAt: { gt: new Date() } },
      include: { delivery: true },
      orderBy: { createdAt: 'asc' },
    });
    return offers.map(({ delivery, ...offer }) => ({
      id: offer.id,
      expiresAt: offer.expiresAt,
      secondsLeft: Math.max(0, Math.round((offer.expiresAt.getTime() - Date.now()) / 1000)),
      payoutCents: offer.payoutCents,
      distanceToPickupKm: offer.distanceToPickupKm,
      totalDistanceKm: Math.round((offer.distanceToPickupKm + delivery.distanceKm) * 10) / 10,
      estimatedMinutes: Math.round(((offer.distanceToPickupKm * 1.35) / 22) * 60) + delivery.durationMin,
      // Local aproximado: bairro/cidade (endereço completo só após o aceite).
      pickupArea: this.area(delivery.pickup),
      dropoffArea: this.area(delivery.dropoff),
      itemCategory: delivery.itemCategory,
      weightKg: delivery.weightKg,
      vehicleType: delivery.vehicleType,
      paymentMethod: delivery.paymentMethod,
      kind: delivery.kind,
      notes: delivery.notes,
    }));
  }

  private area(stop: Prisma.JsonValue) {
    const value = stop as { district?: string | null; city?: string };
    return [value.district, value.city].filter(Boolean).join(', ');
  }

  async accept(user: AuthUser, offerId: string) {
    const driverId = this.driverId(user);
    const offer = await this.prisma.deliveryOffer.findFirst({ where: { id: offerId, driverId } });
    if (!offer) throw new NotFoundException('Oferta não encontrada.');
    if (offer.status !== 'PENDING') throw new ConflictException('Esta oferta não está mais disponível.');
    if (offer.expiresAt < new Date()) {
      await this.expireOffer(offer.id);
      throw new ConflictException('A oferta expirou.');
    }
    const driver = await this.prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { activeVehicleId: true } });

    const claimed = await this.prisma.deliveryOffer.updateMany({ where: { id: offer.id, status: 'PENDING' }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
    if (claimed.count === 0) throw new ConflictException('Esta oferta não está mais disponível.');
    try {
      await this.deliveries.transition(offer.deliveryId, 'DRIVER_ASSIGNED', { type: 'DRIVER', id: user.userId }, {
        expectedFrom: ['SEARCHING_DRIVER'],
        data: { driverId, vehicleId: driver.activeVehicleId },
      });
    } catch (error) {
      await this.prisma.deliveryOffer.update({ where: { id: offer.id }, data: { status: 'CANCELED' } });
      throw new ConflictException('Esta entrega já foi aceita por outro entregador.');
    }
    await this.jobs.cancel(`offer:${offer.id}`);
    await this.prisma.driver.update({ where: { id: driverId }, data: { acceptedOffers: { increment: 1 } } });
    await this.refreshAvailability(driverId);
    return this.deliveries.driverView(await this.prisma.delivery.findUniqueOrThrow({ where: { id: offer.deliveryId }, include: deliveryInclude }));
  }

  async decline(user: AuthUser, offerId: string, reason?: string) {
    const driverId = this.driverId(user);
    const updated = await this.prisma.deliveryOffer.updateMany({
      where: { id: offerId, driverId, status: 'PENDING' },
      data: { status: 'DECLINED', respondedAt: new Date(), declineReason: reason },
    });
    if (updated.count === 0) throw new ConflictException('Esta oferta não está mais disponível.');
    await this.jobs.cancel(`offer:${offerId}`);
    await this.prisma.driver.update({ where: { id: driverId }, data: { declinedOffers: { increment: 1 } } });
    const offer = await this.prisma.deliveryOffer.findUniqueOrThrow({ where: { id: offerId } });
    await this.offerNext(offer.deliveryId);
  }

  async expireOffer(offerId: string) {
    const offer = await this.prisma.deliveryOffer.findUnique({ where: { id: offerId } });
    if (!offer || offer.status !== 'PENDING') return;
    const updated = await this.prisma.deliveryOffer.updateMany({ where: { id: offerId, status: 'PENDING' }, data: { status: 'EXPIRED', respondedAt: new Date() } });
    if (updated.count === 0) return;
    await this.prisma.driver.update({ where: { id: offer.driverId }, data: { expiredOffers: { increment: 1 } } });
    await this.offerNext(offer.deliveryId);
  }

  /** O entregador desiste antes da coleta: a entrega volta para a busca. */
  async release(user: AuthUser, deliveryId: string, reason: string) {
    const delivery = await this.deliveries.findForDriver(user, deliveryId);
    if (!['DRIVER_ASSIGNED', 'AT_PICKUP'].includes(delivery.status)) throw new ConflictException('Após a coleta não é possível desistir. Registre uma falha na entrega.');
    await this.deliveries.transition(deliveryId, 'SEARCHING_DRIVER', { type: 'DRIVER', id: user.userId }, {
      reason,
      data: { driverId: null, vehicleId: null, assignedAt: null, arrivedPickupAt: null },
    });
    await this.prisma.driver.update({ where: { id: delivery.driverId! }, data: { canceledDeliveries: { increment: 1 } } });
    await this.refreshAvailability(delivery.driverId!);
    await this.offerNext(deliveryId);
  }

  /** Atribuição manual pela operação (torre de controle). */
  async assignManually(actor: AuthUser, deliveryId: string, driverId: string) {
    const delivery = await this.prisma.delivery.findFirst({ where: { id: deliveryId, tenantId: actor.tenantId } });
    if (!delivery) throw new NotFoundException('Entrega não encontrada.');
    const driver = await this.prisma.driver.findFirst({ where: { id: driverId, tenantId: actor.tenantId, status: 'APPROVED' }, select: { id: true, activeVehicleId: true } });
    if (!driver) throw new NotFoundException('Entregador não encontrado ou não aprovado.');
    if (delivery.status === 'DRIVER_ASSIGNED' || delivery.status === 'AT_PICKUP') {
      const previous = delivery.driverId;
      await this.deliveries.transition(deliveryId, 'SEARCHING_DRIVER', { type: 'PLATFORM', id: actor.userId }, { reason: 'Reatribuição pela operação', data: { driverId: null } });
      if (previous) await this.refreshAvailability(previous);
    }
    await this.prisma.deliveryOffer.updateMany({ where: { deliveryId, status: 'PENDING' }, data: { status: 'CANCELED' } });
    await this.deliveries.transition(deliveryId, 'DRIVER_ASSIGNED', { type: 'PLATFORM', id: actor.userId }, {
      expectedFrom: ['SEARCHING_DRIVER'],
      reason: 'Atribuição manual',
      data: { driverId: driver.id, vehicleId: driver.activeVehicleId },
    });
    await this.refreshAvailability(driver.id);
  }

  /**
   * Recalcula ONLINE/BUSY conforme as entregas ativas (OFFLINE é escolha do entregador).
   * BUSY ainda recebe ofertas compatíveis para multipedidos, até o limite de entregas simultâneas.
   */
  async refreshAvailability(driverId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId }, select: { availability: true } });
    if (!driver || driver.availability === 'OFFLINE') return;
    const active = await this.prisma.delivery.count({ where: { driverId, status: { in: ACTIVE_DELIVERY_STATUSES } } });
    await this.prisma.driver.update({ where: { id: driverId }, data: { availability: active > 0 ? 'BUSY' : 'ONLINE' } });
  }

  private driverId(user: AuthUser): string {
    if (!user.driverId) throw new ForbiddenException('Perfil de entregador não encontrado.');
    return user.driverId;
  }

  // ---------------------------------------------------------------------------
  // Sinais operacionais
  // ---------------------------------------------------------------------------

  /** Pressão de demanda (0–1): entregas procurando entregador ÷ entregadores livres na cidade. */
  async demandPressure(tenantId: string, city?: string): Promise<number> {
    const cityFilter = city ? { city: { equals: city, mode: 'insensitive' as const } } : {};
    const [searching, available] = await Promise.all([
      this.prisma.delivery.count({ where: { tenantId, status: 'SEARCHING_DRIVER', ...cityFilter } }),
      this.prisma.driver.count({ where: { tenantId, availability: 'ONLINE', status: 'APPROVED', lastLocationAt: { gte: new Date(Date.now() - 300_000) } } }),
    ]);
    if (searching === 0) return 0;
    return Math.min(1, searching / Math.max(1, available * 2));
  }

  /**
   * Rede de segurança (a cada minuto): inicia agendadas no prazo, retoma buscas sem oferta
   * pendente (ex.: após reinício do servidor) e expira ofertas vencidas.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    try {
      const now = new Date();
      const expired = await this.prisma.deliveryOffer.findMany({ where: { status: 'PENDING', expiresAt: { lt: new Date(now.getTime() - 5_000) } }, select: { id: true }, take: 200 });
      for (const offer of expired) await this.expireOffer(offer.id);

      const scheduled = await this.prisma.delivery.findMany({ where: { status: 'SCHEDULED' }, select: { id: true, tenantId: true, scheduledFor: true }, take: 200 });
      for (const delivery of scheduled) {
        const { leadMinutes } = await this.settings.get(delivery.tenantId, 'dispatch.scheduling');
        if (delivery.scheduledFor && delivery.scheduledFor.getTime() - leadMinutes * 60_000 <= now.getTime()) await this.start(delivery.id);
      }

      const stale = await this.prisma.delivery.findMany({
        where: { status: 'SEARCHING_DRIVER', updatedAt: { lt: new Date(now.getTime() - 60_000) }, offers: { none: { status: 'PENDING' } } },
        select: { id: true },
        take: 200,
      });
      for (const delivery of stale) await this.offerNext(delivery.id);
    } catch (error) {
      this.logger.error(`Varredura do despacho falhou: ${(error as Error).message}`);
    }
  }
}
