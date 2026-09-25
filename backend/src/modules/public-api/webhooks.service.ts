import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { randomBytes, randomUUID } from 'node:crypto';
import { WEBHOOK_EVENTS, type WebhookEvent } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { JobsService } from '../../infra/jobs/jobs.service';
import { AppConfig } from '../../config/config.module';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionsService, SUBSCRIPTION_INVOICE_CREATED, SubscriptionInvoiceCreatedEvent } from '../saas/subscriptions.service';
import { ORDER_CREATED, ORDER_STATUS_CHANGED, OrderStatusChangedEvent } from '../orders/orders.service';
import { DELIVERY_STATUS_CHANGED, DeliveryStatusChangedEvent } from '../logistics/deliveries.service';
import { B2B_INVOICE_ISSUED, B2bInvoiceIssuedEvent } from '../b2b/invoices.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { Prisma } from '../../generated/prisma/client';
import { assertSafeWebhookUrl, signPayload, UnsafeUrlError } from './webhook-security';

export interface EndpointInput {
  url: string;
  events: WebhookEvent[];
  description?: string | null;
}

/** Intervalos entre tentativas (min): 1, 5, 30, 120, 360, 720 — até 7 tentativas no total. */
const RETRY_MINUTES = [1, 5, 30, 120, 360, 720];
const DISABLE_AFTER_FAILURES = 20;
const TIMEOUT_MS = 10_000;

/**
 * Webhooks da API pública: a empresa cadastra endpoints e escolhe os eventos. Cada evento vira
 * uma entrega assinada (HMAC), com novas tentativas e histórico. Endpoints que falham seguidamente
 * são desativados e a empresa é avisada. Exige o recurso `integrations` do plano.
 */
