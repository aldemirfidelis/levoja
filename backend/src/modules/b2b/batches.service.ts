import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { formatBRL, parseDecimal, parseItemCategory, parseProofMethod, type BatchField } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { JobsService } from '../../infra/jobs/jobs.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MapsService } from '../geo/maps.service';
import { PricingService } from '../pricing/pricing.service';
import { DELIVERY_STATUS_CHANGED, DeliveriesService, DeliveryStatusChangedEvent, StopSnapshot } from '../logistics/deliveries.service';
import { lockKey, nextCounter } from '../../common/counters';
import { paginated, PaginationQueryDto, skipOf } from '../../common/pagination';
import type { AuthUser } from '../../common/auth/auth-user';
import { Prisma } from '../../generated/prisma/client';
import type { DeliveryBatch, DeliveryBatchItem } from '../../generated/prisma/client';
import type { BatchItemStatus, DeliveryStatus, ItemCategory, PaymentMethod, ProofMethod, VehicleType } from '../../generated/prisma/enums';
import { ContractsService } from './contracts.service';
import { parseBatchFile, type BatchRow } from './batch-file';
import { planRoutes } from './routing';

export interface BatchOptions {
  name?: string;
  locationId?: string;
  scheduledFor?: string;
  paymentMethod: PaymentMethod;
  costCenterId?: string;
  planRoutes?: boolean;
}

