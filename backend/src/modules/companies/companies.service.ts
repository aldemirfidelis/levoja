import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import {
  availablePartnerActions,
  COMPANY_DOCUMENT_LABELS,
  CompanyDocumentType as SharedCompanyDocumentType,
  formatCnpj,
  isValidCnpj,
  maskDocument,
  normalizeCnpj,
  ROLE_KEYS,
} from '@levoja/shared';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { SubscriptionsService } from '../saas/subscriptions.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { StorageService } from '../../infra/storage/storage.service';
import { safeFileName, UploadedFileLike, validateUpload } from '../../infra/storage/file-validation';
import { AuditService, diff } from '../audit/audit.service';
import { AccessService } from '../access/access.service';
import { RolesService } from '../access/roles.service';
import { UsersService } from '../users/users.service';
import { BankAccountsService, toView as bankAccountView } from '../partners/bank-accounts.service';
import { BankAccountDto } from '../partners/bank-account.dto';
import { AddressDto } from '../customers/address.dto';
import { MapsService } from '../geo/maps.service';
import { assertRequirements, RequirementItem, resolveOwnerSubmit, slugify } from '../../common/partner-workflow';
import { isWithinOpeningHours, validateOpeningHours } from '../../common/opening-hours';
import type { AuthUser } from '../../common/auth/auth-user';
import { CreateCompanyDto, OpeningHoursDto, UpdateCompanyDto } from './companies.dto';
import { Prisma } from '../../generated/prisma/client';
import type { CompanyDocumentType } from '../../generated/prisma/enums';

export const BASE_COMPANY_DOCUMENTS: CompanyDocumentType[] = ['CNPJ_CARD', 'RESPONSIBLE_ID', 'ADDRESS_PROOF'];

/** Campos de identidade jurídica: bloqueados após o envio para análise. */
const LEGAL_FIELDS = ['legalName', 'cnpj', 'responsibleName', 'responsibleCpf'] as const;
const EDITABLE_LEGAL_STATUSES = ['DRAFT', 'PENDING_DOCUMENTS', 'REJECTED'];

export const companyDetailInclude = {
  segment: { select: { id: true, slug: true, name: true, isRegulated: true, requiredDocuments: true } },
  address: true,
  openingHours: { orderBy: [{ weekday: 'asc' }, { opensAt: 'asc' }] },
  documents: { orderBy: { createdAt: 'desc' } },
  bankAccount: true,
} satisfies Prisma.CompanyInclude;

export type CompanyDetail = Prisma.CompanyGetPayload<{ include: typeof companyDetailInclude }>;

