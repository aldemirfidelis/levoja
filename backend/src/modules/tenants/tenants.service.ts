import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CacheService } from '../../infra/cache/cache.service';
import { AppConfig } from '../../config/config.module';

export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  branding: Record<string, unknown> | null;
}

const TTL = 300;

/**
 * Resolução de tenant para requisições (principalmente as públicas):
 * 1. Cabeçalho `X-Tenant` (slug) — apps e portais white label;
 * 2. Domínio da requisição (Host) cadastrado em `tenants.domains`;
 * 3. Tenant padrão (DEFAULT_TENANT_SLUG).
 * Para requisições autenticadas, o tenant do token é a fonte da verdade.
 */
@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly config: AppConfig,
  ) {}

  async resolve(headerSlug?: string, host?: string): Promise<TenantInfo> {
    if (headerSlug) {
      const bySlug = await this.bySlug(headerSlug.toLowerCase());
      if (bySlug) return bySlug;
      throw new NotFoundException('Tenant não encontrado.');
    }
    if (host) {
      const byDomain = await this.byDomain(host.split(':')[0].toLowerCase());
      if (byDomain) return byDomain;
    }
    const fallback = await this.bySlug(this.config.env.DEFAULT_TENANT_SLUG);
    if (!fallback) throw new NotFoundException('Tenant padrão não configurado. Execute o seed do banco.');
    return fallback;
  }

  bySlug(slug: string): Promise<TenantInfo | null> {
    return this.cache.wrap(`tenant:slug:${slug}`, TTL, () =>
      this.prisma.tenant.findUnique({ where: { slug }, select: SELECT }).then(toInfo),
    );
  }

  private byDomain(domain: string): Promise<TenantInfo | null> {
    return this.cache.wrap(`tenant:domain:${domain}`, TTL, () =>
      this.prisma.tenant.findFirst({ where: { domains: { has: domain } }, select: SELECT }).then(toInfo),
    );
  }

  async invalidate(): Promise<void> {
    await this.cache.delByPrefix('tenant:');
  }

  /**
   * Nome, marca e endereços públicos do tenant (white label): usados em e-mails, links e na
   * identidade visual dos portais. Sem configuração própria, valem os padrões do ambiente.
   */
  async info(tenantId: string): Promise<TenantPublicInfo> {
    return this.cache.wrap(`tenant:info:${tenantId}`, TTL, async () => {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, slug: true, name: true, status: true, branding: true, domains: true } });
      if (!tenant) throw new NotFoundException('Tenant não encontrado.');
      const branding = (tenant.branding ?? {}) as Record<string, unknown>;
      const text = (key: string) => (typeof branding[key] === 'string' && (branding[key] as string).trim() ? (branding[key] as string).trim() : null);
      return {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        domains: tenant.domains,
        appName: text('appName') ?? tenant.name,
        logoUrl: text('logoUrl'),
        primaryColor: text('primaryColor') ?? '#FF5A1F',
        supportEmail: text('supportEmail'),
        supportPhone: text('supportPhone'),
        webUrl: (text('webUrl') ?? this.config.env.WEB_PUBLIC_URL).replace(/\/+$/, ''),
        adminUrl: (text('adminUrl') ?? this.config.env.ADMIN_PUBLIC_URL).replace(/\/+$/, ''),
      };
    });
  }
}

export interface TenantPublicInfo {
  id: string;
  slug: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  domains: string[];
  appName: string;
  logoUrl: string | null;
  primaryColor: string;
  supportEmail: string | null;
  supportPhone: string | null;
  webUrl: string;
  adminUrl: string;
}

const SELECT = { id: true, slug: true, name: true, status: true, branding: true } as const;

function toInfo(tenant: { id: string; slug: string; name: string; status: 'ACTIVE' | 'SUSPENDED'; branding: unknown } | null) {
  return tenant ? { ...tenant, branding: (tenant.branding as Record<string, unknown> | null) ?? null } : null;
}