const JOB = 'b2b.batch.validate';
const FINAL: DeliveryStatus[] = ['DELIVERED', 'FAILED', 'CANCELED'];
const CANCELABLE: DeliveryStatus[] = ['PENDING', 'SCHEDULED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'AT_PICKUP'];

interface ResolvedItem {
  dropoff: StopSnapshot;
  itemCategory: ItemCategory;
  proofMethod: ProofMethod | null;
  weightKg: number;
  declaredValueCents: number | null;
  costCenterId: string | null;
}

/**
 * Entregas em lote (CSV, Excel ou API): validação de endereços e preços em segundo plano,
 * planejamento de rotas (várias paradas por entregador), criação das entregas e acompanhamento.
 */
@Injectable()
export class BatchesService implements OnModuleInit {
  private readonly logger = new Logger(BatchesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly maps: MapsService,
    private readonly pricing: PricingService,
    private readonly deliveries: DeliveriesService,
    private readonly contracts: ContractsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register<{ batchId: string }>(JOB, ({ batchId }) => this.validateBatch(batchId));
  }

  // ---------------------------------------------------------------------------
  // Criação
  // ---------------------------------------------------------------------------

  private async pickupStop(companyId: string, locationId?: string | null): Promise<StopSnapshot> {
    if (locationId) return this.contracts.locationStop(companyId, locationId);
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, include: { address: true } });
    const address = company?.address;
    if (!company || !address || address.lat == null || address.lng == null) throw new UnprocessableEntityException('Cadastre o endereço da empresa (com localização) ou escolha uma unidade de coleta.');
    return {
      name: company.tradeName,
      phone: company.phone,
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

  private async assertOptions(user: AuthUser, companyId: string, options: BatchOptions) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { status: true, tenantId: true } });
    if (!company || company.tenantId !== user.tenantId) throw new NotFoundException('Empresa não encontrada.');
    if (company.status !== 'APPROVED') throw new ForbiddenException('A empresa precisa estar aprovada para solicitar entregas.');
    if (!['INVOICE', 'WALLET'].includes(options.paymentMethod)) throw new BadRequestException('Lotes são pagos com faturamento (contrato) ou com o saldo da carteira.');
    if (options.paymentMethod === 'INVOICE' && !(await this.contracts.activeContract(companyId))) {
      throw new UnprocessableEntityException('Entregas faturadas exigem um contrato corporativo ativo.');
    }
    if (options.scheduledFor) {
      const { batchLeadMinutes } = await this.settings.get(user.tenantId, 'b2b');
      if (new Date(options.scheduledFor).getTime() < Date.now() + batchLeadMinutes * 60_000) {
        throw new BadRequestException(`Agende o lote com pelo menos ${batchLeadMinutes} minutos de antecedência.`);
      }
    }
    if (options.costCenterId) {
      const center = await this.prisma.costCenter.findFirst({ where: { id: options.costCenterId, companyId, isActive: true } });
      if (!center) throw new BadRequestException('Centro de custo inválido ou inativo.');
    }
  }

  async createFromFile(user: AuthUser, companyId: string, file: { buffer: Buffer; originalname: string; size: number }, options: BatchOptions) {
    const { maxBatchItems } = await this.settings.get(user.tenantId, 'b2b');
    await this.assertOptions(user, companyId, options);
    const parsed = await parseBatchFile(file, maxBatchItems);
    return this.create(user, companyId, parsed.source, file.originalname?.slice(0, 120) || null, parsed.rows, options, parsed.ignoredHeaders);
  }

  async createFromApi(user: AuthUser, companyId: string, items: BatchRow[], options: BatchOptions) {
    const { maxBatchItems } = await this.settings.get(user.tenantId, 'b2b');
    if (!items.length) throw new BadRequestException('Envie ao menos uma entrega.');
    if (items.length > maxBatchItems) throw new BadRequestException(`Máximo de ${maxBatchItems} entregas por lote.`);
    await this.assertOptions(user, companyId, options);
    return this.create(user, companyId, 'API', null, items.map((data, index) => ({ row: index + 1, data })), options, []);
  }

  private async create(user: AuthUser, companyId: string, source: 'CSV' | 'XLSX' | 'API', fileName: string | null, rows: { row: number; data: BatchRow }[], options: BatchOptions, ignoredHeaders: string[]) {
    const pickup = await this.pickupStop(companyId, options.locationId);
    const batch = await this.prisma.$transaction(
      async (tx) => {
        const created = await tx.deliveryBatch.create({
          data: {
            tenantId: user.tenantId,
            companyId,
            number: await nextCounter(tx, user.tenantId, 'batch'),
            name: options.name?.trim() || null,
            source,
            fileName,
            pickup: pickup as unknown as Prisma.InputJsonValue,
            pickupLat: pickup.lat,
            pickupLng: pickup.lng,
            locationId: options.locationId ?? null,
            scheduledFor: options.scheduledFor ? new Date(options.scheduledFor) : null,
            paymentMethod: options.paymentMethod,
            costCenterId: options.costCenterId ?? null,
            planRoutes: options.planRoutes ?? true,
            itemsCount: rows.length,
            createdById: user.userId,
          },
        });
        await tx.deliveryBatchItem.createMany({
          data: rows.map((row) => ({ batchId: created.id, row: row.row, externalRef: row.data.externalRef?.slice(0, 60) ?? null, data: row.data as Prisma.InputJsonValue, errors: [] })),
        });
        await this.audit.log({ action: 'b2b.batch.create', entityType: 'DeliveryBatch', entityId: created.id, after: { number: created.number, source, items: rows.length, paymentMethod: options.paymentMethod } }, tx);
        return created;
      },
      { timeout: 60_000 },
    );
    await this.jobs.enqueue(JOB, { batchId: batch.id }, { attempts: 1, jobId: `batch:${batch.id}` });
    return { ...(await this.view(batch)), ignoredHeaders };
  }

  // ---------------------------------------------------------------------------
  // Validação (segundo plano)
  // ---------------------------------------------------------------------------

  private resolveItem(data: BatchRow, costCenters: Map<string, string>, defaultCostCenter: string | null, errors: string[]): Omit<ResolvedItem, 'dropoff'> & { point: { lat: number; lng: number } | null } {
    const text = (field: BatchField) => data[field]?.trim() ?? '';
    for (const [field, label] of [
      ['recipientName', 'destinatário'],
      ['street', 'rua'],
      ['number', 'número'],
      ['city', 'cidade'],
      ['state', 'UF'],
    ] as const) {
      if (!text(field)) errors.push(`Informe ${label}.`);
    }
    if (text('state') && !/^[A-Za-z]{2}$/.test(text('state'))) errors.push('UF deve ter 2 letras (ex.: SP).');
    const phone = text('recipientPhone').replace(/\D/g, '');
    if (phone && (phone.length < 10 || phone.length > 13)) errors.push('Telefone inválido.');
    const zip = text('zipCode').replace(/\D/g, '');
    if (zip && zip.length !== 8) errors.push('CEP deve ter 8 dígitos.');

    const itemCategory = parseItemCategory(text('itemCategory')) ?? 'PACKAGE';
    if (text('itemCategory') && !parseItemCategory(text('itemCategory'))) errors.push(`Categoria desconhecida: ${text('itemCategory')}.`);
    const proofMethod = parseProofMethod(text('proofMethod'));
    if (text('proofMethod') && !proofMethod) errors.push(`Comprovação desconhecida: ${text('proofMethod')}.`);
    const weight = text('weightKg') ? parseDecimal(text('weightKg')) : 0;
    if (weight == null || weight < 0 || weight > 1000) errors.push('Peso inválido (0 a 1000 kg).');
    const declared = text('declaredValue') ? parseDecimal(text('declaredValue')) : null;
    if (text('declaredValue') && (declared == null || declared < 0)) errors.push('Valor declarado inválido.');

    let costCenterId = defaultCostCenter;
    if (text('costCenter')) {
      costCenterId = costCenters.get(text('costCenter').toUpperCase()) ?? null;
      if (!costCenterId) errors.push(`Centro de custo "${text('costCenter')}" não encontrado ou inativo.`);
    }

    let point: { lat: number; lng: number } | null = null;
    if (text('lat') || text('lng')) {
      const lat = parseDecimal(text('lat'));
      const lng = parseDecimal(text('lng'));
      if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) errors.push('Latitude/longitude inválidas.');
      else point = { lat, lng };
    }
    return {
      itemCategory,
      proofMethod,
      weightKg: weight ?? 0,
      declaredValueCents: declared == null ? null : Math.round(declared * 100),
      costCenterId,
      point,
    };
  }

  async validateBatch(batchId: string): Promise<void> {
    const batch = await this.prisma.deliveryBatch.findUnique({ where: { id: batchId } });
    if (!batch || batch.status !== 'VALIDATING') return;
    try {
      const pickup = batch.pickup as unknown as StopSnapshot;
      const centers = await this.prisma.costCenter.findMany({ where: { companyId: batch.companyId, isActive: true }, select: { id: true, code: true } });
      const centerByCode = new Map(centers.map((center) => [center.code.toUpperCase(), center.id]));
      const items = await this.prisma.deliveryBatchItem.findMany({ where: { batchId }, orderBy: { row: 'asc' } });
      const refs = new Map<string, number>();
      for (const item of items) if (item.externalRef) refs.set(item.externalRef, (refs.get(item.externalRef) ?? 0) + 1);
      const at = batch.scheduledFor ?? new Date();

      let valid = 0;
      let total = 0;
      for (const item of items) {
        const data = item.data as BatchRow;
        const errors: string[] = [];
        const resolved = this.resolveItem(data, centerByCode, batch.costCenterId, errors);
        if (item.externalRef && (refs.get(item.externalRef) ?? 0) > 1) errors.push(`Referência "${item.externalRef}" repetida no lote.`);
        let update: Prisma.DeliveryBatchItemUpdateInput = {};
        if (!errors.length) {
          const address = {
            street: data.street!.trim(),
            number: data.number!.trim(),
            district: data.district?.trim(),
            city: data.city!.trim(),
            state: data.state!.trim().toUpperCase(),
            zipCode: data.zipCode?.replace(/\D/g, '') || undefined,
          };
          const point = resolved.point ?? (await this.maps.geocode(address));
          if (!point) errors.push(this.maps.canGeocode ? 'Endereço não localizado no mapa. Confira ou informe latitude/longitude.' : 'Informe latitude e longitude (localização automática de endereços desativada).');
          else {
            const dropoff: StopSnapshot = {
              name: data.recipientName!.trim(),
              phone: data.recipientPhone?.replace(/\D/g, '') || null,
              zipCode: address.zipCode ?? null,
              street: address.street,
              number: address.number,
              complement: data.complement?.trim() || null,
              district: address.district || null,
              city: address.city,
              state: address.state,
              reference: data.reference?.trim() || null,
              lat: point.lat,
              lng: point.lng,
            };
            try {
              const vehicleType: VehicleType = this.deliveries.requiredVehicle(resolved.weightKg);
              const route = await this.maps.route(pickup, dropoff, vehicleType);
              const context = { distanceKm: route.distanceKm, durationMin: route.durationMin, weightKg: resolved.weightKg, vehicleType, city: pickup.city, state: pickup.state, at };
              const corporate = await this.contracts.price({ tenantId: batch.tenantId, companyId: batch.companyId, context });
              const fee = corporate?.fee ?? (await this.pricing.quote({ ...context, tenantId: batch.tenantId, target: 'CUSTOMER_FEE' }));
              const payout = await this.pricing.quote({ ...context, tenantId: batch.tenantId, target: 'DRIVER_PAYOUT' });
              update = {
                dropoff: dropoff as unknown as Prisma.InputJsonValue,
                vehicleType,
                distanceKm: route.distanceKm,
                durationMin: route.durationMin,
                feeCents: fee.totalCents,
                payoutCents: payout.totalCents,
                costCenterId: resolved.costCenterId,
              };
              total += fee.totalCents;
            } catch (error) {
              errors.push((error as Error).message || 'Não foi possível cotar esta entrega.');
            }
          }
        }
        const status: BatchItemStatus = errors.length ? 'INVALID' : 'VALID';
        if (status === 'VALID') valid += 1;
        await this.prisma.deliveryBatchItem.update({ where: { id: item.id }, data: { ...update, status, errors } });
      }
      const updated = await this.prisma.deliveryBatch.update({
        where: { id: batchId },
        data: { status: 'READY', validCount: valid, invalidCount: items.length - valid, totalFeeCents: total },
      });
      await this.notifications.notify({
        userId: batch.createdById,
        type: 'b2b.batch.ready',
        title: `Lote #${updated.number} validado`,
        body: `${valid} entrega(s) prontas (${formatBRL(total)})${items.length - valid ? `, ${items.length - valid} com erro` : ''}. Revise e confirme no portal.`,
        data: { batchId, companyId: batch.companyId },
        channels: ['inapp'],
      });
    } catch (error) {
      this.logger.error(`Validação do lote ${batchId} falhou: ${(error as Error).message}`);
      await this.prisma.deliveryBatch.update({ where: { id: batchId }, data: { status: 'FAILED', error: 'Falha ao validar o lote. Tente enviar novamente.' } });
    }
  }

  // ---------------------------------------------------------------------------
  // Confirmação: rotas + entregas
  // ---------------------------------------------------------------------------

  private async find(companyId: string, batchId: string) {
    const batch = await this.prisma.deliveryBatch.findFirst({ where: { id: batchId, companyId } });
    if (!batch) throw new NotFoundException('Lote não encontrado.');
    return batch;
  }

  /** Planejamento das rotas das entregas válidas (usado na prévia e na confirmação). */
  private async plan(batch: DeliveryBatch, items: DeliveryBatchItem[]) {
    const config = await this.settings.get(batch.tenantId, 'b2b');
    const stops = items.map((item) => {
      const dropoff = item.dropoff as unknown as StopSnapshot;
      return { id: item.id, lat: dropoff.lat, lng: dropoff.lng, weightKg: parseDecimal((item.data as BatchRow).weightKg) ?? 0, vehicleType: item.vehicleType! };
    });
    if (!batch.planRoutes || stops.length < 2) return stops.map((stop) => ({ vehicleType: stop.vehicleType, stopIds: [stop.id], distanceKm: 0, durationMin: 0, weightKg: stop.weightKg, single: true }));
    return planRoutes({ lat: batch.pickupLat, lng: batch.pickupLng }, stops, { maxStops: config.maxStopsPerRoute, maxLegKm: config.routeMaxLegKm, serviceMinutes: config.serviceMinutesPerStop }).map((route) => ({
      ...route,
      single: route.stopIds.length === 1,
    }));
  }

  async confirm(user: AuthUser, companyId: string, batchId: string, scheduledFor?: string | null) {
    const batch = await this.find(companyId, batchId);
    if (batch.status !== 'READY') throw new ConflictException(batch.status === 'VALIDATING' ? 'O lote ainda está sendo validado.' : 'Este lote não pode mais ser confirmado.');
    if (!batch.validCount) throw new UnprocessableEntityException('Nenhuma entrega válida no lote.');
    const when = scheduledFor === undefined ? batch.scheduledFor : scheduledFor ? new Date(scheduledFor) : null;
    const { batchLeadMinutes } = await this.settings.get(batch.tenantId, 'b2b');
    if (when && when.getTime() < Date.now() + batchLeadMinutes * 60_000) throw new BadRequestException(`O horário agendado precisa ter pelo menos ${batchLeadMinutes} minutos de antecedência. Escolha um novo horário ou envie agora.`);

    const items = await this.prisma.deliveryBatchItem.findMany({ where: { batchId, status: 'VALID' }, orderBy: { row: 'asc' } });
    const routes = await this.plan(batch, items);
    const itemById = new Map(items.map((item) => [item.id, item]));
    const total = items.reduce((sum, item) => sum + (item.feeCents ?? 0), 0);
    const byCenter = new Map<string, number>();
    for (const item of items) if (item.costCenterId) byCenter.set(item.costCenterId, (byCenter.get(item.costCenterId) ?? 0) + (item.feeCents ?? 0));

    const created = await this.prisma.$transaction(
      async (tx) => {
        await lockKey(tx, `b2b:${companyId}`);
        const claimed = await tx.deliveryBatch.updateMany({ where: { id: batchId, status: 'READY' }, data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: user.userId, scheduledFor: when } });
        if (!claimed.count) throw new ConflictException('Este lote já foi confirmado ou cancelado.');
        const contract = batch.paymentMethod === 'INVOICE' ? await this.contracts.assertInvoiceAllowed(companyId, total, tx) : await this.contracts.activeContract(companyId, new Date(), tx);
        if (contract?.requireCostCenter && items.some((item) => !item.costCenterId)) throw new BadRequestException('O contrato exige centro de custo em todas as entregas do lote.');
        for (const [centerId, amount] of byCenter) await this.contracts.assertCostCenter(batch.tenantId, companyId, centerId, amount, tx);

        const deliveries = [];
        let sequence = 0;
        for (const plan of routes) {
          const members = plan.stopIds.map((id) => itemById.get(id)!);
          const route = plan.single
            ? null
            : await tx.deliveryRoute.create({
                data: {
                  tenantId: batch.tenantId,
                  companyId,
                  batchId,
                  sequence: ++sequence,
                  vehicleType: plan.vehicleType,
                  stopsCount: members.length,
                  distanceKm: plan.distanceKm,
                  durationMin: plan.durationMin,
                  feeCents: members.reduce((sum, item) => sum + (item.feeCents ?? 0), 0),
                  payoutCents: members.reduce((sum, item) => sum + (item.payoutCents ?? 0), 0),
                },
              });
          for (const [index, item] of members.entries()) {
            const data = item.data as BatchRow;
            const delivery = await this.deliveries.insertPrepared(tx, {
              tenantId: batch.tenantId,
              requesterUserId: user.userId,
              companyId,
              pickup: batch.pickup as unknown as StopSnapshot,
              dropoff: item.dropoff as unknown as StopSnapshot,
              vehicleType: route ? plan.vehicleType : item.vehicleType!,
              distanceKm: item.distanceKm!,
              durationMin: item.durationMin!,
              feeCents: item.feeCents!,
              payoutCents: item.payoutCents!,
              scheduledFor: when,
              itemCategory: parseItemCategory(data.itemCategory) ?? 'PACKAGE',
              itemDescription: data.itemDescription?.slice(0, 300) ?? null,
              weightKg: parseDecimal(data.weightKg),
              declaredValueCents: data.declaredValue ? Math.round((parseDecimal(data.declaredValue) ?? 0) * 100) : null,
              notes: data.notes?.slice(0, 500) ?? null,
              paymentMethod: batch.paymentMethod,
              proofMethod: parseProofMethod(data.proofMethod),
              contractId: contract?.id ?? null,
              costCenterId: item.costCenterId,
              externalRef: item.externalRef,
              batchId,
              routeId: route?.id ?? null,
              routeSequence: route ? index + 1 : null,
              actorType: 'COMPANY',
            });
            await tx.deliveryBatchItem.update({ where: { id: item.id }, data: { status: 'CREATED', deliveryId: delivery.id } });
            deliveries.push(delivery);
          }
        }
        await tx.deliveryBatch.update({ where: { id: batchId }, data: { routesCount: sequence } });
        await this.audit.log({ action: 'b2b.batch.confirm', entityType: 'DeliveryBatch', entityId: batchId, after: { deliveries: deliveries.length, routes: sequence, totalCents: total, scheduledFor: when } }, tx);
        return deliveries;
      },
      { timeout: 180_000, maxWait: 15_000 },
    );
    // Eventos depois da transação: despacho (rotas começam pelo líder) ou agendamento.
    for (const delivery of created) this.deliveries.emit(delivery, null, delivery.status, 'COMPANY');
    return this.get(companyId, batchId);
  }

  // ---------------------------------------------------------------------------
  // Cancelamento
  // ---------------------------------------------------------------------------

  async cancel(user: AuthUser, companyId: string, batchId: string, reason: string) {
    const batch = await this.find(companyId, batchId);
    if (batch.status === 'CANCELED') return this.get(companyId, batchId);
    if (batch.status !== 'CONFIRMED') {
      const updated = await this.prisma.deliveryBatch.updateMany({ where: { id: batchId, status: { in: ['VALIDATING', 'READY', 'FAILED'] } }, data: { status: 'CANCELED', canceledAt: new Date() } });
      if (!updated.count) throw new ConflictException('O lote mudou de situação. Atualize e tente novamente.');
      await this.audit.log({ action: 'b2b.batch.cancel', entityType: 'DeliveryBatch', entityId: batchId, after: { reason } });
      return this.get(companyId, batchId);
    }
    const open = await this.prisma.delivery.findMany({ where: { batchId, status: { in: CANCELABLE } }, select: { id: true } });
    let canceled = 0;
    for (const delivery of open) {
      try {
        await this.deliveries.transition(delivery.id, 'CANCELED', { type: 'COMPANY', id: user.userId }, { reason: `Lote cancelado: ${reason}` });
        canceled += 1;
      } catch {
        // Entrega avançou (ex.: coletada) durante o cancelamento: segue normalmente.
      }
    }
    await this.prisma.deliveryRoute.updateMany({ where: { batchId, status: { in: ['PLANNED', 'DISPATCHING'] } }, data: { status: 'CANCELED' } });
    await this.prisma.deliveryBatch.update({ where: { id: batchId }, data: { canceledAt: new Date() } });
    await this.audit.log({ action: 'b2b.batch.cancel', entityType: 'DeliveryBatch', entityId: batchId, after: { reason, canceled } });
    return { ...(await this.get(companyId, batchId)), canceledNow: canceled };
  }

  // ---------------------------------------------------------------------------
  // Consulta
  // ---------------------------------------------------------------------------

  async list(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.DeliveryBatchWhereInput = { companyId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.deliveryBatch.count({ where }),
      this.prisma.deliveryBatch.findMany({ where, orderBy: { createdAt: 'desc' }, skip: skipOf(query), take: query.pageSize }),
    ]);
    return paginated(await Promise.all(rows.map((row) => this.view(row))), total, query);
  }

  private async view(batch: DeliveryBatch) {
    const progress = batch.status === 'CONFIRMED' ? await this.prisma.delivery.groupBy({ by: ['status'], where: { batchId: batch.id }, _count: { _all: true } }) : [];
    const byStatus = Object.fromEntries(progress.map((row) => [row.status, row._count._all])) as Partial<Record<DeliveryStatus, number>>;
    const finished = FINAL.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0);
    return {
      id: batch.id,
      number: batch.number,
      name: batch.name,
      source: batch.source,
      fileName: batch.fileName,
      status: batch.status,
      pickup: batch.pickup as unknown as StopSnapshot,
      scheduledFor: batch.scheduledFor,
      paymentMethod: batch.paymentMethod,
      costCenterId: batch.costCenterId,
      planRoutes: batch.planRoutes,
      itemsCount: batch.itemsCount,
      validCount: batch.validCount,
      invalidCount: batch.invalidCount,
      totalFeeCents: batch.totalFeeCents,
      routesCount: batch.routesCount,
      error: batch.error,
      createdAt: batch.createdAt,
      confirmedAt: batch.confirmedAt,
      canceledAt: batch.canceledAt,
      completedAt: batch.completedAt,
      progress: batch.status === 'CONFIRMED' ? { byStatus, finished, delivered: byStatus.DELIVERED ?? 0, total: batch.validCount } : null,
    };
  }

  async get(companyId: string, batchId: string) {
    const batch = await this.find(companyId, batchId);
    const base = await this.view(batch);
    if (batch.status === 'READY') {
      const items = await this.prisma.deliveryBatchItem.findMany({ where: { batchId, status: 'VALID' } });
      const preview = await this.plan(batch, items);
      return { ...base, routes: preview.filter((route) => !route.single).map((route, index) => ({ sequence: index + 1, status: 'PLANNED', vehicleType: route.vehicleType, stopsCount: route.stopIds.length, distanceKm: route.distanceKm, durationMin: route.durationMin, driver: null })), individual: preview.filter((route) => route.single).length };
    }
    const routes = await this.prisma.deliveryRoute.findMany({ where: { batchId }, orderBy: { sequence: 'asc' } });
    const drivers = await this.prisma.driver.findMany({ where: { id: { in: routes.map((route) => route.driverId).filter((id): id is string => !!id) } }, select: { id: true, user: { select: { name: true } } } });
    const nameOf = new Map(drivers.map((driver) => [driver.id, driver.user.name.split(' ')[0]]));
    return {
      ...base,
      routes: routes.map((route) => ({
        id: route.id,
        sequence: route.sequence,
        status: route.status,
        vehicleType: route.vehicleType,
        stopsCount: route.stopsCount,
        distanceKm: route.distanceKm,
        durationMin: route.durationMin,
        feeCents: route.feeCents,
        driver: route.driverId ? (nameOf.get(route.driverId) ?? 'Entregador') : null,
      })),
      individual: batch.validCount - routes.reduce((sum, route) => sum + route.stopsCount, 0),
    };
  }

  async items(companyId: string, batchId: string, query: PaginationQueryDto & { status?: BatchItemStatus }) {
    await this.find(companyId, batchId);
    const where: Prisma.DeliveryBatchItemWhereInput = { batchId, status: query.status };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.deliveryBatchItem.count({ where }),
      this.prisma.deliveryBatchItem.findMany({ where, orderBy: { row: 'asc' }, skip: skipOf(query), take: query.pageSize }),
    ]);
    const deliveries = await this.prisma.delivery.findMany({
      where: { id: { in: rows.map((row) => row.deliveryId).filter((id): id is string => !!id) } },
      select: { id: true, code: true, status: true, routeId: true, routeSequence: true, deliveredAt: true, failReason: true, cancelReason: true },
    });
    const deliveryOf = new Map(deliveries.map((delivery) => [delivery.id, delivery]));
    return paginated(
      rows.map((row) => {
        const data = row.data as BatchRow;
        const dropoff = row.dropoff as unknown as StopSnapshot | null;
        return {
          id: row.id,
          row: row.row,
          externalRef: row.externalRef,
          status: row.status,
          errors: row.errors,
          recipient: data.recipientName ?? null,
          address: dropoff ? `${dropoff.street}, ${dropoff.number} — ${dropoff.city}/${dropoff.state}` : [data.street, data.number, data.city, data.state].filter(Boolean).join(', '),
          feeCents: row.feeCents,
          distanceKm: row.distanceKm,
          vehicleType: row.vehicleType,
          delivery: row.deliveryId ? (deliveryOf.get(row.deliveryId) ?? null) : null,
        };
      }),
      total,
      query,
    );
  }

  /** Resultado do lote para planilha: referência, código da entrega, situação e link de rastreio. */
  async exportCsv(companyId: string, batchId: string, trackingBaseUrl: string): Promise<{ fileName: string; content: string }> {
    const batch = await this.find(companyId, batchId);
    const items = await this.prisma.deliveryBatchItem.findMany({ where: { batchId }, orderBy: { row: 'asc' } });
    const deliveries = await this.prisma.delivery.findMany({ where: { batchId }, select: { id: true, code: true, status: true, deliveredAt: true, feeCents: true, tipCents: true } });
    const byId = new Map(deliveries.map((delivery) => [delivery.id, delivery]));
    const escape = (value: string) => {
      const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
      return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = [['linha', 'referencia', 'destinatario', 'situacao', 'erros', 'codigo', 'status_entrega', 'entregue_em', 'valor', 'rastreio'].join(';')];
    for (const item of items) {
      const delivery = item.deliveryId ? byId.get(item.deliveryId) : undefined;
      lines.push(
        [
          String(item.row),
          item.externalRef ?? '',
          (item.data as BatchRow).recipientName ?? '',
          item.status,
          item.errors.join(' | '),
          delivery?.code ?? '',
          delivery?.status ?? '',
          delivery?.deliveredAt?.toISOString() ?? '',
          delivery ? ((delivery.feeCents + delivery.tipCents) / 100).toFixed(2).replace('.', ',') : item.feeCents != null ? (item.feeCents / 100).toFixed(2).replace('.', ',') : '',
          delivery ? `${trackingBaseUrl.replace(/\/$/, '')}/rastreio/${delivery.code}` : '',
        ]
          .map(escape)
          .join(';'),
      );
    }
    return { fileName: `lote-${batch.number}.csv`, content: `﻿${lines.join('\r\n')}\r\n` };
  }

  // ---------------------------------------------------------------------------
  // Andamento: conclusão de rotas e do lote
  // ---------------------------------------------------------------------------

  @OnEvent(DELIVERY_STATUS_CHANGED, { async: true, promisify: true })
  async onDeliveryChanged(event: DeliveryStatusChangedEvent) {
    if (!event.batchId || !FINAL.includes(event.to)) return;
    try {
      const delivery = await this.prisma.delivery.findUnique({ where: { id: event.deliveryId }, select: { routeId: true } });
      if (delivery?.routeId) {
        const open = await this.prisma.delivery.count({ where: { routeId: delivery.routeId, status: { notIn: FINAL } } });
        if (!open) await this.prisma.deliveryRoute.updateMany({ where: { id: delivery.routeId, status: { in: ['ASSIGNED', 'DISPATCHING', 'SPLIT', 'PLANNED'] } }, data: { status: 'COMPLETED', completedAt: new Date() } });
      }
      const open = await this.prisma.delivery.count({ where: { batchId: event.batchId, status: { notIn: FINAL } } });
      if (open) return;
      const completed = await this.prisma.deliveryBatch.updateMany({ where: { id: event.batchId, completedAt: null, status: 'CONFIRMED' }, data: { completedAt: new Date() } });
      if (!completed.count) return;
      const batch = await this.prisma.deliveryBatch.findUniqueOrThrow({ where: { id: event.batchId } });
      const summary = await this.prisma.delivery.groupBy({ by: ['status'], where: { batchId: event.batchId }, _count: { _all: true } });
      const count = (status: DeliveryStatus) => summary.find((row) => row.status === status)?._count._all ?? 0;
      await this.notifications.notify({
        userId: batch.createdById,
        type: 'b2b.batch.completed',
        title: `Lote #${batch.number} concluído`,
        body: `${count('DELIVERED')} entregue(s), ${count('FAILED')} não realizada(s), ${count('CANCELED')} cancelada(s).`,
        data: { batchId: batch.id, companyId: batch.companyId },
        channels: ['inapp', 'email'],
      });
    } catch (error) {
      this.logger.error(`Falha ao atualizar o lote ${event.batchId}: ${(error as Error).message}`);
    }
  }
}
