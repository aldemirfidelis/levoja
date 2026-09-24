import { BadRequestException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService, diff } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AccessService } from '../access/access.service';
import { MapsService } from '../geo/maps.service';
import { PricingService } from '../pricing/pricing.service';
import { DeliveriesService, StopSnapshot } from '../logistics/deliveries.service';
import { formatLocalDate, parseLocalDate } from '../../common/time-range';
import type { AuthUser } from '../../common/auth/auth-user';
import { Prisma } from '../../generated/prisma/client';
import type { RecurringDelivery } from '../../generated/prisma/client';
import type { ItemCategory, PaymentMethod, ProofMethod } from '../../generated/prisma/enums';
import { ContractsService } from './contracts.service';

export interface RecurrenceInput {
  name: string;
  pickupLocationId?: string | null;
  dropoffLocationId?: string | null;
  dropoff?: { contactName?: string; contactPhone?: string; zipCode?: string; street: string; number: string; complement?: string; district?: string; city: string; state: string; reference?: string; lat?: number; lng?: number } | null;
  weekdays: number[];
  time: string;
  startsOn: string;
  endsOn?: string | null;
  itemCategory: ItemCategory;
  itemDescription?: string | null;
  weightKg?: number | null;
  notes?: string | null;
  proofMethod?: ProofMethod | null;
  paymentMethod: PaymentMethod;
  costCenterId?: string | null;
  isActive?: boolean;
}

const DAY_MS = 86_400_000;
/** As entregas agendadas exigem 30 minutos de antecedência; margem de segurança. */
const MIN_AHEAD_MS = 35 * 60_000;

/**
 * Entregas recorrentes (ex.: malote diário entre unidades, reposição semanal): a cada ciclo, as
 * ocorrências das próximas horas viram entregas agendadas — uma única vez por data.
 */
