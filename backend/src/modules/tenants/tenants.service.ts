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
}

const SELECT = { id: true, slug: true, name: true, status: true, branding: true } as const;

function toInfo(tenant: { id: string; slug: string; name: string; status: 'ACTIVE' | 'SUSPENDED'; branding: unknown } | null) {
  return tenant ? { ...tenant, branding: (tenant.branding as Record<string, unknown> | null) ?? null } : null;
}