export const COMPANY_SUBMITTED = 'company.submitted';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly roles: RolesService,
    private readonly users: UsersService,
    private readonly bankAccounts: BankAccountsService,
    private readonly events: EventEmitter2,
    private readonly maps: MapsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Criação
  // ---------------------------------------------------------------------------

  /** Cria a empresa (status "Cadastro iniciado") e vincula o usuário como proprietário. */
  async createForOwner(tx: Tx, tenantId: string, ownerUserId: string, dto: CreateCompanyDto) {
    const cnpj = normalizeCnpj(dto.cnpj);
    if (!isValidCnpj(cnpj)) throw new BadRequestException('CNPJ inválido.');
    if (await tx.company.findUnique({ where: { tenantId_cnpj: { tenantId, cnpj } }, select: { id: true } })) {
      throw new ConflictException('CNPJ já cadastrado na plataforma.');
    }
    const segment = await tx.segment.findFirst({
      where: { id: dto.segmentId, tenantId, isActive: true, kind: 'MARKETPLACE' },
    });
    if (!segment) throw new BadRequestException('Segmento inválido.');

    const responsibleCpf = this.users.normalizeCpf(dto.responsibleCpf);
    const ownerRole = await this.roles.findByKey(tenantId, ROLE_KEYS.COMPANY_OWNER, tx);

    const company = await tx.company.create({
      data: {
        tenantId,
        segmentId: segment.id,
        legalName: dto.legalName,
        tradeName: dto.tradeName,
        slug: await this.uniqueSlug(tx, tenantId, dto.tradeName),
        cnpj,
        email: this.users.normalizeEmail(dto.email),
        phone: this.users.normalizePhone(dto.phone),
        responsibleName: dto.responsibleName,
        responsibleCpfEncrypted: this.crypto.encrypt(responsibleCpf),
        responsibleCpfHash: this.users.cpfHash(responsibleCpf),
        description: dto.description,
        members: { create: { userId: ownerUserId, roleId: ownerRole.id } },
        statusHistory: { create: { fromStatus: 'DRAFT', toStatus: 'DRAFT', action: 'CREATE', changedById: ownerUserId } },
      },
    });
    await this.audit.log(
      {
        action: 'company.create',
        entityType: 'Company',
        entityId: company.id,
        actorId: ownerUserId,
        tenantId,
        after: { tradeName: company.tradeName, cnpj: formatCnpj(cnpj), segment: segment.slug },
      },
      tx,
    );
    return company;
  }

  async create(user: AuthUser, dto: CreateCompanyDto) {
    const company = await this.prisma.$transaction((tx) => this.createForOwner(tx, user.tenantId, user.userId, dto));
    await this.access.invalidate(user.userId);
    return this.getView(company.id);
  }

  private async uniqueSlug(tx: Tx, tenantId: string, name: string): Promise<string> {
    const base = slugify(name);
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${randomUUID().slice(0, 4)}`;
      const taken = await tx.company.findUnique({ where: { tenantId_slug: { tenantId, slug: candidate } }, select: { id: true } });
      if (!taken) return candidate;
    }
    throw new ConflictException('Não foi possível gerar um identificador para a empresa.');
  }

  // ---------------------------------------------------------------------------
  // Leitura
  // ---------------------------------------------------------------------------

  async listMine(user: AuthUser) {
    const memberships = await this.prisma.companyUser.findMany({
      where: { userId: user.userId, isActive: true },
      include: {
        role: { select: { key: true, name: true } },
        company: { select: { id: true, tradeName: true, slug: true, status: true, logoKey: true, isOpen: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map(({ company, role }) => ({
      ...company,
      logoKey: undefined,
      logoUrl: this.storage.publicUrl(company.logoKey),
      role,
    }));
  }

  async findDetail(companyId: string): Promise<CompanyDetail> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, include: companyDetailInclude });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    return company;
  }

  async getView(companyId: string) {
    return this.toView(await this.findDetail(companyId));
  }

  toView(company: CompanyDetail) {
    const responsibleCpf = this.crypto.decrypt(company.responsibleCpfEncrypted);
    return {
      id: company.id,
      tenantId: company.tenantId,
      legalName: company.legalName,
      tradeName: company.tradeName,
      slug: company.slug,
      cnpj: formatCnpj(company.cnpj),
      responsibleName: company.responsibleName,
      responsibleCpfMasked: maskDocument(responsibleCpf),
      email: company.email,
      phone: company.phone,
      description: company.description,
      logoUrl: this.storage.publicUrl(company.logoKey),
      bannerUrl: this.storage.publicUrl(company.bannerKey),
      segment: company.segment,
      address: company.address,
      openingHours: company.openingHours.map(({ weekday, opensAt, closesAt }) => ({ weekday, opensAt, closesAt })),
      status: company.status,
      statusReason: company.statusReason,
      submittedAt: company.submittedAt,
      approvedAt: company.approvedAt,
      isOpen: company.isOpen,
      isOpenNow: company.isOpen && isWithinOpeningHours(company.openingHours, new Date(), company.timezone),
      timezone: company.timezone,
      averagePrepMinutes: company.averagePrepMinutes,
      minimumOrderCents: company.minimumOrderCents,
      fulfillmentMode: company.fulfillmentMode,
      ratingAvg: company.ratingAvg,
      ratingCount: company.ratingCount,
      documents: company.documents.map((doc) => ({
        id: doc.id,
        type: doc.type,
        label: COMPANY_DOCUMENT_LABELS[doc.type as SharedCompanyDocumentType],
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        status: doc.status,
        reviewNote: doc.reviewNote,
        reviewedAt: doc.reviewedAt,
        createdAt: doc.createdAt,
      })),
      bankAccount: bankAccountView(company.bankAccount),
      requirements: this.requirements(company),
      ownerActions: availablePartnerActions(company.status, 'OWNER'),
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
    };
  }

  requiredDocuments(company: CompanyDetail): CompanyDocumentType[] {
    return [...new Set([...BASE_COMPANY_DOCUMENTS, ...company.segment.requiredDocuments])];
  }

  /** Checklist do cadastro — exibido no portal e validado no envio para análise. */
  requirements(company: CompanyDetail): RequirementItem[] {
    const docs = this.requiredDocuments(company).map((type) => {
      const latest = company.documents.find((doc) => doc.type === type);
      return {
        key: `document:${type}`,
        label: `Documento: ${COMPANY_DOCUMENT_LABELS[type as SharedCompanyDocumentType]}`,
        done: !!latest && latest.status !== 'REJECTED',
        detail: latest?.status === 'REJECTED' ? (latest.reviewNote ?? 'Documento reprovado — envie novamente.') : undefined,
      };
    });
    return [
      { key: 'address', label: 'Endereço do estabelecimento', done: !!company.address },
      { key: 'opening_hours', label: 'Horário de funcionamento', done: company.openingHours.length > 0 },
      { key: 'bank_account', label: 'Dados bancários para repasse', done: !!company.bankAccount },
      ...docs,
    ];
  }

  // ---------------------------------------------------------------------------
  // Edição
  // ---------------------------------------------------------------------------

  async update(companyId: string, dto: UpdateCompanyDto) {
    const company = await this.findDetail(companyId);
    if (dto.fulfillmentMode && dto.fulfillmentMode !== 'PLATFORM' && dto.fulfillmentMode !== company.fulfillmentMode) {
      await this.subscriptions.assertFeature(company.tenantId, companyId, 'own_fleet');
    }
    const touchesLegal = LEGAL_FIELDS.some((field) => dto[field] !== undefined);
    if (touchesLegal && !EDITABLE_LEGAL_STATUSES.includes(company.status)) {
      throw new ConflictException('Dados jurídicos não podem ser alterados após o envio para análise. Contate o suporte.');
    }

    const data: Prisma.CompanyUpdateInput = {
      legalName: dto.legalName,
      tradeName: dto.tradeName,
      description: dto.description,
      responsibleName: dto.responsibleName,
      averagePrepMinutes: dto.averagePrepMinutes,
      minimumOrderCents: dto.minimumOrderCents,
      fulfillmentMode: dto.fulfillmentMode,
      email: dto.email ? this.users.normalizeEmail(dto.email) : undefined,
      phone: dto.phone ? this.users.normalizePhone(dto.phone) : undefined,
    };
    if (dto.cnpj) {
      const cnpj = normalizeCnpj(dto.cnpj);
      if (!isValidCnpj(cnpj)) throw new BadRequestException('CNPJ inválido.');
      const taken = await this.prisma.company.findFirst({
        where: { tenantId: company.tenantId, cnpj, NOT: { id: company.id } },
        select: { id: true },
      });
      if (taken) throw new ConflictException('CNPJ já cadastrado na plataforma.');
      data.cnpj = cnpj;
    }
    if (dto.responsibleCpf) {
      const cpf = this.users.normalizeCpf(dto.responsibleCpf);
      data.responsibleCpfEncrypted = this.crypto.encrypt(cpf);
      data.responsibleCpfHash = this.users.cpfHash(cpf);
    }
    if (dto.segmentId && dto.segmentId !== company.segmentId) {
      if (!EDITABLE_LEGAL_STATUSES.includes(company.status)) {
        throw new ConflictException('O segmento não pode ser alterado após o envio para análise.');
      }
      const segment = await this.prisma.segment.findFirst({
        where: { id: dto.segmentId, tenantId: company.tenantId, isActive: true, kind: 'MARKETPLACE' },
      });
      if (!segment) throw new BadRequestException('Segmento inválido.');
      data.segment = { connect: { id: segment.id } };
    }

    const updated = await this.prisma.company.update({ where: { id: companyId }, data });
    const changes = diff(pickAudited(company), pickAudited(updated));
    if (Object.keys(changes.after).length) {
      await this.audit.log({ action: 'company.update', entityType: 'Company', entityId: companyId, ...changes });
    }
    return this.getView(companyId);
  }

  async setAddress(companyId: string, dto: AddressDto) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { addressId: true } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    const { isDefault: _ignored, label: _label, recipientName: _recipient, ...rest } = dto;
    // Sem coordenadas não há cálculo de rota/frete: tenta geocodificar o endereço.
    const point = rest.lat == null || rest.lng == null ? await this.maps.geocode(rest) : null;
    const address = point ? { ...rest, lat: point.lat, lng: point.lng } : rest;
    await this.prisma.$transaction(async (tx) => {
      if (company.addressId) {
        await tx.address.update({ where: { id: company.addressId }, data: address });
      } else {
        const created = await tx.address.create({ data: address });
        await tx.company.update({ where: { id: companyId }, data: { addressId: created.id } });
      }
    });
    await this.audit.log({ action: 'company.address.update', entityType: 'Company', entityId: companyId, after: { ...address } });
    return this.getView(companyId);
  }

  async setOpeningHours(companyId: string, dto: OpeningHoursDto) {
    validateOpeningHours(dto.hours);
    await this.prisma.$transaction([
      this.prisma.companyOpeningHour.deleteMany({ where: { companyId } }),
      this.prisma.companyOpeningHour.createMany({ data: dto.hours.map((hour) => ({ ...hour, companyId })) }),
    ]);
    await this.audit.log({ action: 'company.opening_hours.update', entityType: 'Company', entityId: companyId, after: { hours: dto.hours } });
    return this.getView(companyId);
  }

  async setOpen(companyId: string, isOpen: boolean) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { status: true } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    if (isOpen && company.status !== 'APPROVED') {
      throw new ConflictException('A loja só pode ser aberta após a aprovação do cadastro.');
    }
    await this.prisma.company.update({ where: { id: companyId }, data: { isOpen } });
    await this.audit.log({ action: isOpen ? 'company.open' : 'company.close', entityType: 'Company', entityId: companyId });
    return this.getView(companyId);
  }

  async uploadImage(companyId: string, kind: 'logo' | 'banner', file: UploadedFileLike | undefined) {
    const { mime, ext } = validateUpload(file, 'image');
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { logoKey: true, bannerKey: true } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    const key = await this.storage.put(`public/companies/${companyId}/${kind}-${randomUUID()}.${ext}`, file!.buffer, mime);
    const previous = kind === 'logo' ? company.logoKey : company.bannerKey;
    await this.prisma.company.update({ where: { id: companyId }, data: kind === 'logo' ? { logoKey: key } : { bannerKey: key } });
    await this.storage.delete(previous);
    return { url: this.storage.publicUrl(key) };
  }

  // ---------------------------------------------------------------------------
  // Documentos
  // ---------------------------------------------------------------------------

  async uploadDocument(companyId: string, type: CompanyDocumentType, file: UploadedFileLike | undefined) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { status: true } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    if (company.status === 'UNDER_REVIEW') {
      throw new ConflictException('Cadastro em análise: aguarde o resultado para enviar novos documentos.');
    }
    if (company.status === 'BLOCKED') throw new ConflictException('Cadastro bloqueado.');
    const { mime, ext } = validateUpload(file, 'document');
    const key = await this.storage.put(`private/companies/${companyId}/documents/${randomUUID()}.${ext}`, file!.buffer, mime);
    const document = await this.prisma.companyDocument.create({
      data: { companyId, type, fileKey: key, fileName: safeFileName(file!.originalname), mimeType: mime, sizeBytes: file!.size },
    });
    await this.audit.log({ action: 'company.document.upload', entityType: 'CompanyDocument', entityId: document.id, metadata: { companyId, type } });
    return { id: document.id, type: document.type, status: document.status, fileName: document.fileName, createdAt: document.createdAt };
  }

  async getDocumentFile(companyId: string, documentId: string, tenantId?: string) {
    const document = await this.prisma.companyDocument.findFirst({
      where: { id: documentId, companyId, ...(tenantId ? { company: { tenantId } } : {}) },
    });
    if (!document) throw new NotFoundException('Documento não encontrado.');
    const file = await this.storage.get(document.fileKey);
    if (!file) throw new NotFoundException('Arquivo não encontrado.');
    await this.audit.log({ action: 'company.document.view', entityType: 'CompanyDocument', entityId: document.id, metadata: { companyId } });
    return { ...file, contentType: document.mimeType, fileName: document.fileName };
  }

  async deleteDocument(companyId: string, documentId: string) {
    const document = await this.prisma.companyDocument.findFirst({ where: { id: documentId, companyId } });
    if (!document) throw new NotFoundException('Documento não encontrado.');
    if (document.status === 'APPROVED') throw new ConflictException('Documentos aprovados não podem ser removidos.');
    await this.prisma.companyDocument.delete({ where: { id: document.id } });
    await this.storage.delete(document.fileKey);
    await this.audit.log({ action: 'company.document.delete', entityType: 'CompanyDocument', entityId: document.id, metadata: { companyId } });
  }

  async setBankAccount(companyId: string, dto: BankAccountDto) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { tenantId: true } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    return this.bankAccounts.upsert(company.tenantId, { companyId }, dto);
  }

  // ---------------------------------------------------------------------------
  // Envio para análise
  // ---------------------------------------------------------------------------

  async submit(user: AuthUser, companyId: string) {
    const company = await this.findDetail(companyId);
    const next = resolveOwnerSubmit(company.status);
    assertRequirements(this.requirements(company));

    await this.prisma.$transaction(async (tx) => {
      await tx.company.update({ where: { id: companyId }, data: { status: next, statusReason: null, submittedAt: new Date() } });
      await tx.companyStatusHistory.create({
        data: { companyId, fromStatus: company.status, toStatus: next, action: 'SUBMIT', changedById: user.userId },
      });
      await this.audit.log(
        { action: 'company.submit', entityType: 'Company', entityId: companyId, before: { status: company.status }, after: { status: next } },
        tx,
      );
    });
    this.events.emit(COMPANY_SUBMITTED, { tenantId: company.tenantId, companyId, tradeName: company.tradeName });
    return this.getView(companyId);
  }

  statusHistory(companyId: string) {
    return this.prisma.companyStatusHistory.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
  }
}

function pickAudited(company: Record<string, unknown>) {
  const { legalName, tradeName, cnpj, email, phone, description, responsibleName, averagePrepMinutes, minimumOrderCents, fulfillmentMode, segmentId } =
    company;
  return { legalName, tradeName, cnpj, email, phone, description, responsibleName, averagePrepMinutes, minimumOrderCents, fulfillmentMode, segmentId };
}
