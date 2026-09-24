import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  availablePartnerActions,
  PARTNER_STATUS_LABELS,
  PartnerAction,
  formatCnpj,
  normalizeCnpj,
  ROLE_KEYS,
} from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppConfig } from '../../config/config.module';
import { resolveAdminTransition } from '../../common/partner-workflow';
import { paginated, skipOf } from '../../common/pagination';
import type { AuthUser } from '../../common/auth/auth-user';
import { CompaniesService } from './companies.service';
import { AdminCompaniesQueryDto, PartnerActionDto, ReviewDocumentDto } from './companies.dto';
import { Prisma } from '../../generated/prisma/client';

const PERMISSIONS = { review: 'companies.review', manage: 'companies.manage' };

@Injectable()
export class CompanyReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly companies: CompaniesService,
    private readonly config: AppConfig,
  ) {}

  async list(tenantId: string, query: AdminCompaniesQueryDto) {
    const search = query.search?.trim();
    const cnpjSearch = search ? normalizeCnpj(search) : '';
    const where: Prisma.CompanyWhereInput = {
      tenantId,
      status: query.status,
      segmentId: query.segmentId,
      ...(search
        ? {
            OR: [
              { tradeName: { contains: search, mode: 'insensitive' } },
              { legalName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              ...(cnpjSearch.length >= 4 ? [{ cnpj: { contains: cnpjSearch } }] : []),
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.company.count({ where }),
      this.prisma.company.findMany({
        where,
        orderBy: [{ submittedAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: skipOf(query),
        take: query.pageSize,
        select: {
          id: true,
          tradeName: true,
          legalName: true,
          cnpj: true,
          status: true,
          submittedAt: true,
          approvedAt: true,
          createdAt: true,
          logoKey: true,
          isOpen: true,
          ratingAvg: true,
          segment: { select: { name: true, isRegulated: true } },
          address: { select: { city: true, state: true } },
          _count: { select: { documents: { where: { status: 'PENDING' } } } },
        },
      }),
    ]);
    return paginated(
      rows.map(({ logoKey, _count, cnpj, ...row }) => ({
        ...row,
        cnpj: formatCnpj(cnpj),
        logoUrl: this.storage.publicUrl(logoKey),
        pendingDocuments: _count.documents,
      })),
      total,
      query,
    );
  }

  async get(actor: AuthUser, companyId: string) {
    const company = await this.companies.findDetail(companyId);
    if (company.tenantId !== actor.tenantId) throw new NotFoundException('Empresa não encontrada.');
    const [history, members] = await Promise.all([
      this.prisma.companyStatusHistory.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.companyUser.findMany({
        where: { companyId },
        include: { user: { select: { id: true, name: true, email: true, phone: true } }, role: { select: { key: true, name: true } } },
      }),
    ]);
    const changedByIds = [...new Set(history.map((entry) => entry.changedById).filter((id): id is string => !!id))];
    const actors = await this.prisma.user.findMany({ where: { id: { in: changedByIds } }, select: { id: true, name: true } });
    const actorName = new Map(actors.map((user) => [user.id, user.name]));

    return {
      ...this.companies.toView(company),
      adminActions: [
        ...(actor.can(PERMISSIONS.review) ? availablePartnerActions(company.status, 'REVIEWER') : []),
        ...(actor.can(PERMISSIONS.manage) ? availablePartnerActions(company.status, 'MANAGER') : []),
      ],
      history: history.map((entry) => ({ ...entry, changedByName: entry.changedById ? (actorName.get(entry.changedById) ?? null) : null })),
      members: members.map(({ user, role, isActive }) => ({ ...user, role, isActive })),
    };
  }

  async applyAction(actor: AuthUser, companyId: string, dto: PartnerActionDto) {
    const company = await this.companies.findDetail(companyId);
    if (company.tenantId !== actor.tenantId) throw new NotFoundException('Empresa não encontrada.');
    const action = dto.action as PartnerAction;
    const next = resolveAdminTransition(actor, action, company.status, dto.reason, PERMISSIONS);

    if (action === 'APPROVE') {
      const required = this.companies.requiredDocuments(company);
      const notApproved = required.filter(
        (type) => !company.documents.some((doc) => doc.type === type && doc.status === 'APPROVED'),
      );
      if (notApproved.length) {
        throw new ConflictException('Aprove todos os documentos obrigatórios antes de aprovar a empresa.');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { id: companyId },
        data: {
          status: next,
          statusReason: dto.reason ?? null,
          approvedAt: action === 'APPROVE' ? new Date() : undefined,
          // Loja suspensa/bloqueada deixa de receber pedidos imediatamente.
          isOpen: next === 'APPROVED' ? undefined : false,
        },
      });
      await tx.companyStatusHistory.create({
        data: { companyId, fromStatus: company.status, toStatus: next, action, reason: dto.reason, changedById: actor.userId },
      });
      await this.audit.log(
        {
          action: `company.${action.toLowerCase()}`,
          entityType: 'Company',
          entityId: companyId,
          before: { status: company.status },
          after: { status: next, reason: dto.reason },
        },
        tx,
      );
    });

    await this.notifyOwners(companyId, company.tradeName, next, dto.reason);
    return this.get(actor, companyId);
  }

  async reviewDocument(actor: AuthUser, companyId: string, documentId: string, dto: ReviewDocumentDto) {
    const document = await this.prisma.companyDocument.findFirst({
      where: { id: documentId, companyId, company: { tenantId: actor.tenantId } },
    });
    if (!document) throw new NotFoundException('Documento não encontrado.');
    if (dto.status === 'REJECTED' && !dto.note?.trim()) throw new ConflictException('Informe o motivo da reprovação.');
    const updated = await this.prisma.companyDocument.update({
      where: { id: document.id },
      data: { status: dto.status, reviewNote: dto.note ?? null, reviewedAt: new Date(), reviewedById: actor.userId },
    });
    await this.audit.log({
      action: `company.document.${dto.status === 'APPROVED' ? 'approve' : 'reject'}`,
      entityType: 'CompanyDocument',
      entityId: document.id,
      before: { status: document.status },
      after: { status: dto.status, note: dto.note },
      metadata: { companyId, type: document.type },
    });
    return updated;
  }

  private async notifyOwners(companyId: string, tradeName: string, status: string, reason?: string) {
    const owners = await this.prisma.companyUser.findMany({
      where: { companyId, isActive: true, role: { key: ROLE_KEYS.COMPANY_OWNER } },
      select: { userId: true },
    });
    const label = PARTNER_STATUS_LABELS[status as keyof typeof PARTNER_STATUS_LABELS];
    const messages: Record<string, string> = {
      APPROVED: `Parabéns! O cadastro de ${tradeName} foi aprovado. Você já pode configurar o catálogo e abrir a loja.`,
      REJECTED: `O cadastro de ${tradeName} foi reprovado. Motivo: ${reason ?? '-'}`,
      PENDING_DOCUMENTS: `O cadastro de ${tradeName} precisa de correções: ${reason ?? '-'}`,
      SUSPENDED: `A empresa ${tradeName} foi suspensa. Motivo: ${reason ?? '-'}`,
      BLOCKED: `A empresa ${tradeName} foi bloqueada. Motivo: ${reason ?? '-'}`,
    };
    const body = messages[status] ?? `Status do cadastro de ${tradeName}: ${label}.`;
    await this.notifications.notifyMany(
      owners.map((owner) => owner.userId),
      {
        type: `company.status.${status.toLowerCase()}`,
        title: `Cadastro da empresa: ${label}`,
        body,
        data: { companyId, status },
        channels: ['inapp', 'push', 'email'],
        email: {
          subject: `Cadastro da empresa: ${label}`,
          paragraphs: [body],
          action: { label: 'Acessar o portal da empresa', url: `${this.config.env.WEB_PUBLIC_URL}/empresa` },
        },
      },
    );
  }
}
