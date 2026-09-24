import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { JobsService } from '../../infra/jobs/jobs.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { paginated, PaginationQueryDto, skipOf } from '../../common/pagination';
import type { AuthUser } from '../../common/auth/auth-user';
import { Prisma } from '../../generated/prisma/client';
import type { Broadcast } from '../../generated/prisma/client';
import type { BroadcastAudience, BroadcastKind } from '../../generated/prisma/enums';

export type BroadcastChannel = 'inapp' | 'push' | 'email';

export interface BroadcastInput {
  audience: BroadcastAudience;
  kind: BroadcastKind;
  title: string;
  body: string;
  channels: BroadcastChannel[];
  city?: string;
}

const BATCH = 500;
const JOB = 'broadcasts.send';
const APP: Record<BroadcastAudience, 'CUSTOMER' | 'DRIVER' | undefined> = { CUSTOMERS: 'CUSTOMER', DRIVERS: 'DRIVER', COMPANY_USERS: undefined };
const AUDIENCE_LABEL: Record<BroadcastAudience, string> = { CUSTOMERS: 'clientes', DRIVERS: 'entregadores', COMPANY_USERS: 'usuários de empresas' };

/**
 * Comunicados em massa:
 * - MARKETING (promoções): somente pelos canais com consentimento de cada pessoa (LGPD).
 * - OPERACIONAL (avisos de operação): apenas para entregadores e empresas — nunca para disfarçar
 *   promoção a clientes sem consentimento.
 * O envio é feito em lotes por uma tarefa em segundo plano, com contagem de alcance.
 */
@Injectable()
export class BroadcastsService implements OnModuleInit {
  private readonly logger = new Logger(BroadcastsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register<{ broadcastId: string }>(JOB, (payload) => this.process(payload.broadcastId));
  }

  private validate(input: Pick<BroadcastInput, 'audience' | 'kind' | 'channels'>) {
    if (input.kind === 'OPERATIONAL' && input.audience === 'CUSTOMERS') {
      throw new BadRequestException('Avisos operacionais são apenas para entregadores e empresas. Para clientes, envie como promoção (respeita o consentimento).');
    }
    if (!input.channels.length) throw new BadRequestException('Escolha ao menos um canal.');
  }

  private audienceWhere(tenantId: string, audience: BroadcastAudience, city?: string): Prisma.UserWhereInput {
    const base: Prisma.UserWhereInput = { tenantId, status: 'ACTIVE', anonymizedAt: null };
    const inCity = city ? { city: { equals: city.trim(), mode: 'insensitive' as const } } : undefined;
    switch (audience) {
      case 'CUSTOMERS':
        return { ...base, customer: { isNot: null }, ...(inCity ? { addresses: { some: { deletedAt: null, ...inCity } } } : {}) };
      case 'DRIVERS':
        return { ...base, driver: { is: { status: 'APPROVED', ...(inCity ? { address: { is: inCity } } : {}) } } };
      case 'COMPANY_USERS':
        return { ...base, companyMemberships: { some: { isActive: true, company: { status: 'APPROVED', ...(inCity ? { address: { is: inCity } } : {}) } } } };
    }
  }

  /** Estimativa de alcance antes do envio (marketing: quem tem consentimento em algum canal escolhido). */
  async preview(user: AuthUser, input: Pick<BroadcastInput, 'audience' | 'kind' | 'channels' | 'city'>) {
    this.validate(input);
    const where = this.audienceWhere(user.tenantId, input.audience, input.city);
    const audience = await this.prisma.user.count({ where });
    let reachable = audience;
    if (input.kind === 'MARKETING' && !input.channels.includes('inapp')) {
      // Alcance = pessoas do público cujo consentimento mais recente, em algum canal escolhido, é "sim".
      const types = [...(input.channels.includes('push') ? ['MARKETING_PUSH'] : []), ...(input.channels.includes('email') ? ['MARKETING_EMAIL'] : [])];
      reachable = 0;
      let cursor: string | undefined;
      for (;;) {
        const users = await this.prisma.user.findMany({ where, select: { id: true }, orderBy: { id: 'asc' }, take: 5000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
        if (!users.length) break;
        const rows = await this.prisma.$queryRaw<{ count: number }[]>`
          SELECT count(DISTINCT c."userId")::int AS count FROM (
            SELECT DISTINCT ON ("userId", type) "userId", granted FROM consents
            WHERE type::text IN (${Prisma.join(types)}) AND "userId" = ANY(${users.map((row) => row.id)}::uuid[])
            ORDER BY "userId", type, "createdAt" DESC
          ) c WHERE c.granted`;
        reachable += rows[0]?.count ?? 0;
        cursor = users[users.length - 1].id;
      }
    }
    return { audience, reachable };
  }

  async create(user: AuthUser, input: BroadcastInput) {
    this.validate(input);
    const broadcast = await this.prisma.broadcast.create({
      data: {
        tenantId: user.tenantId,
        audience: input.audience,
        kind: input.kind,
        title: input.title.trim(),
        body: input.body.trim(),
        channels: [...new Set(input.channels)],
        city: input.city?.trim() || null,
        createdById: user.userId,
      },
    });
    await this.audit.log({
      action: 'notifications.broadcast',
      entityType: 'Broadcast',
      entityId: broadcast.id,
      after: { audience: input.audience, kind: input.kind, channels: broadcast.channels, city: broadcast.city, title: broadcast.title },
    });
    await this.jobs.enqueue(JOB, { broadcastId: broadcast.id }, { attempts: 1, jobId: `broadcast:${broadcast.id}` });
    const author = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { name: true } });
    return this.view(broadcast, author?.name ?? '—');
  }

