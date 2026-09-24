import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CacheService } from '../../infra/cache/cache.service';
import { AuditService } from '../audit/audit.service';
import { Prisma } from '../../generated/prisma/client';

/**
 * Configurações da plataforma por tenant, com schema e valor padrão.
 * Adicionar uma chave aqui a torna editável pelo painel (settings.manage).
 */
export const SETTINGS = {
  'marketplace.serviceFee': {
    description: 'Taxa de serviço cobrada do cliente por pedido',
    schema: z.object({ bps: z.number().int().min(0).max(3000), minCents: z.number().int().min(0), maxCents: z.number().int().min(0).nullable() }),
    default: { bps: 0, minCents: 0, maxCents: null as number | null },
  },
  'marketplace.defaultRadiusKm': {
    description: 'Raio de atendimento padrão (km) para empresas sem área configurada',
    schema: z.number().min(0.5).max(100),
    default: 5,
  },
  'marketplace.acceptTimeoutMinutes': {
    description: 'Minutos para a loja aceitar um pedido novo antes do cancelamento automático',
    schema: z.number().int().min(2).max(120),
    default: 10,
  },
  dispatch: {
    description: 'Despacho: raio de busca, tempo da oferta, novas tentativas, multipedidos e geofence',
    schema: z.object({
      initialRadiusKm: z.number().min(0.5).max(50),
      radiusStepKm: z.number().min(0.5).max(20),
      maxRadiusKm: z.number().min(1).max(100),
      offerTimeoutSeconds: z.number().int().min(10).max(300),
      retryDelaySeconds: z.number().int().min(5).max(600),
      maxSearchMinutes: z.number().int().min(1).max(240),
      maxConcurrentDeliveries: z.number().int().min(1).max(5),
      batchPickupRadiusKm: z.number().min(0).max(5),
      locationFreshSeconds: z.number().int().min(30).max(900),
      geofenceMeters: z.number().int().min(30).max(1000),
      proofMaxDistanceMeters: z.number().int().min(50).max(5000),
    }),
    default: {
      initialRadiusKm: 3,
      radiusStepKm: 3,
      maxRadiusKm: 12,
      offerTimeoutSeconds: 30,
      retryDelaySeconds: 20,
      maxSearchMinutes: 30,
      maxConcurrentDeliveries: 2,
      batchPickupRadiusKm: 0.5,
      locationFreshSeconds: 180,
      geofenceMeters: 150,
      proofMaxDistanceMeters: 500,
    },
  },
  'dispatch.scheduling': {
    description: 'Entregas agendadas: antecedência do despacho e capacidade por janela de 30 minutos',
    schema: z.object({ leadMinutes: z.number().int().min(5).max(180), slotCapacity: z.number().int().min(1).max(10_000) }),
    default: { leadMinutes: 20, slotCapacity: 30 },
  },
  finance: {
    description: 'Financeiro: liberação de saldos, saques e validade do PIX',
    schema: z.object({
      companyReleaseDays: z.number().int().min(0).max(60),
      driverReleaseHours: z.number().int().min(0).max(720),
      minWithdrawalCents: z.number().int().min(0),
      withdrawalFeeCents: z.number().int().min(0),
      autoApproveWithdrawalsUpToCents: z.number().int().min(0),
      pixExpirationMinutes: z.number().int().min(5).max(1440),
      maxDriverCashDebtCents: z.number().int().min(0),
      /** Carência para saques após a TROCA da chave PIX (antifraude contra invasão de conta). */
      pixKeyChangeHoldHours: z.number().int().min(0).max(720).default(24),
    }),
    default: {
      companyReleaseDays: 1,
      driverReleaseHours: 0,
      minWithdrawalCents: 1000,
      withdrawalFeeCents: 0,
      autoApproveWithdrawalsUpToCents: 0,
      pixExpirationMinutes: 15,
      maxDriverCashDebtCents: 30_000,
      pixKeyChangeHoldHours: 24,
    },
  },
  'ops.rainCities': {
    description: 'Cidades com adicional de chuva ativo ("cidade/uf" em minúsculas)',
    schema: z.array(z.string().min(3)).max(500),
    default: [] as string[],
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;

const TTL = 60;

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
  ) {}

  async get<K extends SettingKey>(tenantId: string, key: K): Promise<SettingValue<K>> {
    return this.cache.wrap(`setting:${tenantId}:${key}`, TTL, async () => {
      const row = await this.prisma.platformSetting.findUnique({ where: { tenantId_key: { tenantId, key } } });
      const parsed = SETTINGS[key].schema.safeParse(row?.value);
      return (parsed.success ? parsed.data : SETTINGS[key].default) as SettingValue<K>;
    });
  }

  async list(tenantId: string) {
    const rows = await this.prisma.platformSetting.findMany({ where: { tenantId } });
    const stored = new Map(rows.map((row) => [row.key, row]));
    return (Object.keys(SETTINGS) as SettingKey[]).map((key) => ({
      key,
      description: SETTINGS[key].description,
      value: stored.get(key)?.value ?? SETTINGS[key].default,
      isDefault: !stored.has(key),
      updatedAt: stored.get(key)?.updatedAt ?? null,
    }));
  }

  async set(tenantId: string, key: string, value: unknown, actorId: string) {
    if (!(key in SETTINGS)) throw new NotFoundException('Configuração desconhecida.');
    const definition = SETTINGS[key as SettingKey];
    const parsed = definition.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Valor inválido.', details: parsed.error.issues.map((issue) => `${issue.path.join('.') || key}: ${issue.message}`) });
    }
    const before = await this.get(tenantId, key as SettingKey);
    await this.prisma.platformSetting.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, value: parsed.data as Prisma.InputJsonValue, updatedById: actorId },
      update: { value: parsed.data as Prisma.InputJsonValue, updatedById: actorId },
    });
    await this.cache.del(`setting:${tenantId}:${key}`);
    await this.audit.log({ action: 'setting.update', entityType: 'PlatformSetting', entityId: key, before: { value: before }, after: { value: parsed.data } });
    return parsed.data;
  }
}
