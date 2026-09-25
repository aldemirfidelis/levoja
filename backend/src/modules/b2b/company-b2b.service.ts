import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { API_KEY_SCOPES, type ApiKeyScope } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { AuditService, diff } from '../audit/audit.service';
import { AccessService } from '../access/access.service';
import { MapsService } from '../geo/maps.service';
import { toAuthUser, type AuthUser } from '../../common/auth/auth-user';
import { ContractsService } from './contracts.service';
import { SubscriptionsService } from '../saas/subscriptions.service';
import { CacheService } from '../../infra/cache/cache.service';

export interface CostCenterInput {
  code: string;
  name: string;
  monthlyBudgetCents?: number | null;
  isActive?: boolean;
}

export interface LocationInput {
  name: string;
  isUnit?: boolean;
  contactName?: string | null;
  contactPhone?: string | null;
  zipCode?: string | null;
  street: string;
  number: string;
  complement?: string | null;
  district?: string | null;
  city: string;
  state: string;
  reference?: string | null;
  lat?: number | null;
  lng?: number | null;
  isActive?: boolean;
}

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Cadastros corporativos da empresa: centros de custo, unidades/locais e chaves de API. */
@Injectable()
export class CompanyB2bService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly maps: MapsService,
    private readonly contracts: ContractsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly cache: CacheService,
  ) {}

  private async tenantOf(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { tenantId: true } });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    return company.tenantId;
  }

  // ---------------------------------------------------------------------------
  // Centros de custo
  // ---------------------------------------------------------------------------

  async listCostCenters(companyId: string) {
    const tenantId = await this.tenantOf(companyId);
    const centers = await this.prisma.costCenter.findMany({ where: { companyId }, orderBy: [{ isActive: 'desc' }, { code: 'asc' }] });
    const spent = await Promise.all(centers.map((center) => (center.isActive ? this.contracts.monthSpend(center.id, tenantId) : Promise.resolve(0))));
    return centers.map((center, index) => ({
      id: center.id,
      code: center.code,
      name: center.name,
      monthlyBudgetCents: center.monthlyBudgetCents,
      isActive: center.isActive,
      spentThisMonthCents: spent[index],
      availableThisMonthCents: center.monthlyBudgetCents == null ? null : Math.max(0, center.monthlyBudgetCents - spent[index]),
    }));
  }

  async createCostCenter(user: AuthUser, companyId: string, input: CostCenterInput) {
    const tenantId = await this.tenantOf(companyId);
    const code = input.code.trim().toUpperCase();
    const exists = await this.prisma.costCenter.findUnique({ where: { companyId_code: { companyId, code } } });
    if (exists) throw new ConflictException(`Já existe o centro de custo ${code}.`);
    const center = await this.prisma.costCenter.create({ data: { tenantId, companyId, code, name: input.name.trim(), monthlyBudgetCents: input.monthlyBudgetCents ?? null } });
    await this.audit.log({ action: 'b2b.cost_center.create', entityType: 'CostCenter', entityId: center.id, after: { code, name: center.name, monthlyBudgetCents: center.monthlyBudgetCents } });
    return center;
  }

  async updateCostCenter(user: AuthUser, companyId: string, id: string, input: Partial<CostCenterInput>) {
    const center = await this.prisma.costCenter.findFirst({ where: { id, companyId } });
    if (!center) throw new NotFoundException('Centro de custo não encontrado.');
    const updated = await this.prisma.costCenter.update({
      where: { id },
      data: { name: input.name?.trim(), monthlyBudgetCents: input.monthlyBudgetCents === undefined ? undefined : input.monthlyBudgetCents, isActive: input.isActive },
    });
    await this.audit.log({ action: 'b2b.cost_center.update', entityType: 'CostCenter', entityId: id, ...diff(center, updated) });
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Unidades e locais
  // ---------------------------------------------------------------------------

  listLocations(companyId: string, includeInactive = false) {
    return this.prisma.companyLocation.findMany({ where: { companyId, ...(includeInactive ? {} : { isActive: true }) }, orderBy: [{ isUnit: 'desc' }, { name: 'asc' }] });
  }

  private async locate(input: LocationInput): Promise<{ lat: number; lng: number }> {
    if (input.lat != null && input.lng != null) return { lat: input.lat, lng: input.lng };
    const point = await this.maps.geocode({ street: input.street, number: input.number, district: input.district ?? undefined, city: input.city, state: input.state, zipCode: input.zipCode ?? undefined });
    if (!point) throw new UnprocessableEntityException('Não conseguimos localizar o endereço no mapa. Informe a latitude e a longitude.');
    return point;
  }

  async createLocation(user: AuthUser, companyId: string, input: LocationInput) {
    const tenantId = await this.tenantOf(companyId);
    await this.subscriptions.assertLimit(tenantId, companyId, 'maxLocations', await this.prisma.companyLocation.count({ where: { companyId, isActive: true } }));
    const point = await this.locate(input);
    const location = await this.prisma.companyLocation.create({
      data: {
        tenantId,
        companyId,
        name: input.name.trim(),
        isUnit: input.isUnit ?? true,
        contactName: input.contactName?.trim() || null,
        contactPhone: input.contactPhone?.replace(/\D/g, '') || null,
        zipCode: input.zipCode?.replace(/\D/g, '') || null,
        street: input.street.trim(),
        number: input.number.trim(),
        complement: input.complement?.trim() || null,
        district: input.district?.trim() || null,
        city: input.city.trim(),
        state: input.state.trim().toUpperCase(),
        reference: input.reference?.trim() || null,
        ...point,
      },
    });
    await this.audit.log({ action: 'b2b.location.create', entityType: 'CompanyLocation', entityId: location.id, after: { name: location.name, city: location.city } });
    return location;
  }

  async updateLocation(user: AuthUser, companyId: string, id: string, input: Partial<LocationInput>) {
    const location = await this.prisma.companyLocation.findFirst({ where: { id, companyId } });
    if (!location) throw new NotFoundException('Local não encontrado.');
    const addressChanged = ['street', 'number', 'city', 'state', 'district', 'zipCode'].some((key) => input[key as keyof LocationInput] !== undefined);
    const point =
      input.lat != null && input.lng != null
        ? { lat: input.lat, lng: input.lng }
        : addressChanged
          ? await this.locate({ ...location, ...input } as LocationInput & { lat: null; lng: null })
          : {};
    const updated = await this.prisma.companyLocation.update({
      where: { id },
      data: {
        name: input.name?.trim(),
        isUnit: input.isUnit,
        contactName: input.contactName === undefined ? undefined : input.contactName?.trim() || null,
        contactPhone: input.contactPhone === undefined ? undefined : input.contactPhone?.replace(/\D/g, '') || null,
        zipCode: input.zipCode === undefined ? undefined : input.zipCode?.replace(/\D/g, '') || null,
        street: input.street?.trim(),
        number: input.number?.trim(),
        complement: input.complement === undefined ? undefined : input.complement?.trim() || null,
        district: input.district === undefined ? undefined : input.district?.trim() || null,
        city: input.city?.trim(),
        state: input.state?.trim().toUpperCase(),
        reference: input.reference === undefined ? undefined : input.reference?.trim() || null,
        isActive: input.isActive,
        ...point,
      },
    });
    await this.audit.log({ action: 'b2b.location.update', entityType: 'CompanyLocation', entityId: id, ...diff(location, updated) });
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Chaves de API
  // ---------------------------------------------------------------------------

  async listApiKeys(companyId: string) {
    const keys = await this.prisma.companyApiKey.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
    const creators = await this.prisma.user.findMany({ where: { id: { in: [...new Set(keys.map((key) => key.createdById))] } }, select: { id: true, name: true } });
    const nameOf = new Map(creators.map((creator) => [creator.id, creator.name]));
    return keys.map((key) => ({
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      scopes: key.scopes,
      createdBy: nameOf.get(key.createdById) ?? '—',
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
      revokedAt: key.revokedAt,
      active: !key.revokedAt && (!key.expiresAt || key.expiresAt > new Date()),
    }));
  }

  /** Cria a chave (o segredo é devolvido uma única vez). Os escopos exigem as permissões de quem cria. */
  async createApiKey(user: AuthUser, companyId: string, input: { name: string; scopes: ApiKeyScope[]; expiresInDays?: number | null }) {
    if (user.apiKeyId) throw new ForbiddenException('Chaves de API não podem criar outras chaves.');
    const tenantId = await this.tenantOf(companyId);
    const scopes = [...new Set(input.scopes)];
    if (!scopes.length) throw new BadRequestException('Escolha ao menos um escopo.');
    for (const scope of scopes) {
      const definition = API_KEY_SCOPES[scope];
      if (!definition) throw new BadRequestException(`Escopo inválido: ${scope}.`);
      if (!user.canInCompany(companyId, definition.permission)) throw new ForbiddenException(`Você não tem a permissão exigida pelo escopo "${definition.label}".`);
    }
    for (const scope of scopes) await this.subscriptions.assertFeature(tenantId, companyId, API_KEY_SCOPES[scope].feature);
    const active = await this.prisma.companyApiKey.count({ where: { companyId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    await this.subscriptions.assertLimit(tenantId, companyId, 'maxApiKeys', active);
    if (active >= 20) throw new ConflictException('Limite de 20 chaves ativas. Revogue as que não usa mais.');
    const secret = Array.from({ length: 40 }, () => KEY_ALPHABET[randomInt(KEY_ALPHABET.length)]).join('');
    const key = `ljk_${secret}`;
    const record = await this.prisma.companyApiKey.create({
      data: {
        tenantId,
        companyId,
        name: input.name.trim(),
        prefix: key.slice(0, 12),
        keyHash: this.crypto.blindIndex(key),
        scopes,
        createdById: user.userId,
        expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null,
      },
    });
    await this.audit.log({ action: 'b2b.api_key.create', entityType: 'CompanyApiKey', entityId: record.id, after: { name: record.name, prefix: record.prefix, scopes } });
    return { id: record.id, name: record.name, prefix: record.prefix, scopes, expiresAt: record.expiresAt, key };
  }

  async revokeApiKey(user: AuthUser, companyId: string, id: string) {
    const updated = await this.prisma.companyApiKey.updateMany({ where: { id, companyId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!updated.count) throw new NotFoundException('Chave não encontrada ou já revogada.');
    await this.audit.log({ action: 'b2b.api_key.revoke', entityType: 'CompanyApiKey', entityId: id });
  }

  /**
   * Autoriza uma chamada da API pública: chave válida, com o escopo exigido pela rota, recurso do
   * plano da empresa e limite de chamadas por minuto do plano (janela fixa de 60 s por chave).
   */
  async authorize(rawKey: string, scope: ApiKeyScope, onIdentified?: (user: AuthUser) => void): Promise<{ user: AuthUser; rate: { limit: number; remaining: number; resetSeconds: number } | null }> {
    const user = await this.authenticate(rawKey);
    onIdentified?.(user);
    const key = await this.prisma.companyApiKey.findUniqueOrThrow({ where: { id: user.apiKeyId! }, select: { id: true, scopes: true, companyId: true, tenantId: true } });
    if (!key.scopes.includes(scope)) throw new ForbiddenException(`Esta chave não tem o escopo "${scope}" (${API_KEY_SCOPES[scope].label.toLowerCase()}).`);
    await this.subscriptions.assertFeature(key.tenantId, key.companyId, API_KEY_SCOPES[scope].feature);
    const { limits } = await this.subscriptions.effective(key.tenantId, key.companyId);
    const limit = limits.apiRequestsPerMinute;
    if (limit == null) return { user, rate: null };
    const window = Math.floor(Date.now() / 60_000);
    const used = await this.cache.increment(`apirate:${key.id}:${window}`, 70);
    const resetSeconds = 60 - Math.floor((Date.now() / 1000) % 60);
    if (used > limit) {
      throw new HttpException({ message: `Limite de ${limit} chamadas por minuto do plano atingido. Tente novamente em ${resetSeconds} s.`, details: { limit, resetSeconds } }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return { user, rate: { limit, remaining: Math.max(0, limit - used), resetSeconds } };
  }

  /** Registra a chamada feita com a chave (inclusive recusas por escopo, plano ou limite) quando a resposta termina. */
  trackUsage(request: { method: string; originalUrl?: string; url: string; route?: { path?: string } }, response: { statusCode: number; once(event: 'finish', listener: () => void): unknown }, user: AuthUser) {
    const companyId = user.companies[0]?.companyId;
    if (!companyId || !user.apiKeyId) return;
    const started = Date.now();
    response.once('finish', () => {
      const path = request.route?.path ?? String(request.originalUrl ?? request.url).split('?')[0];
      void this.prisma.apiRequestLog
        .create({ data: { tenantId: user.tenantId, companyId, apiKeyId: user.apiKeyId!, method: request.method, path: path.slice(0, 200), status: response.statusCode, durationMs: Date.now() - started } })
        .catch(() => undefined);
    });
  }

  /**
   * Autentica uma chave de API: age em nome de quem a criou, restrita à empresa e aos escopos
   * (interseção com as permissões atuais dessa pessoa — perder o acesso invalida a chave).
   */
  async authenticate(rawKey: string): Promise<AuthUser> {
    if (!/^ljk_[A-Za-z0-9]{40}$/.test(rawKey)) throw new UnauthorizedException('Chave de API inválida.');
    const key = await this.prisma.companyApiKey.findUnique({ where: { keyHash: this.crypto.blindIndex(rawKey) }, include: { company: { select: { status: true } } } });
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt < new Date())) throw new UnauthorizedException('Chave de API inválida, expirada ou revogada.');
    if (key.company.status !== 'APPROVED') throw new ForbiddenException('Empresa sem acesso à integração.');
    const profile = await this.access.getProfile(key.createdById);
    const membership = profile?.status === 'ACTIVE' ? profile.companies.find((company) => company.companyId === key.companyId) : undefined;
    if (!profile || !membership) throw new UnauthorizedException('Chave de API sem vínculo ativo com a empresa. Gere uma nova chave.');
    const permissions = key.scopes
      .map((scope) => API_KEY_SCOPES[scope as ApiKeyScope]?.permission)
      .filter((permission): permission is (typeof API_KEY_SCOPES)[ApiKeyScope]['permission'] => !!permission && membership.permissions.includes(permission));
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 5 * 60_000) {
      await this.prisma.companyApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    }
    const user = toAuthUser(
      {
        userId: profile.userId,
        tenantId: profile.tenantId,
        status: 'ACTIVE',
        roles: [],
        permissions: [],
        isStaff: false,
        customerId: null,
        driverId: null,
        companies: [{ companyId: key.companyId, roleKey: 'api_key', permissions: [...new Set(permissions)] }],
      },
      `apikey:${key.id}`,
    );
    return { ...user, apiKeyId: key.id };
  }
}
