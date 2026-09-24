import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { ClientInfo } from '../../common/decorators';
import { ConsentType, LegalDocumentType } from '../../generated/prisma/enums';

export interface ConsentInput {
  type: ConsentType;
  granted: boolean;
}

/** Tipos de consentimento que correspondem a documentos legais versionados. */
const LEGAL_CONSENTS: Partial<Record<ConsentType, LegalDocumentType>> = {
  TERMS_OF_USE: 'TERMS_OF_USE',
  PRIVACY_POLICY: 'PRIVACY_POLICY',
  DRIVER_TERMS: 'DRIVER_TERMS',
  COMPANY_TERMS: 'COMPANY_TERMS',
};

/** Consentimentos opcionais que o titular pode conceder/revogar a qualquer momento. */
export const REVOCABLE_CONSENTS: ConsentType[] = [
  'MARKETING_EMAIL',
  'MARKETING_PUSH',
  'MARKETING_SMS',
  'MARKETING_WHATSAPP',
  'LOCATION_TRACKING',
];

@Injectable()
export class LegalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async current(tenantId: string, type: LegalDocumentType) {
    const doc = await this.prisma.legalDocument.findFirst({ where: { tenantId, type, isCurrent: true } });
    if (!doc) throw new NotFoundException('Documento não publicado.');
    return doc;
  }

  async currentVersions(tenantId: string, tx: Tx = this.prisma): Promise<Partial<Record<LegalDocumentType, string>>> {
    const docs = await tx.legalDocument.findMany({ where: { tenantId, isCurrent: true }, select: { type: true, version: true } });
    return Object.fromEntries(docs.map((doc) => [doc.type, doc.version]));
  }

  listCurrent(tenantId: string) {
    return this.prisma.legalDocument.findMany({
      where: { tenantId, isCurrent: true },
      select: { id: true, type: true, version: true, title: true, publishedAt: true },
      orderBy: { type: 'asc' },
    });
  }

  listAll(tenantId: string) {
    return this.prisma.legalDocument.findMany({
      where: { tenantId },
      select: { id: true, type: true, version: true, title: true, isCurrent: true, publishedAt: true },
      orderBy: [{ type: 'asc' }, { publishedAt: 'desc' }],
    });
  }

  async publish(tenantId: string, input: { type: LegalDocumentType; version: string; title: string; content: string }) {
    const exists = await this.prisma.legalDocument.findUnique({
      where: { tenantId_type_version: { tenantId, type: input.type, version: input.version } },
    });
    if (exists) throw new ConflictException('Esta versão já foi publicada.');
    return this.prisma.$transaction(async (tx) => {
      await tx.legalDocument.updateMany({ where: { tenantId, type: input.type, isCurrent: true }, data: { isCurrent: false } });
      const doc = await tx.legalDocument.create({ data: { tenantId, ...input, isCurrent: true } });
      await this.audit.log(
        { action: 'legal.publish', entityType: 'LegalDocument', entityId: doc.id, after: { type: input.type, version: input.version } },
        tx,
      );
      return doc;
    });
  }

  /**
   * Registra consentimentos (append-only). Para termos e política, grava a versão vigente —
   * requisito para demonstrar qual texto foi aceito (LGPD art. 8º).
   */
  async recordConsents(tx: Tx, tenantId: string, userId: string, consents: ConsentInput[], client: ClientInfo): Promise<void> {
    if (!consents.length) return;
    const versions = await this.currentVersions(tenantId, tx);
    await tx.consent.createMany({
      data: consents.map((consent) => {
        const legalType = LEGAL_CONSENTS[consent.type];
        return {
          userId,
          type: consent.type,
          granted: consent.granted,
          version: legalType ? (versions[legalType] ?? null) : null,
          ip: client.ip,
          userAgent: client.userAgent,
        };
      }),
    });
  }

  /** Estado atual de cada consentimento (último registro por tipo) e pendências de aceite. */
  async consentStatus(tenantId: string, userId: string, requiredTypes: ConsentType[]) {
    const [records, versions] = await Promise.all([
      this.prisma.consent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      this.currentVersions(tenantId),
    ]);
    const latest = new Map<ConsentType, (typeof records)[number]>();
    for (const record of records) if (!latest.has(record.type)) latest.set(record.type, record);

    const pending = requiredTypes.filter((type) => {
      const record = latest.get(type);
      const legalType = LEGAL_CONSENTS[type];
      if (!record?.granted) return true;
      return legalType ? versions[legalType] !== undefined && record.version !== versions[legalType] : false;
    });

    return {
      consents: [...latest.values()].map(({ type, granted, version, createdAt }) => ({ type, granted, version, updatedAt: createdAt })),
      pendingAcceptance: pending,
      currentVersions: versions,
    };
  }

  assertRevocable(type: ConsentType): void {
    if (!REVOCABLE_CONSENTS.includes(type)) {
      throw new BadRequestException('Este consentimento é obrigatório para uso da plataforma. Para revogá-lo, solicite a exclusão da conta.');
    }
  }
}
