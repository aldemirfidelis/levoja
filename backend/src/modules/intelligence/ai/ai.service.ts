import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { AiFeature } from '@levoja/shared';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { AiOutcome, AiProvider } from './ai.provider';

const FEATURE_FLAG = { SUPPORT_DRAFT: 'supportDrafts', COMPANY_ASSISTANT: 'companyAssistant', REVIEW_ANALYSIS: 'reviewAnalysis' } as const;

export interface AiContext {
  tenantId: string;
  feature: AiFeature;
  userId?: string | null;
  companyId?: string | null;
}

/**
 * Porta de entrada da IA: respeita os recursos habilitados e o limite diário por pessoa, e
 * registra cada chamada (AiInteraction) para auditoria, custo e supervisão.
 */
@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    readonly provider: AiProvider,
  ) {}

  /** O modelo pode ser usado neste recurso (provedor configurado e recurso ligado)? */
  async enabled(tenantId: string, feature: AiFeature): Promise<boolean> {
    if (!this.provider.available) return false;
    const config = await this.settings.get(tenantId, 'ai');
    return config[FEATURE_FLAG[feature]];
  }

  async run<T>(context: AiContext, call: (provider: AiProvider) => Promise<AiOutcome<T>>): Promise<AiOutcome<T>> {
    if (context.userId) {
      const { dailyLimitPerUser } = await this.settings.get(context.tenantId, 'ai');
      const since = new Date(Date.now() - 86_400_000);
      const used = await this.prisma.aiInteraction.count({ where: { userId: context.userId, createdAt: { gte: since } } });
      if (used >= dailyLimitPerUser) throw new HttpException('Limite diário de uso da IA atingido. Tente novamente amanhã.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const started = Date.now();
    const outcome = await call(this.provider);
    await this.prisma.aiInteraction.create({
      data: {
        tenantId: context.tenantId,
        userId: context.userId ?? null,
        companyId: context.companyId ?? null,
        feature: context.feature,
        provider: this.provider.name,
        model: outcome.usage?.model ?? this.provider.model,
        status: outcome.status,
        inputTokens: outcome.usage?.inputTokens ?? 0,
        outputTokens: outcome.usage?.outputTokens ?? 0,
        latencyMs: Date.now() - started,
        error: outcome.status === 'ERROR' ? outcome.error.slice(0, 500) : null,
      },
    });
    return outcome;
  }

  /** Situação da IA e uso nos últimos 30 dias (painel). */
  async status(tenantId: string) {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [config, usage] = await Promise.all([
      this.settings.get(tenantId, 'ai'),
      this.prisma.aiInteraction.groupBy({
        by: ['feature', 'status'],
        where: { tenantId, createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true },
        _avg: { latencyMs: true },
      }),
    ]);
    return {
      provider: this.provider.name,
      model: this.provider.model,
      available: this.provider.available,
      features: config,
      usage: usage.map((row) => ({
        feature: row.feature,
        status: row.status,
        calls: row._count._all,
        inputTokens: row._sum.inputTokens ?? 0,
        outputTokens: row._sum.outputTokens ?? 0,
        avgLatencyMs: Math.round(row._avg.latencyMs ?? 0),
      })),
    };
  }
}
