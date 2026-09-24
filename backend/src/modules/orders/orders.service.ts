import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { canTransitionOrder, isAdult, ORDER_ACTIVE_STATUSES, ORDER_CUSTOMER_CANCELABLE, applyBps } from '@levoja/shared';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { JobsService } from '../../infra/jobs/jobs.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { PricingService } from '../pricing/pricing.service';
import { MapsService, TravelMode } from '../geo/maps.service';
import { ServiceAreasService } from '../catalog/service-areas.service';
import { productInclude, ProductWithRelations } from '../catalog/catalog.service';
import { priceLine, SelectedOption, totalWeightKg } from '../cart/line-pricing';
import { isWithinOpeningHours } from '../../common/opening-hours';
import { paginated, skipOf } from '../../common/pagination';
import type { AuthUser } from '../../common/auth/auth-user';
import { AdminOrdersQueryDto, CheckoutDto, OrdersQueryDto, QuoteOrderDto } from './orders.dto';
import { CouponsService } from '../coupons/coupons.service';
import { Prisma } from '../../generated/prisma/client';
import type { Coupon } from '../../generated/prisma/client';
import type { ActorType, OrderStatus, PaymentMethod } from '../../generated/prisma/enums';

export const ORDER_CREATED = 'order.created';
export const ORDER_STATUS_CHANGED = 'order.status.changed';

export interface OrderStatusChangedEvent {
  orderId: string;
  tenantId: string;
  companyId: string;
  customerUserId: string;
  number: number;
  from: OrderStatus | null;
  to: OrderStatus;
  actorType: ActorType;
  reason?: string;
  fulfillment: 'DELIVERY' | 'PICKUP';
}

/** Métodos de pagamento aceitos no checkout. Pagamentos online entram com o módulo financeiro. */
export type PaymentMethodPolicy = (
  tenantId: string,
  method: PaymentMethod,
  context: { customerId: string; cardToken?: string },
) => Promise<{ allowed: boolean; reason?: string; initialStatus: OrderStatus }>;

export type PaymentStarter = (user: AuthUser, order: { id: string; tenantId: string; number: number; totalCents: number; paymentMethod: PaymentMethod }, dto: CheckoutDto) => Promise<void>;

const MIN_SCHEDULE_MINUTES = 30;
const MAX_SCHEDULE_DAYS = 7;
const DISPATCH_BUFFER_MIN = 5;

const orderInclude = {
  items: true,
  company: { select: { id: true, tradeName: true, slug: true, logoKey: true, phone: true, address: true } },
  customer: { select: { id: true, user: { select: { id: true, name: true, phone: true } } } },
  statusHistory: { orderBy: { createdAt: 'asc' } },
  delivery: {
    select: {
      id: true,
      code: true,
      status: true,
      driver: { select: { lastLat: true, lastLng: true, lastLocationAt: true, ratingAvg: true, user: { select: { name: true } }, activeVehicle: { select: { type: true, plate: true, model: true, color: true } } } },
    },
  },
} satisfies Prisma.OrderInclude;

type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

interface QuoteLine {
  product: ProductWithRelations;
  cartItemId: string;
  quantity: number;
  notes: string | null;
  unitPriceCents: number;
  options: SelectedOption[];
  issues: string[];
}

@Injectable()
export class OrdersService implements OnModuleInit {
  private paymentPolicy: PaymentMethodPolicy = async (_tenantId, method) =>
    method === 'CASH'
      ? { allowed: true, initialStatus: 'NEW' }
      : { allowed: false, reason: 'Pagamento online ainda não disponível. Escolha dinheiro na entrega.', initialStatus: 'NEW' };

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly pricing: PricingService,
    private readonly maps: MapsService,
    private readonly areas: ServiceAreasService,
    private readonly coupons: CouponsService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit(): void {
    this.jobs.register<{ orderId: string }>('orders.acceptTimeout', ({ orderId }) => this.autoCancelIfNotAccepted(orderId));
  }

  private paymentStarter?: PaymentStarter;

  /** O módulo financeiro registra aqui a política de pagamentos online e o início da cobrança. */
  registerPaymentPolicy(policy: PaymentMethodPolicy, starter?: PaymentStarter): void {
    this.paymentPolicy = policy;
    this.paymentStarter = starter;
  }

