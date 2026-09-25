import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isHexColor, isValidDomain, ROLE_KEYS } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { UploadedFileLike, validateUpload } from '../../infra/storage/file-validation';
import { AuditService, diff } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { InvitationsService } from '../users/invitations.service';
import { Prisma } from '../../generated/prisma/client';
import type { AuthUser } from '../../common/auth/auth-user';
import { provisionTenant } from './provisioning';
import { TenantsService } from './tenants.service';

export interface BrandingInput {
  appName?: string;
  logoUrl?: string | null;
  primaryColor?: string;
  supportEmail?: string | null;
  supportPhone?: string | null;
  webUrl?: string | null;
  adminUrl?: string | null;
}

export interface CreateTenantInput {
  slug: string;
  name: string;
  domains?: string[];
  branding?: BrandingInput;
  admin: { name: string; email: string };
}

const RESERVED_SLUGS = ['admin', 'api', 'www', 'app', 'static', 'public', 'docs'];

/**
 * White label em nível de plataforma: cada tenant é uma operação com marca, domínios, regras
 * (preços, comissões, planos, configurações) e base de usuários próprias. A equipe do tenant
 * principal (permissão tenants.manage) cria e configura tenants; o administrador de cada tenant
 * ajusta a própria marca.
 */
@Injectable()
export class TenantsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly invitations: InvitationsService,
    private readonly tenants: TenantsService,
  ) {}

  async list() {
    const tenants = await this.prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });
    const [users, companies, drivers] = await Promise.all([
      this.prisma.user.groupBy({ by: ['tenantId'], _count: { _all: true } }),
      this.prisma.company.groupBy({ by: ['tenantId'], where: { status: 'APPROVED' }, _count: { _all: true } }),
      this.prisma.driver.groupBy({ by: ['tenantId'], where: { status: 'APPROVED' }, _count: { _all: true } }),
    ]);
    const count = (rows: { tenantId: string; _count: { _all: number } }[], id: string) => rows.find((row) => row.tenantId === id)?._count._all ?? 0;
    return tenants.map((tenant) => ({
      ...tenant,
      users: count(users, tenant.id),
      companies: count(companies, tenant.id),
      drivers: count(drivers, tenant.id),
    }));
  }

  private normalizeDomains(domains: string[] | undefined): string[] | undefined {
    if (!domains) return undefined;
    const normalized = [...new Set(domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean))];
    const invalid = normalized.find((domain) => !isValidDomain(domain));
    if (invalid) throw new BadRequestException(`Domínio inválido: ${invalid}. Informe só o endereço, sem https:// nem caminho.`);
    return normalized;
  }

  private async assertDomainsFree(domains: string[], tenantId?: string) {
    if (!domains.length) return;
    const taken = await this.prisma.tenant.findFirst({ where: { domains: { hasSome: domains }, ...(tenantId ? { id: { not: tenantId } } : {}) }, select: { name: true, domains: true } });
    if (taken) throw new ConflictException(`Domínio já usado pelo tenant ${taken.name}: ${taken.domains.filter((domain) => domains.includes(domain)).join(', ')}.`);
    const company = await this.prisma.company.findFirst({ where: { customDomain: { in: domains } }, select: { tradeName: true } });
    if (company) throw new ConflictException(`Domínio já usado pela página da empresa ${company.tradeName}.`);
  }

  private branding(current: unknown, input: BrandingInput | undefined): Prisma.InputJsonValue | undefined {
    if (!input) return undefined;
    const merged: Record<string, unknown> = { ...((current ?? {}) as Record<string, unknown>), ...input };
    if (merged.primaryColor && !isHexColor(String(merged.primaryColor))) throw new BadRequestException('Cor principal inválida (use #RRGGBB).');
    for (const key of ['logoUrl', 'webUrl', 'adminUrl'] as const) {
      const value = merged[key];
      if (value && !/^https?:\/\/[^\s]+$/.test(String(value))) throw new BadRequestException(`Endereço inválido em ${key}.`);
      if (typeof value === 'string') merged[key] = value.replace(/\/+$/, '');
    }
    for (const [key, value] of Object.entries(merged)) if (value === '' || value === null) delete merged[key];
    return merged as Prisma.InputJsonValue;
  }

  /** Cria o tenant com os dados essenciais e convida o primeiro administrador. */
  async create(actor: AuthUser, input: CreateTenantInput) {
    const slug = input.slug.trim().toLowerCase();
    if (!/^[a-z0-9-]{3,40}$/.test(slug) || RESERVED_SLUGS.includes(slug)) throw new BadRequestException('Identificador inválido: use de 3 a 40 letras minúsculas, números ou hífen.');
    const domains = this.normalizeDomains(input.domains) ?? [];
    await this.assertDomainsFree(domains);
    if (await this.prisma.tenant.findUnique({ where: { slug }, select: { id: true } })) throw new ConflictException('Já existe um tenant com este identificador.');

    const tenant = await this.prisma.tenant.create({
      data: { slug, name: input.name.trim(), domains, branding: this.branding({ appName: input.name.trim(), primaryColor: '#FF5A1F' }, input.branding) ?? Prisma.DbNull },
    });
    await provisionTenant(this.prisma, tenant.id);

    // Primeiro administrador do tenant (sem acesso a outros tenants).
    const role = await this.prisma.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key: ROLE_KEYS.ADMIN } } });
    const admin = await this.prisma.$transaction((tx) => this.users.create(tx, tenant.id, { name: input.admin.name.trim(), email: this.users.normalizeEmail(input.admin.email), roleIds: [role.id] }));
    await this.invitations.sendInvitation(admin, `Você é administrador(a) da plataforma ${tenant.name}`, 'admin');
    await this.tenants.invalidate();
    await this.audit.log({ action: 'tenant.create', entityType: 'Tenant', entityId: tenant.id, after: { slug, name: tenant.name, domains, admin: admin.email }, actorId: actor.userId });
    return { ...tenant, admin: { id: admin.id, email: admin.email } };
  }

  async update(actor: AuthUser, id: string, input: { name?: string; domains?: string[]; branding?: BrandingInput; status?: 'ACTIVE' | 'SUSPENDED' }) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant não encontrado.');
    if (input.status === 'SUSPENDED' && id === actor.tenantId) throw new ConflictException('Não é possível suspender o próprio tenant.');
    const domains = this.normalizeDomains(input.domains);
    if (domains) await this.assertDomainsFree(domains, id);
    const updated = await this.prisma.tenant.update({
      where: { id },
      data: { name: input.name?.trim(), domains, branding: this.branding(tenant.branding, input.branding), status: input.status },
    });
    await this.tenants.invalidate();
    await this.audit.log({ action: input.status && input.status !== tenant.status ? `tenant.${input.status === 'SUSPENDED' ? 'suspend' : 'activate'}` : 'tenant.update', entityType: 'Tenant', entityId: id, ...diff(tenant, updated) });
    return updated;
  }

  /** Marca do próprio tenant (administrador com settings.manage). Domínios ficam com a equipe da plataforma. */
  async updateOwnBranding(actor: AuthUser, input: BrandingInput) {
    return this.update(actor, actor.tenantId, { branding: input });
  }

  async uploadLogo(actor: AuthUser, file: UploadedFileLike | undefined) {
    const { mime, ext } = validateUpload(file, 'image');
    const key = await this.storage.put(`public/tenants/${actor.tenantId}/logo-${randomUUID()}.${ext}`, file!.buffer, mime);
    const url = this.storage.publicUrl(key);
    if (!url) throw new BadRequestException('Armazenamento sem endereço público configurado (PUBLIC_FILES_BASE_URL).');
    await this.updateOwnBranding(actor, { logoUrl: url });
    return { url };
  }
}
