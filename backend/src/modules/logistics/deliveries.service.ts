import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomInt } from 'node:crypto';
import { approximate, canTransitionDelivery, haversineKm, minimumVehicleFor, VEHICLE_RANK } from '@levoja/shared';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { StorageService } from '../../infra/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { MapsService } from '../geo/maps.service';
import { PricingService } from '../pricing/pricing.service';
import { SettingsService } from '../settings/settings.service';
import { paginated, skipOf } from '../../common/pagination';
import type { AuthUser } from '../../common/auth/auth-user';
import { CreateDeliveryDto, DeliveriesQueryDto, DeliveryQuoteDto, StopDto } from './deliveries.dto';
import { Prisma } from '../../generated/prisma/client';
import type { ActorType, DeliveryStatus, PaymentMethod, VehicleType } from '../../generated/prisma/enums';

export const DELIVERY_STATUS_CHANGED = 'delivery.status.changed';

export interface DeliveryStatusChangedEvent {
  deliveryId: string;
  tenantId: string;
  code: string;
  kind: 'ORDER' | 'ON_DEMAND';
  orderId: string | null;
  companyId: string | null;
  requesterUserId: string;
  driverId: string | null;
  from: DeliveryStatus | null;
  to: DeliveryStatus;
  actorType: ActorType;
  reason?: string;
}

export interface OnDemandPaymentHook {
  methods(isCompany: boolean): PaymentMethod[];
  chargeWallet(
    tx: Tx,
    input: { tenantId: string; owner: { type: 'COMPANY'; companyId: string } | { type: 'CUSTOMER'; customerId: string }; payerUserId: string; deliveryId: string; code: string; amountCents: number },
  ): Promise<unknown>;
}

export interface StopSnapshot {
  name: string | null;
  phone: string | null;
  zipCode: string | null;
  street: string;
  number: string;
  complement: string | null;
  district: string | null;
  city: string;
  state: string;
  reference: string | null;
  lat: number;
  lng: number;
}