  // ---------------------------------------------------------------------------
  // Cotação e checkout
  // ---------------------------------------------------------------------------

  async quote(user: AuthUser, dto: QuoteOrderDto, tx: Tx = this.prisma) {
    const customerId = this.requireCustomer(user);
    const fulfillment = dto.fulfillment ?? 'DELIVERY';
    const issues: string[] = [];

    const company = await tx.company.findFirst({
      where: { id: dto.companyId, tenantId: user.tenantId },
      include: { address: true, openingHours: true, segment: { select: { minimumAge: true, isRegulated: true } } },
    });
    if (!company || company.status !== 'APPROVED') throw new NotFoundException('Loja não encontrada.');

    const cart = await tx.cart.findUnique({
      where: { customerId_companyId: { customerId, companyId: company.id } },
      include: { items: { orderBy: { createdAt: 'asc' }, include: { product: { include: productInclude } } } },
    });
    if (!cart || cart.items.length === 0) throw new BadRequestException('Seu carrinho está vazio.');

    const lines: QuoteLine[] = cart.items.map((item) => {
      const priced = priceLine(item.product, item.optionIds);
      return { product: item.product, cartItemId: item.id, quantity: item.quantity, notes: item.notes, ...priced };
    });
    lines.forEach((line) => issues.push(...line.issues));
    const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);

    // Horário: pedido imediato exige loja aberta agora; agendado exige horário válido no futuro.
    const now = new Date();
    let scheduledFor: Date | null = null;
    if (!company.isOpen) issues.push('A loja não está recebendo pedidos no momento.');
    if (dto.scheduledFor) {
      scheduledFor = new Date(dto.scheduledFor);
      const minutesAhead = (scheduledFor.getTime() - now.getTime()) / 60_000;
      if (minutesAhead < MIN_SCHEDULE_MINUTES) issues.push(`Agende com pelo menos ${MIN_SCHEDULE_MINUTES} minutos de antecedência.`);
      if (minutesAhead > MAX_SCHEDULE_DAYS * 1440) issues.push(`Agendamentos em até ${MAX_SCHEDULE_DAYS} dias.`);
      if (!isWithinOpeningHours(company.openingHours, scheduledFor, company.timezone)) issues.push('A loja estará fechada no horário escolhido.');
    } else if (company.isOpen && !isWithinOpeningHours(company.openingHours, now, company.timezone)) {
      issues.push('A loja está fora do horário de funcionamento. Você pode agendar o pedido.');
    }

    // Regras de produtos regulados.
    const minimumAge = Math.max(company.segment.minimumAge ?? 0, ...lines.map((line) => line.product.minimumAge ?? 0));
    if (minimumAge > 0) {
      const buyer = await tx.user.findUnique({ where: { id: user.userId }, select: { birthDate: true } });
      if (!buyer?.birthDate) issues.push(`Alguns itens exigem idade mínima de ${minimumAge} anos. Informe sua data de nascimento no perfil.`);
      else if (!isAdult(buyer.birthDate, now, minimumAge)) issues.push(`Alguns itens são proibidos para menores de ${minimumAge} anos.`);
    }
    const requiresPrescription = lines.some((line) => line.product.requiresPrescription);

    // Entrega: endereço, cobertura, rota e frete.
    let deliveryFeeCents = 0;
    let distanceKm: number | null = null;
    let durationMin = 0;
    let address: Prisma.AddressGetPayload<object> | null = null;
    let minimumOrderCents = company.minimumOrderCents;
    let extraMinutes = 0;
    const weightKg = totalWeightKg(lines);
    const vehicleType: TravelMode = weightKg > 150 ? 'VAN' : weightKg > 20 ? 'CAR' : 'MOTORCYCLE';