@Injectable()
export class WebhooksService implements OnModuleInit {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jobs: JobsService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register<{ deliveryId: string }>('webhooks.deliver', async ({ deliveryId }) => {
      await this.deliver(deliveryId);
    });
  }

  private get allowPrivate() {
    return this.config.env.WEBHOOK_ALLOW_PRIVATE_URLS;
  }

  private async validateUrl(url: string) {
    try {
      await assertSafeWebhookUrl(url, this.allowPrivate);
    } catch (error) {
      if (error instanceof UnsafeUrlError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  private newSecret() {
    return `whsec_${randomBytes(24).toString('base64url')}`;
  }

  private view(endpoint: Prisma.WebhookEndpointGetPayload<object>) {
    const { secretEncrypted: _secret, ...rest } = endpoint;
    return rest;
  }

  // ---------------------------------------------------------------------------
  // Cadastro
  // ---------------------------------------------------------------------------

  async list(companyId: string) {
    const endpoints = await this.prisma.webhookEndpoint.findMany({ where: { companyId }, orderBy: { createdAt: 'asc' } });
    return endpoints.map((endpoint) => this.view(endpoint));
  }

  private async find(companyId: string, id: string) {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({ where: { id, companyId } });
    if (!endpoint) throw new NotFoundException('Endpoint não encontrado.');
    return endpoint;
  }

  async create(user: AuthUser, companyId: string, input: EndpointInput) {
    if (user.apiKeyId) throw new ConflictException('Endpoints de webhook são cadastrados pelo portal.');
    await this.validateUrl(input.url);
    const count = await this.prisma.webhookEndpoint.count({ where: { companyId } });
    if (count >= 10) throw new ConflictException('Limite de 10 endpoints por empresa.');
    const secret = this.newSecret();
    const endpoint = await this.prisma.webhookEndpoint.create({
      data: {
        tenantId: user.tenantId,
        companyId,
        url: input.url,
        description: input.description?.trim() || null,
        events: [...new Set(input.events)],
        secretEncrypted: this.crypto.encrypt(secret),
        createdById: user.userId,
      },
    });
    await this.audit.log({ action: 'webhook.create', entityType: 'WebhookEndpoint', entityId: endpoint.id, after: { url: endpoint.url, events: endpoint.events } });
    return { ...this.view(endpoint), secret };
  }

  async update(companyId: string, id: string, input: Partial<EndpointInput> & { isActive?: boolean }) {
    const endpoint = await this.find(companyId, id);
    if (input.url) await this.validateUrl(input.url);
    const reactivate = input.isActive === true && !endpoint.isActive;
    const updated = await this.prisma.webhookEndpoint.update({
      where: { id },
      data: {
        url: input.url,
        description: input.description === undefined ? undefined : input.description?.trim() || null,
        events: input.events ? [...new Set(input.events)] : undefined,
        isActive: input.isActive,
        ...(reactivate ? { consecutiveFailures: 0, disabledAt: null, disabledReason: null } : {}),
      },
    });
    await this.audit.log({ action: 'webhook.update', entityType: 'WebhookEndpoint', entityId: id, after: { url: updated.url, events: updated.events, isActive: updated.isActive } });
    return this.view(updated);
  }

  async rotateSecret(companyId: string, id: string) {
    await this.find(companyId, id);
    const secret = this.newSecret();
    const updated = await this.prisma.webhookEndpoint.update({ where: { id }, data: { secretEncrypted: this.crypto.encrypt(secret) } });
    await this.audit.log({ action: 'webhook.rotate_secret', entityType: 'WebhookEndpoint', entityId: id });
    return { ...this.view(updated), secret };
  }

  async remove(companyId: string, id: string) {
    await this.find(companyId, id);
    await this.prisma.webhookEndpoint.delete({ where: { id } });
    await this.audit.log({ action: 'webhook.delete', entityType: 'WebhookEndpoint', entityId: id });
  }

  async deliveries(companyId: string, id: string) {
    await this.find(companyId, id);
    return this.prisma.webhookDelivery.findMany({ where: { endpointId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  /** Evento de teste enviado na hora (resultado devolvido para a tela). */
  async test(companyId: string, id: string) {
    const endpoint = await this.find(companyId, id);
    const delivery = await this.prisma.webhookDelivery.create({
      data: { endpointId: endpoint.id, event: 'ping', eventId: randomUUID(), payload: { message: 'Teste de webhook', companyId } },
    });
    await this.deliver(delivery.id, { force: true, noRetry: true });
    return this.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  }

  async retry(companyId: string, deliveryId: string) {
    const delivery = await this.prisma.webhookDelivery.findFirst({ where: { id: deliveryId, endpoint: { companyId } } });
    if (!delivery) throw new NotFoundException('Entrega de webhook não encontrada.');
    await this.prisma.webhookDelivery.update({ where: { id: deliveryId }, data: { status: 'PENDING', nextAttemptAt: new Date() } });
    await this.deliver(deliveryId, { force: true });
    return this.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  }

  // ---------------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------------

  /** Enfileira o evento para os endpoints ativos da empresa inscritos nele. */
  async publish(tenantId: string, companyId: string | null | undefined, event: WebhookEvent, data: Record<string, unknown>) {
    if (!companyId) return 0;
    const endpoints = await this.prisma.webhookEndpoint.findMany({ where: { companyId, isActive: true, events: { has: event } }, select: { id: true } });
    if (!endpoints.length) return 0;
    if (!(await this.subscriptions.hasFeature(tenantId, companyId, 'integrations'))) return 0;
    const eventId = randomUUID();
    for (const endpoint of endpoints) {
      const delivery = await this.prisma.webhookDelivery.create({
        data: { endpointId: endpoint.id, event, eventId, payload: data as Prisma.InputJsonValue, nextAttemptAt: new Date() },
      });
      await this.jobs.enqueue('webhooks.deliver', { deliveryId: delivery.id }, { jobId: `webhook:${delivery.id}:1`, attempts: 1 });
    }
    return endpoints.length;
  }

  @OnEvent(ORDER_CREATED, { async: true })
  async onOrderCreated(event: OrderStatusChangedEvent) {
    await this.safe(async () => {
      const order = await this.prisma.order.findUnique({
        where: { id: event.orderId },
        select: { id: true, number: true, status: true, fulfillment: true, totalCents: true, subtotalCents: true, deliveryFeeCents: true, paymentMethod: true, scheduledFor: true, createdAt: true, items: { select: { productId: true, productName: true, sku: true, quantity: true, unitPriceCents: true, totalCents: true } } },
      });
      if (order) await this.publish(event.tenantId, event.companyId, 'order.created', { order });
    });
  }

  @OnEvent(ORDER_STATUS_CHANGED, { async: true })
  async onOrderStatus(event: OrderStatusChangedEvent) {
    await this.safe(() => this.publish(event.tenantId, event.companyId, 'order.status_changed', { orderId: event.orderId, number: event.number, from: event.from, to: event.to, reason: event.reason ?? null }));
  }

  @OnEvent(DELIVERY_STATUS_CHANGED, { async: true })
  async onDeliveryStatus(event: DeliveryStatusChangedEvent) {
    await this.safe(async () => {
      const payload = { deliveryId: event.deliveryId, code: event.code, orderId: event.orderId, batchId: event.batchId ?? null, from: event.from, to: event.to, reason: event.reason ?? null };
      if (event.from === null) await this.publish(event.tenantId, event.companyId, 'delivery.created', payload);
      else await this.publish(event.tenantId, event.companyId, 'delivery.status_changed', payload);
    });
  }

  @OnEvent(B2B_INVOICE_ISSUED, { async: true })
  async onInvoice(event: B2bInvoiceIssuedEvent) {
    await this.safe(() => this.publish(event.tenantId, event.companyId, 'invoice.issued', { invoiceId: event.invoiceId, number: event.number, totalCents: event.totalCents, dueAt: event.dueAt }));
  }

  @OnEvent(SUBSCRIPTION_INVOICE_CREATED, { async: true })
  async onSubscriptionInvoice(event: SubscriptionInvoiceCreatedEvent) {
    await this.safe(() => this.publish(event.tenantId, event.companyId, 'subscription.invoice_created', { invoiceId: event.invoiceId, number: event.number, amountCents: event.amountCents, description: event.description }));
  }

  private async safe(work: () => Promise<unknown>) {
    try {
      await work();
    } catch (error) {
      this.logger.error(`Evento de webhook não publicado: ${(error as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Envio
  // ---------------------------------------------------------------------------

  async deliver(deliveryId: string, options: { force?: boolean; noRetry?: boolean } = {}) {
    const delivery = await this.prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { endpoint: true } });
    if (!delivery || delivery.status === 'SUCCEEDED') return;
    const endpoint = delivery.endpoint;
    if (!endpoint.isActive && !options.force) return;

    const body = JSON.stringify({ id: delivery.eventId, type: delivery.event, createdAt: delivery.createdAt.toISOString(), data: delivery.payload });
    const started = Date.now();
    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;
    try {
      await assertSafeWebhookUrl(endpoint.url, this.allowPrivate);
      const response = await fetch(endpoint.url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'LevoJa-Webhooks/1.0',
          'X-LevoJa-Event': delivery.event,
          'X-LevoJa-Delivery': delivery.id,
          'X-LevoJa-Signature': signPayload(this.crypto.decrypt(endpoint.secretEncrypted), body),
        },
        body,
      });
      responseStatus = response.status;
      responseBody = (await response.text().catch(() => '')).slice(0, 1000);
      if (response.status < 200 || response.status >= 300) error = `Resposta HTTP ${response.status}`;
    } catch (caught) {
      error = caught instanceof UnsafeUrlError ? caught.message : (caught as Error).name === 'TimeoutError' ? 'Tempo esgotado (10 s)' : (caught as Error).message.slice(0, 300);
    }
    const attempts = delivery.attempts + 1;
    const durationMs = Date.now() - started;

    if (!error) {
      await this.prisma.$transaction([
        this.prisma.webhookDelivery.update({ where: { id: deliveryId }, data: { status: 'SUCCEEDED', attempts, responseStatus, responseBody, error: null, durationMs, deliveredAt: new Date(), nextAttemptAt: null } }),
        this.prisma.webhookEndpoint.update({ where: { id: endpoint.id }, data: { consecutiveFailures: 0, lastSuccessAt: new Date() } }),
      ]);
      return;
    }

    const retryIn = options.noRetry ? undefined : RETRY_MINUTES[attempts - 1];
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: retryIn ? 'PENDING' : 'FAILED', attempts, responseStatus, responseBody, error, durationMs, nextAttemptAt: retryIn ? new Date(Date.now() + retryIn * 60_000) : null },
    });
    if (retryIn) await this.jobs.enqueue('webhooks.deliver', { deliveryId }, { delayMs: retryIn * 60_000, jobId: `webhook:${deliveryId}:${attempts + 1}`, attempts: 1 });
    if (delivery.event === 'ping') return;
    const failed = await this.prisma.webhookEndpoint.update({ where: { id: endpoint.id }, data: { consecutiveFailures: { increment: 1 }, lastFailureAt: new Date() } });
    if (failed.isActive && failed.consecutiveFailures >= DISABLE_AFTER_FAILURES) await this.disable(failed.id, failed.companyId, failed.url);
  }

  private async disable(endpointId: string, companyId: string, url: string) {
    await this.prisma.webhookEndpoint.update({ where: { id: endpointId }, data: { isActive: false, disabledAt: new Date(), disabledReason: `${DISABLE_AFTER_FAILURES} falhas seguidas` } });
    const members = await this.prisma.companyUser.findMany({ where: { companyId, isActive: true, role: { permissions: { some: { permission: { key: 'company.b2b.manage' } } } } }, select: { userId: true } });
    await this.notifications
      .notifyMany(
        members.map((member) => member.userId),
        { type: 'integration.webhook_disabled', title: 'Webhook desativado', body: `O endpoint ${url} falhou ${DISABLE_AFTER_FAILURES} vezes seguidas e foi desativado. Corrija e reative em Integração.`, data: { companyId, endpointId }, channels: ['inapp', 'email'] },
      )
      .catch(() => undefined);
    this.logger.warn(`Webhook ${endpointId} desativado após falhas seguidas.`);
  }

  /** Reenvia pendências cujo horário chegou (ex.: após reinício sem fila persistente) e limpa históricos antigos. */
  @Cron('0 */5 * * * *')
  async sweep() {
    const due = await this.prisma.webhookDelivery.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: new Date(Date.now() - 60_000) } }, select: { id: true }, take: 200 });
    for (const delivery of due) await this.deliver(delivery.id).catch(() => undefined);
    return due.length;
  }

  @Cron('0 30 4 * * *')
  async cleanup() {
    const before = new Date(Date.now() - 30 * 86_400_000);
    await this.prisma.webhookDelivery.deleteMany({ where: { createdAt: { lt: before }, status: { not: 'PENDING' } } });
    await this.prisma.apiRequestLog.deleteMany({ where: { createdAt: { lt: before } } });
  }

  static isKnownEvent(event: string): event is WebhookEvent {
    return (WEBHOOK_EVENTS as string[]).includes(event);
  }
}