@Injectable()
export class RecurringService {
  private readonly logger = new Logger(RecurringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly access: AccessService,
    private readonly maps: MapsService,
    private readonly pricing: PricingService,
    private readonly deliveries: DeliveriesService,
    private readonly contracts: ContractsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Cadastro
  // ---------------------------------------------------------------------------

  private async normalize(companyId: string, input: Partial<RecurrenceInput>, current?: RecurringDelivery) {
    if (input.weekdays && (!input.weekdays.length || input.weekdays.some((day) => day < 0 || day > 6))) throw new BadRequestException('Escolha os dias da semana (0 = domingo a 6 = sábado).');
    if (input.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new BadRequestException('Horário no formato HH:mm.');
    if (input.paymentMethod && !['INVOICE', 'WALLET'].includes(input.paymentMethod)) throw new BadRequestException('Recorrências são pagas com faturamento (contrato) ou carteira.');
    const startsOn = input.startsOn ?? (current ? formatLocalDate(current.startsOn, 'UTC') : undefined);
    if (input.endsOn && startsOn && input.endsOn < startsOn) throw new BadRequestException('O fim deve ser depois do início.');
    for (const locationId of [input.pickupLocationId, input.dropoffLocationId]) {
      if (locationId) await this.contracts.locationStop(companyId, locationId);
    }
    if (input.costCenterId) {
      const center = await this.prisma.costCenter.findFirst({ where: { id: input.costCenterId, companyId, isActive: true } });
      if (!center) throw new BadRequestException('Centro de custo inválido ou inativo.');
    }
    let dropoff: StopSnapshot | null | undefined;
    if (input.dropoff) {
      const stop = input.dropoff;
      const point = stop.lat != null && stop.lng != null ? { lat: stop.lat, lng: stop.lng } : await this.maps.geocode({ street: stop.street, number: stop.number, district: stop.district, city: stop.city, state: stop.state, zipCode: stop.zipCode });
      if (!point) throw new UnprocessableEntityException('Não conseguimos localizar o destino no mapa. Informe latitude e longitude.');
      dropoff = {
        name: stop.contactName?.trim() || null,
        phone: stop.contactPhone?.replace(/\D/g, '') || null,
        zipCode: stop.zipCode?.replace(/\D/g, '') || null,
        street: stop.street.trim(),
        number: stop.number.trim(),
        complement: stop.complement?.trim() || null,
        district: stop.district?.trim() || null,
        city: stop.city.trim(),
        state: stop.state.trim().toUpperCase(),
        reference: stop.reference?.trim() || null,
        ...point,
      };
    }
    return { dropoff, startsOn };
  }

  list(companyId: string) {
    return this.prisma.recurringDelivery.findMany({
      where: { companyId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { runs: { orderBy: { scheduledFor: 'desc' }, take: 5 } },
    });
  }

  async create(user: AuthUser, companyId: string, input: RecurrenceInput) {
    if (!input.dropoffLocationId && !input.dropoff) throw new BadRequestException('Informe o destino (unidade cadastrada ou endereço).');
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { tenantId: true } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    const { dropoff } = await this.normalize(companyId, input);
    const recurrence = await this.prisma.recurringDelivery.create({
      data: {
        tenantId: company.tenantId,
        companyId,
        name: input.name.trim(),
        pickupLocationId: input.pickupLocationId ?? null,
        dropoffLocationId: input.dropoffLocationId ?? null,
        dropoff: input.dropoffLocationId ? Prisma.DbNull : (dropoff as unknown as Prisma.InputJsonValue),
        weekdays: [...new Set(input.weekdays)].sort(),
        time: input.time,
        startsOn: new Date(`${input.startsOn}T00:00:00Z`),
        endsOn: input.endsOn ? new Date(`${input.endsOn}T00:00:00Z`) : null,
        itemCategory: input.itemCategory,
        itemDescription: input.itemDescription?.trim() || null,
        weightKg: input.weightKg ?? null,
        notes: input.notes?.trim() || null,
        proofMethod: input.proofMethod ?? null,
        paymentMethod: input.paymentMethod,
        costCenterId: input.costCenterId ?? null,
        createdById: user.userId,
      },
    });
    await this.audit.log({ action: 'b2b.recurrence.create', entityType: 'RecurringDelivery', entityId: recurrence.id, after: { name: recurrence.name, weekdays: recurrence.weekdays, time: recurrence.time } });
    return recurrence;
  }

  async update(user: AuthUser, companyId: string, id: string, input: Partial<RecurrenceInput>) {
    const current = await this.prisma.recurringDelivery.findFirst({ where: { id, companyId } });
    if (!current) throw new NotFoundException('Recorrência não encontrada.');
    const { dropoff } = await this.normalize(companyId, input, current);
    const updated = await this.prisma.recurringDelivery.update({
      where: { id },
      data: {
        name: input.name?.trim(),
        pickupLocationId: input.pickupLocationId === undefined ? undefined : input.pickupLocationId,
        // Destino: unidade cadastrada ou endereço avulso (um substitui o outro).
        ...(dropoff
          ? { dropoff: dropoff as unknown as Prisma.InputJsonValue, dropoffLocationId: null }
          : input.dropoffLocationId
            ? { dropoff: Prisma.DbNull, dropoffLocationId: input.dropoffLocationId }
            : {}),
        weekdays: input.weekdays ? [...new Set(input.weekdays)].sort() : undefined,
        time: input.time,
        startsOn: input.startsOn ? new Date(`${input.startsOn}T00:00:00Z`) : undefined,
        endsOn: input.endsOn === undefined ? undefined : input.endsOn ? new Date(`${input.endsOn}T00:00:00Z`) : null,
        itemCategory: input.itemCategory,
        itemDescription: input.itemDescription === undefined ? undefined : input.itemDescription?.trim() || null,
        weightKg: input.weightKg === undefined ? undefined : input.weightKg,
        notes: input.notes === undefined ? undefined : input.notes?.trim() || null,
        proofMethod: input.proofMethod === undefined ? undefined : input.proofMethod,
        paymentMethod: input.paymentMethod,
        costCenterId: input.costCenterId === undefined ? undefined : input.costCenterId,
        isActive: input.isActive,
      },
    });
    await this.audit.log({ action: 'b2b.recurrence.update', entityType: 'RecurringDelivery', entityId: id, ...diff(current, updated) });
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Geração das ocorrências
  // ---------------------------------------------------------------------------

  /** Ocorrências (data local e horário) dentro da janela [de, até]. */
  occurrences(recurrence: Pick<RecurringDelivery, 'weekdays' | 'time' | 'startsOn' | 'endsOn'>, from: Date, to: Date, timeZone: string) {
    const result: { occursOn: string; scheduledFor: Date }[] = [];
    const starts = formatLocalDate(recurrence.startsOn, 'UTC');
    const ends = recurrence.endsOn ? formatLocalDate(recurrence.endsOn, 'UTC') : null;
    const [hours, minutes] = recurrence.time.split(':').map(Number);
    for (let cursor = from.getTime() - DAY_MS; cursor <= to.getTime() + DAY_MS; cursor += DAY_MS) {
      const date = formatLocalDate(new Date(cursor), timeZone);
      if (result.some((item) => item.occursOn === date)) continue;
      if (date < starts || (ends && date > ends)) continue;
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (!recurrence.weekdays.includes(weekday)) continue;
      const midnight = parseLocalDate(date, timeZone);
      const scheduledFor = new Date(midnight.getTime() + (hours * 60 + minutes) * 60_000);
      if (scheduledFor >= from && scheduledFor <= to) result.push({ occursOn: date, scheduledFor });
    }
    return result;
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async generateDue(now = new Date()): Promise<number> {
    const recurrences = await this.prisma.recurringDelivery.findMany({ where: { isActive: true } });
    let created = 0;
    for (const recurrence of recurrences) created += await this.generateFor(recurrence, now);
    return created;
  }

  /** Cria as entregas das ocorrências da janela (idempotente por data). */
  async generateFor(recurrence: RecurringDelivery, now = new Date()): Promise<number> {
    const [{ recurrenceHoursAhead }, { timeZone }] = await Promise.all([this.settings.get(recurrence.tenantId, 'b2b'), this.settings.get(recurrence.tenantId, 'operations')]);
    const window = this.occurrences(recurrence, new Date(now.getTime() + MIN_AHEAD_MS), new Date(now.getTime() + recurrenceHoursAhead * 3_600_000), timeZone);
    let created = 0;
    for (const occurrence of window) {
      const claimed = await this.prisma.recurringRun.createMany({ data: [{ recurrenceId: recurrence.id, occursOn: occurrence.occursOn, scheduledFor: occurrence.scheduledFor }], skipDuplicates: true });
      if (!claimed.count) continue;
      try {
        const delivery = await this.createDelivery(recurrence, occurrence.scheduledFor);
        await this.prisma.recurringRun.update({ where: { recurrenceId_occursOn: { recurrenceId: recurrence.id, occursOn: occurrence.occursOn } }, data: { deliveryId: delivery.id } });
        created += 1;
      } catch (error) {
        const message = (error as Error).message || 'Falha ao criar a entrega.';
        await this.prisma.recurringRun.update({ where: { recurrenceId_occursOn: { recurrenceId: recurrence.id, occursOn: occurrence.occursOn } }, data: { error: message } });
        await this.notifyFailure(recurrence, occurrence.occursOn, message);
      }
    }
    return created;
  }

  async runNow(user: AuthUser, companyId: string, id: string) {
    const recurrence = await this.prisma.recurringDelivery.findFirst({ where: { id, companyId } });
    if (!recurrence) throw new NotFoundException('Recorrência não encontrada.');
    const created = await this.generateFor(recurrence);
    return { created, runs: await this.prisma.recurringRun.findMany({ where: { recurrenceId: id }, orderBy: { scheduledFor: 'desc' }, take: 10 }) };
  }

  private async createDelivery(recurrence: RecurringDelivery, scheduledFor: Date) {
    // Age em nome de quem criou a recorrência — que precisa continuar com permissão na empresa.
    const profile = await this.access.getProfile(recurrence.createdById);
    const membership = profile?.status === 'ACTIVE' ? profile.companies.find((company) => company.companyId === recurrence.companyId) : undefined;
    if (!membership?.permissions.includes('company.deliveries.request')) {
      await this.prisma.recurringDelivery.update({ where: { id: recurrence.id }, data: { isActive: false } });
      throw new UnprocessableEntityException('Quem criou a recorrência não tem mais permissão para solicitar entregas. A recorrência foi pausada.');
    }
    const company = await this.prisma.company.findUnique({ where: { id: recurrence.companyId }, include: { address: true } });
    if (company?.status !== 'APPROVED') throw new UnprocessableEntityException('Empresa não aprovada.');
    const pickup = recurrence.pickupLocationId ? await this.contracts.locationStop(recurrence.companyId, recurrence.pickupLocationId) : this.companyStop(company);
    const dropoff = recurrence.dropoffLocationId ? await this.contracts.locationStop(recurrence.companyId, recurrence.dropoffLocationId) : (recurrence.dropoff as unknown as StopSnapshot);
    const vehicleType = this.deliveries.requiredVehicle(recurrence.weightKg ?? 0);
    const route = await this.maps.route(pickup, dropoff, vehicleType);
    const context = { distanceKm: route.distanceKm, durationMin: route.durationMin, weightKg: recurrence.weightKg ?? undefined, vehicleType, city: pickup.city, state: pickup.state, at: scheduledFor };
    const corporate = await this.contracts.price({ tenantId: recurrence.tenantId, companyId: recurrence.companyId, context });
    const fee = corporate?.fee ?? (await this.pricing.quote({ ...context, tenantId: recurrence.tenantId, target: 'CUSTOMER_FEE' }));
    const payout = await this.pricing.quote({ ...context, tenantId: recurrence.tenantId, target: 'DRIVER_PAYOUT' });
    const delivery = await this.prisma.$transaction(async (tx) => {
      const rules = await this.contracts.validate({ tenantId: recurrence.tenantId, companyId: recurrence.companyId, paymentMethod: recurrence.paymentMethod, amountCents: fee.totalCents, costCenterId: recurrence.costCenterId, tx });
      return this.deliveries.insertPrepared(tx, {
        tenantId: recurrence.tenantId,
        requesterUserId: recurrence.createdById,
        companyId: recurrence.companyId,
        pickup,
        dropoff,
        vehicleType,
        distanceKm: route.distanceKm,
        durationMin: route.durationMin,
        feeCents: fee.totalCents,
        payoutCents: payout.totalCents,
        scheduledFor,
        itemCategory: recurrence.itemCategory,
        itemDescription: recurrence.itemDescription,
        weightKg: recurrence.weightKg,
        notes: recurrence.notes,
        paymentMethod: recurrence.paymentMethod,
        proofMethod: recurrence.proofMethod,
        contractId: corporate?.contractId ?? rules.contractId,
        costCenterId: rules.costCenterId,
        externalRef: `REC-${recurrence.name}`.slice(0, 60),
        recurrenceId: recurrence.id,
        actorType: 'COMPANY',
      });
    });
    this.deliveries.emit(delivery, null, delivery.status, 'COMPANY');
    return delivery;
  }

  private companyStop(company: { tradeName: string; phone: string; address: { zipCode: string; street: string; number: string; complement: string | null; district: string; city: string; state: string; reference: string | null; lat: number | null; lng: number | null } | null }): StopSnapshot {
    const address = company.address;
    if (!address || address.lat == null || address.lng == null) throw new UnprocessableEntityException('A empresa não possui endereço com localização no mapa.');
    return { name: company.tradeName, phone: company.phone, zipCode: address.zipCode, street: address.street, number: address.number, complement: address.complement, district: address.district, city: address.city, state: address.state, reference: address.reference, lat: address.lat, lng: address.lng };
  }

  private async notifyFailure(recurrence: RecurringDelivery, occursOn: string, message: string) {
    this.logger.warn(`Recorrência ${recurrence.id} (${occursOn}) não gerou entrega: ${message}`);
    const members = await this.prisma.companyUser.findMany({
      where: { companyId: recurrence.companyId, isActive: true, role: { permissions: { some: { permission: { key: 'company.b2b.manage' } } } } },
      select: { userId: true },
    });
    await this.notifications.notifyMany([...new Set([recurrence.createdById, ...members.map((member) => member.userId)])], {
      type: 'b2b.recurrence.failed',
      title: `Entrega recorrente "${recurrence.name}" não foi criada`,
      body: `${occursOn.split('-').reverse().join('/')}: ${message}`,
      data: { recurrenceId: recurrence.id, companyId: recurrence.companyId },
      channels: ['inapp', 'email'],
    });
  }
}