    if (fulfillment === 'DELIVERY') {
      if (!dto.addressId) throw new BadRequestException('Informe o endereço de entrega.');
      address = await tx.address.findFirst({ where: { id: dto.addressId, userId: user.userId, deletedAt: null } });
      if (!address) throw new NotFoundException('Endereço não encontrado.');
      const origin = company.address?.lat != null && company.address?.lng != null ? { lat: company.address.lat, lng: company.address.lng } : null;
      const destination = address.lat != null && address.lng != null ? { lat: address.lat, lng: address.lng } : null;
      if (!origin) throw new UnprocessableEntityException('A loja ainda não definiu sua localização. Tente novamente mais tarde.');
      if (!destination) throw new UnprocessableEntityException('Não conseguimos localizar seu endereço no mapa. Edite o endereço e use "Usar minha localização".');

      const coverage = await this.areas.coverage(company, { point: destination, district: address.district, city: address.city, state: address.state });
      if (!coverage.covered) issues.push('A loja não entrega no seu endereço.');
      if (coverage.area?.minimumOrderCents != null) minimumOrderCents = coverage.area.minimumOrderCents;
      extraMinutes = coverage.area?.extraMinutes ?? 0;

      const route = await this.maps.route(origin, destination, vehicleType);
      distanceKm = route.distanceKm;
      durationMin = route.durationMin;
      const fee = await this.pricing.quote({
        tenantId: user.tenantId,
        target: 'CUSTOMER_FEE',
        distanceKm: route.distanceKm,
        durationMin: route.durationMin,
        weightKg,
        vehicleType,
        city: address.city,
        state: address.state,
        at: scheduledFor ?? now,
        timeZone: company.timezone,
      });
      deliveryFeeCents = Math.max(0, fee.totalCents + (coverage.area?.feeAdjustmentCents ?? 0));
    }

    if (subtotalCents < minimumOrderCents) {
      issues.push(`O pedido mínimo desta loja é de R$ ${(minimumOrderCents / 100).toFixed(2).replace('.', ',')}.`);
    }

    const serviceFee = await this.settings.get(user.tenantId, 'marketplace.serviceFee');
    let serviceFeeCents = applyBps(subtotalCents, serviceFee.bps);
    serviceFeeCents = Math.max(serviceFee.minCents, serviceFee.maxCents != null ? Math.min(serviceFee.maxCents, serviceFeeCents) : serviceFeeCents);
    if (serviceFee.bps === 0 && serviceFee.minCents === 0) serviceFeeCents = 0;

    const tipCents = fulfillment === 'DELIVERY' ? (dto.tipCents ?? 0) : 0;

    // Cupom: desconto sobre os produtos ou frete grátis.
    let discountCents = 0;
    let coupon: Coupon | null = null;
    if (dto.couponCode) {
      const evaluation = await this.coupons.evaluate(
        dto.couponCode,
        { tenantId: user.tenantId, customerId, companyId: company.id, segmentId: company.segmentId, subtotalCents, deliveryFeeCents, at: scheduledFor ?? now, timeZone: company.timezone },
        tx,
      );
      if (evaluation.ok) {
        discountCents = evaluation.discountCents;
        coupon = evaluation.coupon;
      } else {
        issues.push(evaluation.reason);
      }
    }
    const totalCents = subtotalCents + deliveryFeeCents + serviceFeeCents + tipCents - discountCents;
    const base = scheduledFor ?? now;
    const readyAt = new Date(base.getTime() + company.averagePrepMinutes * 60_000);
    const estimatedDeliveryAt =
      fulfillment === 'DELIVERY' ? new Date(readyAt.getTime() + (durationMin + DISPATCH_BUFFER_MIN + extraMinutes) * 60_000) : readyAt;