export const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = ['DRIVER_ASSIGNED', 'AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'AT_DROPOFF'];

export const deliveryInclude = {
  driver: {
    select: {
      id: true,
      userId: true,
      ratingAvg: true,
      lastLat: true,
      lastLng: true,
      lastLocationAt: true,
      user: { select: { name: true, avatarKey: true, phone: true } },
      activeVehicle: { select: { type: true, plate: true, brand: true, model: true, color: true } },
    },
  },
  company: { select: { id: true, tradeName: true, logoKey: true } },
  order: { select: { id: true, number: true, status: true, paymentMethod: true, changeForCents: true, totalCents: true, items: { select: { productName: true, quantity: true } } } },
  statusHistory: { orderBy: { createdAt: 'asc' } },
  proofs: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.DeliveryInclude;

export type DeliveryWithRelations = Prisma.DeliveryGetPayload<{ include: typeof deliveryInclude }>;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MIN_SCHEDULE_MINUTES = 30;

@Injectable()
export class DeliveriesService {
  private onDemandPayment?: OnDemandPaymentHook;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly maps: MapsService,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
    private readonly events: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------------
  // Cotação
  // ---------------------------------------------------------------------------

  /** Veículo mínimo pela carga: peso e, para volumes grandes, dimensões. */
  requiredVehicle(weightKg = 0, dims: { lengthCm?: number; widthCm?: number; heightCm?: number } = {}): VehicleType {
    const byWeight = minimumVehicleFor(weightKg);
    const largest = Math.max(dims.lengthCm ?? 0, dims.widthCm ?? 0, dims.heightCm ?? 0);
    const byVolume: VehicleType = largest > 150 ? 'VAN' : largest > 60 ? 'CAR' : 'MOTORCYCLE';
    return VEHICLE_RANK[byVolume] > VEHICLE_RANK[byWeight] ? byVolume : byWeight;
  }

  private async resolveStop(user: AuthUser, stop: StopDto | undefined, fallback?: StopSnapshot | null): Promise<StopSnapshot> {
    if (!stop) {
      if (fallback) return fallback;
      throw new BadRequestException('Informe o endereço de coleta.');
    }
    if (stop.addressId) {
      const address = await this.prisma.address.findFirst({ where: { id: stop.addressId, userId: user.userId, deletedAt: null } });
      if (!address) throw new NotFoundException('Endereço não encontrado.');
      if (address.lat == null || address.lng == null) throw new UnprocessableEntityException('Endereço sem localização no mapa. Edite-o e use "Usar minha localização".');
      return {
        name: stop.contactName ?? address.recipientName ?? null,
        phone: stop.contactPhone ?? null,
        zipCode: address.zipCode,
        street: address.street,
        number: address.number,
        complement: address.complement,
        district: address.district,
        city: address.city,
        state: address.state,
        reference: address.reference,
        lat: address.lat,
        lng: address.lng,
      };
    }
    if (!stop.street || !stop.number || !stop.city || !stop.state) throw new BadRequestException('Endereço incompleto: informe rua, número, cidade e UF.');
    let point = stop.lat != null && stop.lng != null ? { lat: stop.lat, lng: stop.lng } : null;
    point ??= await this.maps.geocode({ street: stop.street, number: stop.number, district: stop.district, city: stop.city, state: stop.state, zipCode: stop.zipCode });
    if (!point) throw new UnprocessableEntityException('Não conseguimos localizar o endereço no mapa. Informe a localização (lat/lng).');
    return {
      name: stop.contactName ?? null,
      phone: stop.contactPhone ?? null,
      zipCode: stop.zipCode?.replace(/\D/g, '') ?? null,
      street: stop.street,
      number: stop.number,
      complement: stop.complement ?? null,
      district: stop.district ?? null,
      city: stop.city,
      state: stop.state.toUpperCase(),
      reference: stop.reference ?? null,
      lat: point.lat,
      lng: point.lng,
    };
  }

  private async companyStop(companyId: string): Promise<StopSnapshot> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, include: { address: true } });
    if (!company?.address || company.address.lat == null || company.address.lng == null) {
      throw new UnprocessableEntityException('A empresa não possui endereço com localização no mapa.');
    }
    const a = company.address;
    return {
      name: company.tradeName,
      phone: company.phone,
      zipCode: a.zipCode,
      street: a.street,
      number: a.number,
      complement: a.complement,
      district: a.district,
      city: a.city,
      state: a.state,
      reference: a.reference,
      lat: a.lat!,
      lng: a.lng!,
    };
  }

  async quote(user: AuthUser, dto: DeliveryQuoteDto, companyId?: string) {
    const pickup = await this.resolveStop(user, dto.pickup, companyId ? await this.companyStop(companyId) : null);
    const dropoff = await this.resolveStop(user, dto.dropoff);
    const required = this.requiredVehicle(dto.weightKg, dto);
    if (dto.vehicleType && VEHICLE_RANK[dto.vehicleType] < VEHICLE_RANK[required]) {
      throw new BadRequestException(`Para esta carga é necessário no mínimo: ${required}.`);
    }
    const vehicleType = dto.vehicleType ?? required;
    const scheduledFor = dto.scheduledFor ? new Date(dto.scheduledFor) : null;
    if (scheduledFor && scheduledFor.getTime() < Date.now() + MIN_SCHEDULE_MINUTES * 60_000) {
      throw new BadRequestException(`Agende com pelo menos ${MIN_SCHEDULE_MINUTES} minutos de antecedência.`);
    }
    const route = await this.maps.route(pickup, dropoff, vehicleType);
    const context = {
      tenantId: user.tenantId,
      distanceKm: route.distanceKm,
      durationMin: route.durationMin,
      weightKg: dto.weightKg,
      vehicleType,
      city: pickup.city,
      state: pickup.state,
      at: scheduledFor ?? new Date(),
    };
    const [fee, payout] = await Promise.all([
      this.pricing.quote({ ...context, target: 'CUSTOMER_FEE' }),
      this.pricing.quote({ ...context, target: 'DRIVER_PAYOUT' }),
    ]);
    return { pickup, dropoff, vehicleType, scheduledFor, distanceKm: route.distanceKm, durationMin: route.durationMin, fee, payout };
  }

  async quoteView(user: AuthUser, dto: DeliveryQuoteDto, companyId?: string) {
    const quote = await this.quote(user, dto, companyId);
    return {
      vehicleType: quote.vehicleType,
      distanceKm: quote.distanceKm,
      durationMin: quote.durationMin,
      feeCents: quote.fee.totalCents,
      breakdown: quote.fee.lines,
      scheduledFor: quote.scheduledFor,
      pickup: quote.pickup,
      dropoff: quote.dropoff,
    };
  }

  // ---------------------------------------------------------------------------
  // Criação
  // ---------------------------------------------------------------------------

  private async uniqueCode(tx: Tx): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      if (!(await tx.delivery.findUnique({ where: { code }, select: { id: true } }))) return code;
    }
    throw new ConflictException('Não foi possível gerar o código da entrega.');
  }

  /** O módulo financeiro registra as formas de pagamento de avulsas e a cobrança com carteira. */
  registerOnDemandPayment(hook: OnDemandPaymentHook): void {
    this.onDemandPayment = hook;
  }

  onDemandMethods(isCompany: boolean): PaymentMethod[] {
    return this.onDemandPayment?.methods(isCompany) ?? (isCompany ? ['CASH', 'INVOICE'] : ['CASH']);
  }

  /** Entrega avulsa solicitada por um cliente ou por uma empresa (companyId). */
  async createOnDemand(user: AuthUser, dto: CreateDeliveryDto, companyId?: string) {
    const allowed = this.onDemandMethods(!!companyId);
    if (!allowed.includes(dto.paymentMethod)) {
      const labels: Record<string, string> = { CASH: 'dinheiro', INVOICE: 'faturado', WALLET: 'saldo da carteira' };
      throw new UnprocessableEntityException(`Formas aceitas: ${allowed.map((method) => labels[method] ?? method).join(', ')}.`);
    }
    if (dto.paymentMethod === 'WALLET' && !companyId && !user.customerId) throw new ForbiddenException('Perfil de cliente não encontrado.');
    if (companyId) {
      const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { status: true } });
      if (company?.status !== 'APPROVED') throw new ForbiddenException('A empresa precisa estar aprovada para solicitar entregas.');
    }
    const quote = await this.quote(user, dto, companyId);

    if (quote.scheduledFor) await this.assertSlotCapacity(user.tenantId, quote.scheduledFor);

    const delivery = await this.prisma.$transaction(async (tx) => {
      const created = await tx.delivery.create({
        data: {
          tenantId: user.tenantId,
          code: await this.uniqueCode(tx),
          kind: 'ON_DEMAND',
          requesterUserId: user.userId,
          companyId: companyId ?? null,
          status: quote.scheduledFor ? 'SCHEDULED' : 'PENDING',
          scheduledFor: quote.scheduledFor,
          pickup: quote.pickup as unknown as Prisma.InputJsonValue,
          dropoff: quote.dropoff as unknown as Prisma.InputJsonValue,
          pickupLat: quote.pickup.lat,
          pickupLng: quote.pickup.lng,
          dropoffLat: quote.dropoff.lat,
          dropoffLng: quote.dropoff.lng,
          city: quote.pickup.city,
          state: quote.pickup.state,
          itemCategory: dto.itemCategory,
          itemDescription: dto.itemDescription,
          weightKg: dto.weightKg,
          lengthCm: dto.lengthCm,
          widthCm: dto.widthCm,
          heightCm: dto.heightCm,
          declaredValueCents: dto.declaredValueCents,
          notes: dto.notes,
          vehicleType: quote.vehicleType,
          distanceKm: quote.distanceKm,
          durationMin: quote.durationMin,
          feeCents: quote.fee.totalCents,
          payoutCents: quote.payout.totalCents,
          tipCents: dto.tipCents ?? 0,
          paymentMethod: dto.paymentMethod,
          proofMethod: dto.proofMethod ?? (dto.itemCategory === 'DOCUMENT' ? 'SIGNATURE' : 'CODE'),
          dropoffCode: this.crypto.numericCode(4),
          statusHistory: { create: { toStatus: quote.scheduledFor ? 'SCHEDULED' : 'PENDING', actorType: companyId ? 'COMPANY' : 'CUSTOMER', actorId: user.userId } },
        },
      });
      if (dto.paymentMethod === 'WALLET') {
        if (!this.onDemandPayment) throw new UnprocessableEntityException('Pagamento com carteira indisponível.');
        await this.onDemandPayment.chargeWallet(tx, {
          tenantId: user.tenantId,
          owner: companyId ? { type: 'COMPANY', companyId } : { type: 'CUSTOMER', customerId: user.customerId! },
          payerUserId: user.userId,
          deliveryId: created.id,
          code: created.code,
          amountCents: created.feeCents + created.tipCents,
        });
        await tx.delivery.update({ where: { id: created.id }, data: { paymentStatus: 'PAID' } });
      }
      await this.audit.log(
        { action: 'delivery.create', entityType: 'Delivery', entityId: created.id, after: { code: created.code, feeCents: created.feeCents, companyId, paymentMethod: dto.paymentMethod } },
        tx,
      );
      return created;
    });
    this.emit(delivery, null, delivery.status, companyId ? 'COMPANY' : 'CUSTOMER');
    return delivery;
  }

  /** Reserva de capacidade: limita entregas agendadas por janela de 30 minutos. */
  private async assertSlotCapacity(tenantId: string, at: Date) {
    const { slotCapacity } = await this.settings.get(tenantId, 'dispatch.scheduling');
    const slotStart = new Date(Math.floor(at.getTime() / 1_800_000) * 1_800_000);
    const slotEnd = new Date(slotStart.getTime() + 1_800_000);
    const booked = await this.prisma.delivery.count({ where: { tenantId, status: 'SCHEDULED', scheduledFor: { gte: slotStart, lt: slotEnd } } });
    if (booked >= slotCapacity) throw new ConflictException('Horário esgotado para entregas agendadas. Escolha outro horário.');
  }

  /** Entrega de um pedido do marketplace (criada quando a loja confirma o pedido). */
  async createForOrder(orderId: string) {
    const existing = await this.prisma.delivery.findUnique({ where: { orderId } });
    if (existing) return existing;
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        company: { include: { address: true } },
        customer: { select: { userId: true, user: { select: { name: true, phone: true } } } },
        items: { include: { product: { select: { weightGrams: true } } } },
      },
    });
    if (order.fulfillment !== 'DELIVERY') return null;
    const pickup = await this.companyStop(order.companyId);
    const address = order.deliveryAddress as unknown as Omit<StopSnapshot, 'name' | 'phone'> & { recipientName?: string | null };
    const dropoff: StopSnapshot = {
      ...address,
      name: address.recipientName ?? order.customer.user.name.split(' ')[0],
      phone: order.customer.user.phone,
      complement: address.complement ?? null,
      reference: address.reference ?? null,
      district: address.district ?? null,
      zipCode: address.zipCode ?? null,
    };
    const weightKg = order.items.reduce((sum, item) => sum + ((item.product?.weightGrams ?? 0) * item.quantity) / 1000, 0);
    const vehicleType = this.requiredVehicle(weightKg);
    const route = await this.maps.route(pickup, dropoff, vehicleType);
    const payout = await this.pricing.quote({
      tenantId: order.tenantId,
      target: 'DRIVER_PAYOUT',
      distanceKm: route.distanceKm,
      durationMin: route.durationMin,
      weightKg,
      vehicleType,
      city: pickup.city,
      state: pickup.state,
      timeZone: order.company.timezone,
    });

    const delivery = await this.prisma.$transaction(async (tx) =>
      tx.delivery.create({
        data: {
          tenantId: order.tenantId,
          code: await this.uniqueCode(tx),
          kind: 'ORDER',
          orderId: order.id,
          requesterUserId: order.customer.userId,
          companyId: order.companyId,
          status: 'PENDING',
          pickup: pickup as unknown as Prisma.InputJsonValue,
          dropoff: dropoff as unknown as Prisma.InputJsonValue,
          pickupLat: pickup.lat,
          pickupLng: pickup.lng,
          dropoffLat: dropoff.lat,
          dropoffLng: dropoff.lng,
          city: pickup.city,
          state: pickup.state,
          itemCategory: 'FOOD',
          itemDescription: `Pedido #${order.number}`,
          weightKg,
          vehicleType,
          distanceKm: route.distanceKm,
          durationMin: route.durationMin,
          feeCents: order.deliveryFeeCents,
          payoutCents: payout.totalCents,
          tipCents: order.tipCents,
          paymentMethod: order.paymentMethod,
          proofMethod: 'CODE',
          dropoffCode: order.deliveryCode,
          requiresIdCheck: order.requiresIdCheck,
          statusHistory: { create: { toStatus: 'PENDING', actorType: 'SYSTEM' } },
        },
      }),
    );
    this.emit(delivery, null, 'PENDING', 'SYSTEM');
    return delivery;
  }

  // ---------------------------------------------------------------------------
  // Máquina de estados
  // ---------------------------------------------------------------------------

  async transition(
    deliveryId: string,
    to: DeliveryStatus,
    actor: { type: ActorType; id?: string | null },
    options: { reason?: string; data?: Prisma.DeliveryUncheckedUpdateManyInput; expectedFrom?: DeliveryStatus[]; lat?: number; lng?: number } = {},
  ) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) throw new NotFoundException('Entrega não encontrada.');
    if (options.expectedFrom && !options.expectedFrom.includes(delivery.status)) {
      throw new ConflictException('A entrega mudou de status. Atualize e tente novamente.');
    }
    if (!canTransitionDelivery(delivery.status, to)) {
      throw new ConflictException(`Não é possível mudar a entrega de ${delivery.status} para ${to}.`);
    }
    const now = new Date();
    const stamps: Partial<Record<DeliveryStatus, Prisma.DeliveryUncheckedUpdateManyInput>> = {
      SEARCHING_DRIVER: { searchStartedAt: delivery.searchStartedAt ?? now },
      DRIVER_ASSIGNED: { assignedAt: now },
      AT_PICKUP: { arrivedPickupAt: now },
      PICKED_UP: { pickedUpAt: now },
      AT_DROPOFF: { arrivedDropoffAt: now },
      DELIVERED: { deliveredAt: now },
      FAILED: { failedAt: now, failReason: options.reason ?? null },
      CANCELED: { canceledAt: now, cancelReason: options.reason ?? null },
    };
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.delivery.updateMany({
        where: { id: deliveryId, status: delivery.status },
        data: { status: to, ...stamps[to], ...options.data },
      });
      if (result.count === 0) throw new ConflictException('A entrega mudou de status. Atualize e tente novamente.');
      // Saindo da busca (aceite, cancelamento, falha...): nenhuma oferta pendente sobrevive.
      if (to !== 'SEARCHING_DRIVER') await tx.deliveryOffer.updateMany({ where: { deliveryId, status: 'PENDING' }, data: { status: 'CANCELED', respondedAt: now } });
      await tx.deliveryStatusHistory.create({
        data: { deliveryId, fromStatus: delivery.status, toStatus: to, actorType: actor.type, actorId: actor.id ?? null, reason: options.reason, lat: options.lat, lng: options.lng },
      });
      await this.audit.log(
        { action: `delivery.status.${to.toLowerCase()}`, entityType: 'Delivery', entityId: deliveryId, before: { status: delivery.status }, after: { status: to, reason: options.reason } },
        tx,
      );
      return tx.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
    });
    this.emit(updated, delivery.status, to, actor.type, options.reason);
    return updated;
  }

  emit(delivery: { id: string; tenantId: string; code: string; kind: 'ORDER' | 'ON_DEMAND'; orderId: string | null; companyId: string | null; requesterUserId: string; driverId: string | null }, from: DeliveryStatus | null, to: DeliveryStatus, actorType: ActorType, reason?: string) {
    this.events.emit(DELIVERY_STATUS_CHANGED, {
      deliveryId: delivery.id,
      tenantId: delivery.tenantId,
      code: delivery.code,
      kind: delivery.kind,
      orderId: delivery.orderId,
      companyId: delivery.companyId,
      requesterUserId: delivery.requesterUserId,
      driverId: delivery.driverId,
      from,
      to,
      actorType,
      reason,
    } satisfies DeliveryStatusChangedEvent);
  }

  // ---------------------------------------------------------------------------
  // Prova de entrega
  // ---------------------------------------------------------------------------

  async deliver(
    user: AuthUser,
    deliveryId: string,
    input: { method: 'CODE' | 'QR_CODE' | 'PHOTO' | 'SIGNATURE'; code?: string; recipientName?: string; idChecked?: boolean },
    file?: { buffer: Buffer; mime: string; ext: string },
  ) {
    const delivery = await this.findForDriver(user, deliveryId);
    if (!['PICKED_UP', 'IN_TRANSIT', 'AT_DROPOFF'].includes(delivery.status)) throw new ConflictException('Colete o item antes de concluir a entrega.');

    const codeMethods = ['CODE', 'QR_CODE'];
    const accepted = codeMethods.includes(delivery.proofMethod) ? codeMethods : [delivery.proofMethod];
    if (!accepted.includes(input.method)) throw new BadRequestException(`Esta entrega exige comprovação por ${delivery.proofMethod}.`);

    let codeVerified = false;
    if (codeMethods.includes(input.method)) {
      // O QR code do cliente carrega "LEVOJA:<código da entrega>:<código de confirmação>".
      const code = input.method === 'QR_CODE' ? (input.code ?? '').split(':').pop() ?? '' : (input.code ?? '');
      if (input.method === 'QR_CODE' && !(input.code ?? '').includes(delivery.code)) throw new BadRequestException('QR code não pertence a esta entrega.');
      if (!this.crypto.safeEqual(code, delivery.dropoffCode)) throw new BadRequestException('Código de entrega incorreto.');
      codeVerified = true;
    } else {
      if (!file) throw new BadRequestException(input.method === 'PHOTO' ? 'Envie a foto da entrega.' : 'Envie a assinatura do recebedor.');
      if (input.method === 'SIGNATURE' && !input.recipientName?.trim()) throw new BadRequestException('Informe o nome de quem recebeu.');
    }
    if (delivery.requiresIdCheck && !input.idChecked) throw new BadRequestException('Confira o documento do recebedor (idade mínima) antes de concluir.');

    // Antifraude: a conclusão precisa acontecer perto do destino.
    const driver = await this.prisma.driver.findUniqueOrThrow({ where: { id: delivery.driverId! }, select: { lastLat: true, lastLng: true } });
    const { proofMaxDistanceMeters } = await this.settings.get(user.tenantId, 'dispatch');
    if (driver.lastLat != null && driver.lastLng != null) {
      const meters = haversineKm({ lat: driver.lastLat, lng: driver.lastLng }, { lat: delivery.dropoffLat, lng: delivery.dropoffLng }) * 1000;
      if (meters > proofMaxDistanceMeters) throw new ConflictException(`Você está a ${Math.round(meters)} m do destino. Conclua a entrega no local.`);
    }

    const fileKey = file ? await this.storage.put(`private/deliveries/${delivery.id}/proof-${Date.now()}.${file.ext}`, file.buffer, file.mime) : null;
    await this.prisma.deliveryProof.create({
      data: {
        deliveryId: delivery.id,
        method: input.method,
        codeVerified,
        fileKey,
        recipientName: input.recipientName?.trim() || null,
        idChecked: !!input.idChecked,
        lat: driver.lastLat,
        lng: driver.lastLng,
        createdById: user.userId,
      },
    });
    if (delivery.status === 'PICKED_UP') await this.transition(delivery.id, 'IN_TRANSIT', { type: 'DRIVER', id: user.userId });
    return this.transition(delivery.id, 'DELIVERED', { type: 'DRIVER', id: user.userId }, { lat: driver.lastLat ?? undefined, lng: driver.lastLng ?? undefined });
  }

  // ---------------------------------------------------------------------------
  // Consultas e visões
  // ---------------------------------------------------------------------------

  async findForDriver(user: AuthUser, deliveryId: string) {
    if (!user.driverId) throw new ForbiddenException('Perfil de entregador não encontrado.');
    const delivery = await this.prisma.delivery.findFirst({ where: { id: deliveryId, driverId: user.driverId } });
    if (!delivery) throw new NotFoundException('Entrega não encontrada.');
    return delivery;
  }

  private scopeFilter(query: DeliveriesQueryDto): Prisma.DeliveryWhereInput {
    return {
      status:
        query.status ??
        (query.scope === 'active'
          ? { in: ['PENDING', 'SCHEDULED', 'SEARCHING_DRIVER', ...ACTIVE_DELIVERY_STATUSES] }
          : query.scope === 'finished'
            ? { in: ['DELIVERED', 'FAILED', 'CANCELED'] }
            : undefined),
    };
  }

  async listForRequester(user: AuthUser, query: DeliveriesQueryDto) {
    const where: Prisma.DeliveryWhereInput = { requesterUserId: user.userId, kind: 'ON_DEMAND', companyId: null, ...this.scopeFilter(query) };
    return this.page(where, query, (d) => this.requesterView(d));
  }

  async getForRequester(user: AuthUser, id: string) {
    const delivery = await this.prisma.delivery.findFirst({ where: { id, requesterUserId: user.userId }, include: deliveryInclude });
    if (!delivery) throw new NotFoundException('Entrega não encontrada.');
    const reviews = await this.prisma.review.count({ where: { deliveryId: id, authorUserId: user.userId } });
    return { ...this.requesterView(delivery), reviewed: reviews > 0 };
  }

  async listForCompany(companyId: string, query: DeliveriesQueryDto) {
    return this.page({ companyId, ...this.scopeFilter(query) }, query, (d) => this.requesterView(d));
  }

  async getForCompany(companyId: string, id: string) {
    const delivery = await this.prisma.delivery.findFirst({ where: { id, companyId }, include: deliveryInclude });
    if (!delivery) throw new NotFoundException('Entrega não encontrada.');
    return this.requesterView(delivery);
  }

  async getForDriver(user: AuthUser, id: string) {
    if (!user.driverId) throw new ForbiddenException('Perfil de entregador não encontrado.');
    const delivery = await this.prisma.delivery.findFirst({ where: { id, driverId: user.driverId }, include: deliveryInclude });
    if (!delivery) throw new NotFoundException('Entrega não encontrada.');
    return this.driverView(delivery);
  }

  async listForDriver(user: AuthUser, query: DeliveriesQueryDto) {
    if (!user.driverId) throw new ForbiddenException('Perfil de entregador não encontrado.');
    return this.page({ driverId: user.driverId, ...this.scopeFilter(query) }, query, (d) => this.driverView(d));
  }

  async listForAdmin(user: AuthUser, query: DeliveriesQueryDto) {
    const where: Prisma.DeliveryWhereInput = {
      tenantId: user.tenantId,
      driverId: query.driverId,
      companyId: query.companyId,
      ...this.scopeFilter(query),
      ...(query.search ? { code: { contains: query.search.toUpperCase() } } : {}),
    };
    return this.page(where, query, (d) => this.adminView(d));
  }

  async getForAdmin(user: AuthUser, id: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { ...deliveryInclude, offers: { orderBy: { createdAt: 'asc' }, include: { driver: { select: { user: { select: { name: true } } } } } } },
    });
    if (!delivery) throw new NotFoundException('Entrega não encontrada.');
    const tracking = await this.prisma.deliveryTrackingPoint.findMany({ where: { deliveryId: id }, orderBy: { recordedAt: 'asc' }, take: 2000, select: { lat: true, lng: true, recordedAt: true } });
    return {
      ...this.adminView(delivery),
      offers: delivery.offers.map((offer) => ({ ...offer, driverName: offer.driver.user.name, driver: undefined })),
      tracking,
    };
  }

  async trackingPoints(deliveryId: string, since?: Date) {
    return this.prisma.deliveryTrackingPoint.findMany({
      where: { deliveryId, ...(since ? { recordedAt: { gt: since } } : {}) },
      orderBy: { recordedAt: 'asc' },
      take: 1000,
      select: { lat: true, lng: true, heading: true, speed: true, recordedAt: true },
    });
  }

  /** Rastreamento público (link para o destinatário): sem dados pessoais, posição aproximada. */
  async publicTracking(code: string) {
    const delivery = await this.prisma.delivery.findUnique({ where: { code: code.toUpperCase() }, include: deliveryInclude });
    if (!delivery) throw new NotFoundException('Entrega não encontrada.');
    const active = ACTIVE_DELIVERY_STATUSES.includes(delivery.status);
    const driver = delivery.driver;
    return {
      code: delivery.code,
      status: delivery.status,
      company: delivery.company?.tradeName ?? null,
      driver: driver ? { firstName: driver.user.name.split(' ')[0], vehicle: driver.activeVehicle?.type ?? null } : null,
      driverLocation: active && driver?.lastLat != null && driver.lastLng != null ? approximate({ lat: driver.lastLat, lng: driver.lastLng }, 3) : null,
      dropoff: approximate({ lat: delivery.dropoffLat, lng: delivery.dropoffLng }, 3),
      estimatedArrivalAt: this.eta(delivery),
      deliveredAt: delivery.deliveredAt,
    };
  }

  private async page<T>(where: Prisma.DeliveryWhereInput, query: DeliveriesQueryDto, view: (d: DeliveryWithRelations) => T) {
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.delivery.count({ where }),
      this.prisma.delivery.findMany({ where, include: deliveryInclude, orderBy: { createdAt: 'desc' }, skip: skipOf(query), take: query.pageSize }),
    ]);
    return paginated(rows.map(view), total, query);
  }

  /** Previsão de chegada ao destino a partir da posição atual do entregador. */
  eta(delivery: DeliveryWithRelations): Date | null {
    if (['DELIVERED', 'FAILED', 'CANCELED'].includes(delivery.status)) return null;
    const driver = delivery.driver;
    const speedKmh = 22;
    if (!driver?.lastLat || !driver.lastLng) return new Date(Date.now() + (delivery.durationMin + 10) * 60_000);
    const here = { lat: driver.lastLat, lng: driver.lastLng };
    const pickup = { lat: delivery.pickupLat, lng: delivery.pickupLng };
    const dropoff = { lat: delivery.dropoffLat, lng: delivery.dropoffLng };
    const beforePickup = ['DRIVER_ASSIGNED', 'AT_PICKUP'].includes(delivery.status);
    const km = (beforePickup ? haversineKm(here, pickup) + haversineKm(pickup, dropoff) : haversineKm(here, dropoff)) * 1.35;
    return new Date(Date.now() + ((km / speedKmh) * 60 + (beforePickup ? 5 : 0)) * 60_000);
  }

  private base(delivery: DeliveryWithRelations) {
    const driver = delivery.driver;
    return {
      id: delivery.id,
      code: delivery.code,
      kind: delivery.kind,
      status: delivery.status,
      scheduledFor: delivery.scheduledFor,
      order: delivery.order ? { id: delivery.order.id, number: delivery.order.number } : null,
      company: delivery.company ? { id: delivery.company.id, tradeName: delivery.company.tradeName } : null,
      pickup: delivery.pickup as unknown as StopSnapshot,
      dropoff: delivery.dropoff as unknown as StopSnapshot,
      itemCategory: delivery.itemCategory,
      itemDescription: delivery.itemDescription,
      weightKg: delivery.weightKg,
      vehicleType: delivery.vehicleType,
      distanceKm: delivery.distanceKm,
      durationMin: delivery.durationMin,
      feeCents: delivery.feeCents,
      tipCents: delivery.tipCents,
      paymentMethod: delivery.paymentMethod,
      proofMethod: delivery.proofMethod,
      requiresIdCheck: delivery.requiresIdCheck,
      notes: delivery.notes,
      driver: driver
        ? {
            id: driver.id,
            name: driver.user.name.split(' ')[0],
            photoUrl: this.storage.publicUrl(driver.user.avatarKey),
            rating: driver.ratingAvg,
            vehicle: driver.activeVehicle,
          }
        : null,
      driverLocation:
        driver && ACTIVE_DELIVERY_STATUSES.includes(delivery.status) && driver.lastLat != null
          ? { lat: driver.lastLat, lng: driver.lastLng, at: driver.lastLocationAt }
          : null,
      estimatedArrivalAt: this.eta(delivery),
      timeline: delivery.statusHistory.map((entry) => ({ status: entry.toStatus, at: entry.createdAt, actorType: entry.actorType, reason: entry.reason })),
      proofs: delivery.proofs.map((proof) => ({ method: proof.method, recipientName: proof.recipientName, codeVerified: proof.codeVerified, at: proof.createdAt, hasFile: !!proof.fileKey })),
      cancelReason: delivery.cancelReason,
      failReason: delivery.failReason,
      createdAt: delivery.createdAt,
      deliveredAt: delivery.deliveredAt,
    };
  }

  requesterView(delivery: DeliveryWithRelations) {
    const done = ['DELIVERED', 'FAILED', 'CANCELED'].includes(delivery.status);
    return {
      ...this.base(delivery),
      // Mostrado ao solicitante/destinatário para confirmar o recebimento (código ou QR code).
      dropoffCode: done ? null : delivery.dropoffCode,
      qrCodePayload: done ? null : `LEVOJA:${delivery.code}:${delivery.dropoffCode}`,
      trackingPath: `/rastreio/${delivery.code}`,
    };
  }

  driverView(delivery: DeliveryWithRelations) {
    const base = this.base(delivery);
    const mask = (phone: string | null | undefined) => (phone ? `${phone.slice(0, 5)}*****${phone.slice(-4)}` : null);
    return {
      ...base,
      payoutCents: delivery.payoutCents,
      // Privacidade: telefones mascarados; o contato acontece pelo chat da plataforma.
      pickup: { ...base.pickup, phone: mask(base.pickup.phone) },
      dropoff: { ...base.dropoff, phone: mask(base.dropoff.phone) },
      order: delivery.order
        ? {
            id: delivery.order.id,
            number: delivery.order.number,
            items: delivery.order.items.map((item) => `${item.quantity}× ${item.productName}`),
            collectCents: delivery.order.paymentMethod === 'CASH' ? delivery.order.totalCents : 0,
            changeForCents: delivery.order.changeForCents,
          }
        : null,
      collectCents: delivery.kind === 'ON_DEMAND' && delivery.paymentMethod === 'CASH' ? delivery.feeCents + delivery.tipCents : undefined,
    };
  }

  adminView(delivery: DeliveryWithRelations) {
    return { ...this.base(delivery), payoutCents: delivery.payoutCents, dispatchAttempts: delivery.dispatchAttempts, searchRadiusKm: delivery.searchRadiusKm, requesterUserId: delivery.requesterUserId };
  }
}