  async list(user: AuthUser, query: PaginationQueryDto) {
    const where: Prisma.BroadcastWhereInput = { tenantId: user.tenantId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.broadcast.count({ where }),
      this.prisma.broadcast.findMany({ where, orderBy: { createdAt: 'desc' }, skip: skipOf(query), take: query.pageSize }),
    ]);
    const authors = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.createdById))] } }, select: { id: true, name: true } });
    const nameOf = new Map(authors.map((author) => [author.id, author.name]));
    return paginated(rows.map((row) => this.view(row, nameOf.get(row.createdById) ?? '—')), total, query);
  }

  private view(broadcast: Broadcast, createdBy: string) {
    return {
      id: broadcast.id,
      audience: broadcast.audience,
      kind: broadcast.kind,
      title: broadcast.title,
      body: broadcast.body,
      channels: broadcast.channels,
      city: broadcast.city,
      status: broadcast.status,
      recipients: broadcast.recipients,
      delivered: broadcast.delivered,
      createdBy,
      createdAt: broadcast.createdAt,
      finishedAt: broadcast.finishedAt,
    };
  }

  /** Envio em lotes. Idempotente: só processa comunicados ainda na fila. */
  async process(broadcastId: string): Promise<void> {
    const claimed = await this.prisma.broadcast.updateMany({ where: { id: broadcastId, status: 'QUEUED' }, data: { status: 'SENDING' } });
    if (!claimed.count) return;
    const broadcast = await this.prisma.broadcast.findUniqueOrThrow({ where: { id: broadcastId } });
    const where = this.audienceWhere(broadcast.tenantId, broadcast.audience, broadcast.city ?? undefined);
    const marketing = broadcast.kind === 'MARKETING';
    const footer = marketing
      ? 'Você recebe esta mensagem porque autorizou comunicações promocionais. Para deixar de receber, ajuste suas preferências em Conta > Privacidade.'
      : `Aviso operacional enviado a ${AUDIENCE_LABEL[broadcast.audience]} parceiros da plataforma.`;
    let recipients = 0;
    let delivered = 0;
    let cursor: string | undefined;
    try {
      for (;;) {
        const users = await this.prisma.user.findMany({
          where,
          select: { id: true },
          orderBy: { id: 'asc' },
          take: BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (!users.length) break;
        for (const recipient of users) {
          recipients += 1;
          const channels = await this.notifications.notify({
            userId: recipient.id,
            type: marketing ? 'broadcast.marketing' : 'broadcast.operational',
            title: broadcast.title,
            body: broadcast.body,
            data: { broadcastId: broadcast.id },
            channels: broadcast.channels as BroadcastChannel[],
            category: marketing ? 'marketing' : 'transactional',
            app: APP[broadcast.audience],
            channelId: marketing ? 'promotions' : undefined,
            email: { subject: broadcast.title, paragraphs: [broadcast.body], footer },
          });
          if (channels.length) delivered += 1;
        }
        cursor = users[users.length - 1].id;
        await this.prisma.broadcast.update({ where: { id: broadcast.id }, data: { recipients, delivered } });
      }
      await this.prisma.broadcast.update({ where: { id: broadcast.id }, data: { status: 'SENT', recipients, delivered, finishedAt: new Date() } });
      this.logger.log(`Comunicado ${broadcast.id} enviado: ${delivered}/${recipients}.`);
    } catch (error) {
      this.logger.error(`Comunicado ${broadcast.id} interrompido: ${(error as Error).message}`);
      await this.prisma.broadcast.update({ where: { id: broadcast.id }, data: { status: 'FAILED', recipients, delivered, finishedAt: new Date() } });
    }
  }
}