    return {
      company,
      address,
      lines,
      fulfillment,
      scheduledFor,
      subtotalCents,
      deliveryFeeCents,
      serviceFeeCents,
      tipCents,
      discountCents,
      coupon,
      totalCents,
      distanceKm,
      weightKg,
      vehicleType,
      estimatedReadyAt: readyAt,
      estimatedDeliveryAt,
      requiresIdCheck: minimumAge >= 18,
      requiresPrescription,
      issues,
    };
  }

  /** Resumo público da cotação (sem objetos internos). */
  async quoteView(user: AuthUser, dto: QuoteOrderDto) {
    const quote = await this.quote(user, dto);
    return {
      companyId: quote.company.id,
      fulfillment: quote.fulfillment,
      items: quote.lines.map((line) => ({
        cartItemId: line.cartItemId,
        productId: line.product.id,
        name: line.product.name,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        totalCents: line.unitPriceCents * line.quantity,
        options: line.options,
        issues: line.issues,
      })),
      subtotalCents: quote.subtotalCents,
      deliveryFeeCents: quote.deliveryFeeCents,
      serviceFeeCents: quote.serviceFeeCents,
      tipCents: quote.tipCents,
      discountCents: quote.discountCents,
      coupon: quote.coupon ? { code: quote.coupon.code, type: quote.coupon.type, description: quote.coupon.description } : null,
      totalCents: quote.totalCents,
      distanceKm: quote.distanceKm,
      estimatedDeliveryAt: quote.estimatedDeliveryAt,
      requiresPrescription: quote.requiresPrescription,
      requiresIdCheck: quote.requiresIdCheck,
      canCheckout: quote.issues.length === 0,
      issues: quote.issues,
    };
  }

  async checkout(user: AuthUser, dto: CheckoutDto) {
    const customerId = this.requireCustomer(user);
    const payment = await this.paymentPolicy(user.tenantId, dto.paymentMethod, { customerId, cardToken: dto.cardToken });
    if (!payment.allowed) throw new UnprocessableEntityException(payment.reason ?? 'Forma de pagamento indisponível.');

    const order = await this.prisma.$transaction(
      async (tx) => {
        const quote = await this.quote(user, dto, tx);
        if (quote.issues.length) throw new ConflictException({ message: quote.issues[0], details: quote.issues });

        if (quote.requiresPrescription) {
          if (!dto.prescriptionId) throw new UnprocessableEntityException('Este pedido contém item que exige receita. Envie a receita para continuar.');
          const prescription = await tx.prescription.findFirst({ where: { id: dto.prescriptionId, userId: user.userId } });
          if (!prescription) throw new NotFoundException('Receita não encontrada.');
        }
        if (dto.paymentMethod === 'CASH' && dto.changeForCents != null && dto.changeForCents < quote.totalCents) {
          throw new BadRequestException('O valor para troco deve ser maior que o total do pedido.');
        }

        await this.reserveStock(tx, quote.lines);
        const number = await this.nextOrderNumber(tx, user.tenantId);
        const address = quote.address;

        const created = await tx.order.create({
          data: {
            tenantId: user.tenantId,
            number,
            customerId,
            companyId: quote.company.id,
            status: payment.initialStatus,
            fulfillment: quote.fulfillment,
            deliveryAddress: address
              ? {
                  addressId: address.id,
                  recipientName: address.recipientName,
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
                }
              : Prisma.DbNull,
            subtotalCents: quote.subtotalCents,
            deliveryFeeCents: quote.deliveryFeeCents,
            serviceFeeCents: quote.serviceFeeCents,
            tipCents: quote.tipCents,
            discountCents: quote.discountCents,
            totalCents: quote.totalCents,
            paymentMethod: dto.paymentMethod,
            changeForCents: dto.paymentMethod === 'CASH' ? (dto.changeForCents ?? null) : null,
            notes: dto.notes?.trim() || null,
            scheduledFor: quote.scheduledFor,
            estimatedReadyAt: quote.estimatedReadyAt,
            estimatedDeliveryAt: quote.estimatedDeliveryAt,
            distanceKm: quote.distanceKm,
            deliveryCode: this.crypto.numericCode(4),
            requiresIdCheck: quote.requiresIdCheck,
            prescriptionId: quote.requiresPrescription ? dto.prescriptionId : null,
            couponId: quote.coupon?.id ?? null,
            items: {
              create: quote.lines.map((line) => ({
                productId: line.product.id,
                productName: line.product.name,
                sku: line.product.sku,
                unitPriceCents: line.unitPriceCents,
                quantity: line.quantity,
                options: line.options.length ? (line.options as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
                notes: line.notes,
                totalCents: line.unitPriceCents * line.quantity,
              })),
            },
            statusHistory: { create: { fromStatus: null, toStatus: payment.initialStatus, actorType: 'CUSTOMER', actorId: user.userId } },
          },
        });
        if (quote.coupon) await this.coupons.redeem(tx, quote.coupon, customerId, created.id, quote.discountCents);
        // Pagamento online: o carrinho só é esvaziado quando o pagamento for aprovado (recusa não perde a sacola).
        if (payment.initialStatus === 'NEW') await tx.cart.deleteMany({ where: { customerId, companyId: quote.company.id } });
        await this.audit.log(
          { action: 'order.create', entityType: 'Order', entityId: created.id, after: { number, totalCents: quote.totalCents, paymentMethod: dto.paymentMethod } },
          tx,
        );
        return created;
      },
      { timeout: 20_000 },
    );

    if (order.status === 'NEW') await this.scheduleAcceptTimeout(order.tenantId, order.id);
    this.events.emit(ORDER_CREATED, { ...this.eventBase(order, user.userId), from: null, to: order.status, actorType: 'CUSTOMER' } satisfies OrderStatusChangedEvent);
    // Pagamento online: gera o PIX ou cobra o cartão (o pedido segue quando o pagamento for aprovado).
    if (dto.paymentMethod !== 'CASH' && this.paymentStarter) await this.paymentStarter(user, order, dto);
    return this.getForCustomer(user, order.id);
  }

  private async nextOrderNumber(tx: Tx, tenantId: string): Promise<number> {
    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO counters ("tenantId", key, value) VALUES (${tenantId}::uuid, 'order', 1)
      ON CONFLICT ("tenantId", key) DO UPDATE SET value = counters.value + 1
      RETURNING value`;
    return Number(rows[0].value);
  }

  /** Baixa de estoque atômica (produto, componentes de combo e opções). Falha se faltar estoque. */
  private async reserveStock(tx: Tx, lines: QuoteLine[]) {
    const decrement = async (id: string, quantity: number, name: string) => {
      const result = await tx.product.updateMany({ where: { id, trackStock: true, stockQuantity: { gte: quantity } }, data: { stockQuantity: { decrement: quantity } } });
      if (result.count === 0) throw new ConflictException(`Estoque insuficiente: ${name}.`);
    };
    for (const line of lines) {
      if (line.product.trackStock) await decrement(line.product.id, line.quantity, line.product.name);
      for (const item of line.product.comboItems) {
        if (item.product.trackStock) await decrement(item.productId, item.quantity * line.quantity, item.product.name);
      }
      for (const option of line.options) {
        const source = line.product.optionGroups.flatMap((group) => group.options).find((candidate) => candidate.id === option.optionId);
        if (source?.trackStock) {
          const result = await tx.productOption.updateMany({
            where: { id: source.id, stockQuantity: { gte: line.quantity } },
            data: { stockQuantity: { decrement: line.quantity } },
          });
          if (result.count === 0) throw new ConflictException(`Estoque insuficiente: ${line.product.name} (${source.name}).`);
        }
      }
    }
  }

  private async restoreStock(tx: Tx, orderId: string) {
    const items = await tx.orderItem.findMany({
      where: { orderId },
      include: { product: { include: { comboItems: true, optionGroups: { include: { options: true } } } } },
    });
    for (const item of items) {
      if (!item.product) continue;
      if (item.product.trackStock) await tx.product.update({ where: { id: item.product.id }, data: { stockQuantity: { increment: item.quantity } } });
      for (const component of item.product.comboItems) {
        await tx.product.updateMany({ where: { id: component.productId, trackStock: true }, data: { stockQuantity: { increment: component.quantity * item.quantity } } });
      }
      const chosen = ((item.options as unknown as SelectedOption[] | null) ?? []).map((option) => option.optionId);
      for (const option of item.product.optionGroups.flatMap((group) => group.options)) {
        if (option.trackStock && chosen.includes(option.id)) {
          await tx.productOption.update({ where: { id: option.id }, data: { stockQuantity: { increment: item.quantity } } });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Máquina de estados
  // ---------------------------------------------------------------------------

  /**
   * Transição com controle de concorrência otimista: só aplica se o status atual
   * ainda for o esperado (duas ações simultâneas não geram estados inválidos).
   */
  async transition(
    orderId: string,
    to: OrderStatus,
    actor: { type: ActorType; id?: string | null },
    options: { reason?: string; expectedFrom?: OrderStatus[] } = {},
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { customer: { select: { userId: true } } } });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    if (options.expectedFrom && !options.expectedFrom.includes(order.status)) {
      throw new ConflictException('O pedido mudou de status. Atualize a tela e tente novamente.');
    }
    if (!canTransitionOrder(order.status, to)) {
      throw new ConflictException(`Não é possível mudar o pedido de ${order.status} para ${to}.`);
    }

    const now = new Date();
    const timestamps: Partial<Record<OrderStatus, Prisma.OrderUpdateManyMutationInput>> = {
      CONFIRMED: { confirmedAt: now },
      PREPARING: { preparingAt: now },
      READY_FOR_PICKUP: { readyAt: now },
      PICKED_UP: { pickedUpAt: now },
      DELIVERED: { deliveredAt: now },
      CANCELED: { canceledAt: now, canceledBy: actor.type, cancelReason: options.reason ?? null },
    };

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({ where: { id: orderId, status: order.status }, data: { status: to, ...timestamps[to] } });
      if (updated.count === 0) throw new ConflictException('O pedido mudou de status. Atualize a tela e tente novamente.');
      await tx.orderStatusHistory.create({
        data: { orderId, fromStatus: order.status, toStatus: to, actorType: actor.type, actorId: actor.id ?? null, reason: options.reason },
      });
      if (to === 'CANCELED') await this.restoreStock(tx, orderId);
      if (to === 'NEW' && order.status === 'PENDING_PAYMENT') await tx.cart.deleteMany({ where: { customerId: order.customerId, companyId: order.companyId } });
      await this.audit.log(
        { action: `order.status.${to.toLowerCase()}`, entityType: 'Order', entityId: orderId, before: { status: order.status }, after: { status: to, reason: options.reason } },
        tx,
      );
    });

    if (to === 'NEW') await this.scheduleAcceptTimeout(order.tenantId, orderId);
    else await this.jobs.cancel(`order-accept:${orderId}`);
    this.events.emit(ORDER_STATUS_CHANGED, {
      ...this.eventBase(order, order.customer.userId),
      from: order.status,
      to,
      actorType: actor.type,
      reason: options.reason,
    } satisfies OrderStatusChangedEvent);
    return order;
  }

  private eventBase(order: { id: string; tenantId: string; companyId: string; number: number; fulfillment: 'DELIVERY' | 'PICKUP' }, customerUserId: string) {
    return { orderId: order.id, tenantId: order.tenantId, companyId: order.companyId, number: order.number, customerUserId, fulfillment: order.fulfillment };
  }

  private async scheduleAcceptTimeout(tenantId: string, orderId: string) {
    const minutes = await this.settings.get(tenantId, 'marketplace.acceptTimeoutMinutes');
    await this.jobs.enqueue('orders.acceptTimeout', { orderId }, { delayMs: minutes * 60_000, jobId: `order-accept:${orderId}` });
  }

  /** SLA de aceite: pedido não confirmado pela loja no prazo é cancelado automaticamente. */
  private async autoCancelIfNotAccepted(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
    if (order?.status !== 'NEW') return;
    await this.transition(orderId, 'CANCELED', { type: 'SYSTEM' }, { reason: 'A loja não confirmou o pedido a tempo.', expectedFrom: ['NEW'] }).catch(() => undefined);
  }

  // --- Ações do cliente ---

  async cancelByCustomer(user: AuthUser, orderId: string, reason: string) {
    const order = await this.findForCustomer(user, orderId);
    if (!ORDER_CUSTOMER_CANCELABLE.includes(order.status)) {
      throw new ConflictException('A loja já começou a preparar seu pedido. Fale com o suporte para cancelar.');
    }
    await this.transition(order.id, 'CANCELED', { type: 'CUSTOMER', id: user.userId }, { reason, expectedFrom: [...ORDER_CUSTOMER_CANCELABLE] });
    return this.getForCustomer(user, orderId);
  }

  // --- Ações da empresa ---

  async companyAction(user: AuthUser, companyId: string, orderId: string, action: 'confirm' | 'prepare' | 'ready' | 'cancel', reason?: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, companyId } });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    const map = { confirm: 'CONFIRMED', prepare: 'PREPARING', ready: 'READY_FOR_PICKUP', cancel: 'CANCELED' } as const;
    if (action === 'cancel') {
      if (!reason) throw new BadRequestException('Informe o motivo do cancelamento.');
      if (['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELED'].includes(order.status)) {
        throw new ConflictException('Pedidos já coletados não podem ser cancelados pela loja.');
      }
    }
    await this.transition(orderId, map[action], { type: 'COMPANY', id: user.userId }, { reason });
    return this.getForCompany(companyId, orderId);
  }

  /** Retirada no balcão: o cliente informa o código do pedido. */
  async handoffToCustomer(user: AuthUser, companyId: string, orderId: string, code: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, companyId } });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    if (order.fulfillment !== 'PICKUP') throw new BadRequestException('Este pedido é para entrega.');
    if (order.status !== 'READY_FOR_PICKUP') throw new ConflictException('O pedido ainda não está pronto.');
    if (!this.crypto.safeEqual(order.deliveryCode, code)) throw new BadRequestException('Código incorreto.');
    await this.transition(orderId, 'PICKED_UP', { type: 'COMPANY', id: user.userId });
    await this.transition(orderId, 'DELIVERED', { type: 'COMPANY', id: user.userId });
    return this.getForCompany(companyId, orderId);
  }

  // --- Plataforma ---

  async cancelByPlatform(user: AuthUser, orderId: string, reason: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId: user.tenantId } });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    await this.transition(orderId, 'CANCELED', { type: 'PLATFORM', id: user.userId }, { reason });
    return this.getForAdmin(user, orderId);
  }

  // ---------------------------------------------------------------------------
  // Consultas
  // ---------------------------------------------------------------------------

  private requireCustomer(user: AuthUser): string {
    if (!user.customerId) throw new ForbiddenException('Perfil de cliente não encontrado.');
    return user.customerId;
  }

  private statusFilter(query: OrdersQueryDto): Prisma.OrderWhereInput {
    const active = ORDER_ACTIVE_STATUSES as OrderStatus[];
    return {
      status: query.status ?? (query.scope === 'active' ? { in: [...active, 'PENDING_PAYMENT'] } : query.scope === 'finished' ? { in: ['DELIVERED', 'CANCELED'] } : undefined),
      createdAt: query.from || query.to ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined } : undefined,
    };
  }

  async listForCustomer(user: AuthUser, query: OrdersQueryDto) {
    const where: Prisma.OrderWhereInput = { customerId: this.requireCustomer(user), ...this.statusFilter(query) };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' }, skip: skipOf(query), take: query.pageSize }),
    ]);
    return paginated(rows.map((row) => this.customerView(row)), total, query);
  }

  private async findForCustomer(user: AuthUser, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, customerId: this.requireCustomer(user) }, include: orderInclude });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    return order;
  }

  async getForCustomer(user: AuthUser, orderId: string) {
    const [order, payment, reviews] = await Promise.all([
      this.findForCustomer(user, orderId),
      this.prisma.payment.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.review.count({ where: { orderId, authorUserId: user.userId } }),
    ]);
    return {
      ...this.customerView(order),
      reviewed: reviews > 0,
      payment: payment
        ? {
            id: payment.id,
            method: payment.method,
            status: payment.status,
            amountCents: payment.amountCents,
            refundedCents: payment.refundedCents,
            pixCopyPaste: payment.status === 'PENDING' ? payment.pixCopyPaste : null,
            pixExpiresAt: payment.status === 'PENDING' ? payment.pixExpiresAt : null,
            cardBrand: payment.cardBrand,
            cardLast4: payment.cardLast4,
            failureReason: payment.failureReason,
          }
        : null,
    };
  }

  async listForCompany(companyId: string, query: OrdersQueryDto) {
    const where: Prisma.OrderWhereInput = { companyId, ...this.statusFilter(query) };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({ where, include: orderInclude, orderBy: [{ scheduledFor: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }], skip: skipOf(query), take: query.pageSize }),
    ]);
    return paginated(rows.map((row) => this.companyView(row)), total, query);
  }

  async getForCompany(companyId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, companyId }, include: orderInclude });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    return this.companyView(order);
  }

  async prescriptionFile(companyId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, companyId }, include: { prescription: true } });
    if (!order?.prescription) throw new NotFoundException('Receita não encontrada.');
    await this.audit.log({ action: 'order.prescription.view', entityType: 'Order', entityId: orderId });
    return order.prescription;
  }

  async listForAdmin(user: AuthUser, query: AdminOrdersQueryDto) {
    const where: Prisma.OrderWhereInput = {
      tenantId: user.tenantId,
      companyId: query.companyId,
      customerId: query.customerId,
      ...this.statusFilter(query),
      ...(query.search && /^\d+$/.test(query.search) ? { number: Number(query.search) } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' }, skip: skipOf(query), take: query.pageSize }),
    ]);
    return paginated(rows.map((row) => this.adminView(row)), total, query);
  }

  async getForAdmin(user: AuthUser, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId: user.tenantId }, include: orderInclude });
    if (!order) throw new NotFoundException('Pedido não encontrado.');
    return this.adminView(order);
  }

  private baseView(order: OrderWithRelations) {
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      fulfillment: order.fulfillment,
      company: { id: order.company.id, tradeName: order.company.tradeName, slug: order.company.slug },
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.productName,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        totalCents: item.totalCents,
        options: item.options,
        notes: item.notes,
      })),
      subtotalCents: order.subtotalCents,
      deliveryFeeCents: order.deliveryFeeCents,
      serviceFeeCents: order.serviceFeeCents,
      tipCents: order.tipCents,
      discountCents: order.discountCents,
      totalCents: order.totalCents,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      changeForCents: order.changeForCents,
      notes: order.notes,
      deliveryAddress: order.deliveryAddress,
      scheduledFor: order.scheduledFor,
      estimatedReadyAt: order.estimatedReadyAt,
      estimatedDeliveryAt: order.estimatedDeliveryAt,
      distanceKm: order.distanceKm,
      requiresIdCheck: order.requiresIdCheck,
      hasPrescription: !!order.prescriptionId,
      cancelReason: order.cancelReason,
      canceledBy: order.canceledBy,
      timeline: order.statusHistory.map((entry) => ({ status: entry.toStatus, at: entry.createdAt, actorType: entry.actorType, reason: entry.reason })),
      delivery: order.delivery
        ? {
            id: order.delivery.id,
            code: order.delivery.code,
            status: order.delivery.status,
            driver: order.delivery.driver
              ? {
                  name: order.delivery.driver.user.name.split(' ')[0],
                  rating: order.delivery.driver.ratingAvg,
                  vehicle: order.delivery.driver.activeVehicle,
                  location:
                    ['DRIVER_ASSIGNED', 'AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'AT_DROPOFF'].includes(order.delivery.status) && order.delivery.driver.lastLat != null
                      ? { lat: order.delivery.driver.lastLat, lng: order.delivery.driver.lastLng, at: order.delivery.driver.lastLocationAt }
                      : null,
                }
              : null,
          }
        : null,
      createdAt: order.createdAt,
    };
  }

  private customerView(order: OrderWithRelations) {
    return {
      ...this.baseView(order),
      // O cliente vê o código de entrega; o entregador precisa recebê-lo dele na entrega.
      deliveryCode: ['DELIVERED', 'CANCELED'].includes(order.status) ? null : order.deliveryCode,
      canCancel: ORDER_CUSTOMER_CANCELABLE.includes(order.status),
    };
  }

  private companyView(order: OrderWithRelations) {
    const phone = order.customer.user.phone;
    return {
      ...this.baseView(order),
      // Minimização de dados: primeiro nome e telefone mascarado.
      customer: { firstName: order.customer.user.name.split(' ')[0], phoneMasked: phone ? `${phone.slice(0, 5)}*****${phone.slice(-4)}` : null },
    };
  }

  private adminView(order: OrderWithRelations) {
    return { ...this.baseView(order), customer: { id: order.customer.id, userId: order.customer.user.id, name: order.customer.user.name } };
  }
}
