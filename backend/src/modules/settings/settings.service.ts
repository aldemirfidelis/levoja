import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { RISK_SIGNAL_TYPES, type RiskSignalType } from '@levoja/shared';
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
  'support.sla': {
    description: 'Atendimento: prazos (minutos) de primeira resposta e de resolução por prioridade',
    schema: z.record(
      z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
      z.object({ firstResponseMinutes: z.number().int().min(5).max(20_160), resolutionMinutes: z.number().int().min(15).max(43_200) }),
    ),
    default: {
      LOW: { firstResponseMinutes: 1440, resolutionMinutes: 4320 },
      MEDIUM: { firstResponseMinutes: 240, resolutionMinutes: 1440 },
      HIGH: { firstResponseMinutes: 60, resolutionMinutes: 480 },
      URGENT: { firstResponseMinutes: 15, resolutionMinutes: 120 },
    } as Record<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT', { firstResponseMinutes: number; resolutionMinutes: number }>,
  },
  chat: {
    description: 'Chat: por quanto tempo (minutos) as conversas seguem abertas após o fim do pedido/entrega',
    schema: z.object({ withStoreAfterMinutes: z.number().int().min(0).max(43_200), withDriverAfterMinutes: z.number().int().min(0).max(1440) }),
    default: { withStoreAfterMinutes: 1440, withDriverAfterMinutes: 60 },
  },
  operations: {
    description: 'Operação: fuso dos indicadores, tolerância de atraso, alertas da torre de controle e retenção das amostras',
    schema: z.object({
      timeZone: z.string().refine((value) => {
        try {
          new Intl.DateTimeFormat('pt-BR', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Fuso horário inválido'),
      /** Entrega avulsa: prazo prometido = início + duração estimada da rota + esta folga. */
      deliveryPromiseBufferMinutes: z.number().int().min(0).max(240),
      lateToleranceMinutes: z.number().int().min(0).max(120),
      stalledDispatchMinutes: z.number().int().min(1).max(120),
      staleLocationMinutes: z.number().int().min(1).max(60),
      acceptWarningMinutes: z.number().int().min(1).max(120),
      presenceRetentionDays: z.number().int().min(7).max(730),
    }),
    default: {
      timeZone: 'America/Sao_Paulo',
      deliveryPromiseBufferMinutes: 30,
      lateToleranceMinutes: 10,
      stalledDispatchMinutes: 5,
      staleLocationMinutes: 3,
      acceptWarningMinutes: 5,
      presenceRetentionDays: 180,
    },
  },
  b2b: {
    description: 'B2B: tamanho dos lotes, rotas (paradas por rota, trecho máximo, tempo por parada), antecedência e recorrências',
    schema: z.object({
      maxBatchItems: z.number().int().min(1).max(5000),
      maxStopsPerRoute: z.number().int().min(1).max(20),
      routeMaxLegKm: z.number().min(0.5).max(100),
      serviceMinutesPerStop: z.number().int().min(0).max(60),
      /** Rota sem entregador após este tempo é distribuída entrega a entrega. */
      routeFallbackMinutes: z.number().int().min(1).max(240),
      /** Antecedência mínima para lotes agendados. */
      batchLeadMinutes: z.number().int().min(0).max(1440),
      /** Com quantas horas de antecedência as ocorrências recorrentes viram entregas agendadas. */
      recurrenceHoursAhead: z.number().int().min(1).max(72),
    }),
    default: {
      maxBatchItems: 500,
      maxStopsPerRoute: 8,
      routeMaxLegKm: 8,
      serviceMinutesPerStop: 4,
      routeFallbackMinutes: 15,
      batchLeadMinutes: 60,
      recurrenceHoursAhead: 12,
    },
  },
  fraud: {
    description: 'Antifraude: pontos por sinal, meia-vida do score, limites de nível e de caso e ações automáticas (leves e reversíveis)',
    schema: z
      .object({
        enabled: z.boolean(),
        halfLifeDays: z.number().int().min(1).max(365),
        mediumScore: z.number().int().min(1).max(100),
        highScore: z.number().int().min(1).max(100),
        /** Score que abre um caso para revisão humana. */
        caseScore: z.number().int().min(1).max(100),
        points: z.record(z.enum(RISK_SIGNAL_TYPES as [RiskSignalType, ...RiskSignalType[]]), z.number().int().min(0).max(100)),
        maxAccountsPerDevice: z.number().int().min(1).max(20),
        newAccountDays: z.number().int().min(0).max(90),
        newAccountHighValueCents: z.number().int().min(0),
        maxOrdersPerHour: z.number().int().min(1).max(100),
        paymentFailuresPerDay: z.number().int().min(1).max(50),
        maxCardsPerDay: z.number().int().min(1).max(20),
        maxSpeedKmh: z.number().min(50).max(1000),
        cancellationZ: z.number().min(1).max(10),
        cancellationMinTotal: z.number().int().min(3).max(1000),
        /** Ações automáticas. OFF desliga a restrição de dinheiro na entrega. */
        denyCashAtLevel: z.enum(['OFF', 'MEDIUM', 'HIGH']),
        denyCashAboveCents: z.number().int().min(0),
        blockSharedFirstOrderCoupon: z.boolean(),
        rejectMockedProof: z.boolean(),
      })
      .refine((value) => value.mediumScore < value.highScore, { message: 'O limite médio deve ser menor que o alto.', path: ['mediumScore'] }),
    default: {
      enabled: true,
      halfLifeDays: 30,
      mediumScore: 30,
      highScore: 60,
      caseScore: 50,
      points: {
        SHARED_DEVICE: 20,
        COUPON_ABUSE: 30,
        NEW_ACCOUNT_HIGH_VALUE: 15,
        ORDER_VELOCITY: 15,
        PAYMENT_FAILURES: 20,
        CARD_TESTING: 35,
        MOCK_LOCATION: 40,
        IMPOSSIBLE_SPEED: 25,
        PROOF_FAR_FROM_DROPOFF: 15,
        ABNORMAL_CANCELLATIONS: 20,
        DRIVER_RELEASES: 15,
        MANUAL: 50,
      } as Record<RiskSignalType, number>,
      maxAccountsPerDevice: 2,
      newAccountDays: 3,
      newAccountHighValueCents: 30_000,
      maxOrdersPerHour: 6,
      paymentFailuresPerDay: 3,
      maxCardsPerDay: 3,
      maxSpeedKmh: 180,
      cancellationZ: 3,
      cancellationMinTotal: 5,
      denyCashAtLevel: 'HIGH' as 'OFF' | 'MEDIUM' | 'HIGH',
      denyCashAboveCents: 5_000,
      blockSharedFirstOrderCoupon: true,
      rejectMockedProof: true,
    },
  },
  intelligence: {
    description: 'Previsões e anomalias: semanas de histórico, horizonte, entregas por entregador/hora, limites de alerta, calibração do tempo de entrega e sugestões de preço',
    schema: z.object({
      forecastWeeks: z.number().int().min(2).max(12),
      horizonHours: z.number().int().min(6).max(168),
      deliveriesPerDriverHour: z.number().min(0.5).max(10),
      anomalyZ: z.number().min(1.5).max(10),
      anomalyMinVolume: z.number().int().min(1).max(1000),
      etaWindowDays: z.number().int().min(7).max(180),
      etaMinSamples: z.number().int().min(5).max(1000),
      suggestSurcharges: z.boolean(),
      /** Falta prevista (necessários ÷ esperados) a partir da qual uma sugestão de adicional é criada. */
      shortageRatio: z.number().min(1).max(5),
      maxSurchargeBps: z.number().int().min(0).max(10_000),
    }),
    default: {
      forecastWeeks: 6,
      horizonHours: 48,
      deliveriesPerDriverHour: 2,
      anomalyZ: 3,
      anomalyMinVolume: 5,
      etaWindowDays: 30,
      etaMinSamples: 20,
      suggestSurcharges: true,
      shortageRatio: 1.25,
      maxSurchargeBps: 3000,
    },
  },
  ai: {
    description: 'IA assistiva: recursos habilitados e limite de uso por pessoa por dia (provedor e chave ficam no ambiente do servidor)',
    schema: z.object({
      supportDrafts: z.boolean(),
      companyAssistant: z.boolean(),
      reviewAnalysis: z.boolean(),
      dailyLimitPerUser: z.number().int().min(0).max(1000),
    }),
    default: { supportDrafts: true, companyAssistant: true, reviewAnalysis: true, dailyLimitPerUser: 50 },
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
