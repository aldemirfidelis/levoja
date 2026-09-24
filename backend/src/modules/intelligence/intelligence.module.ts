import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/config.module';
import { AiProvider, AnthropicAiProvider, DisabledAiProvider } from './ai/ai.provider';
import { AiService } from './ai/ai.service';
import { AnomalyService } from './anomaly.service';
import { CompanyAssistantService } from './company-assistant.service';
import { EtaService } from './eta.service';
import { ForecastService } from './forecast.service';
import { FraudService } from './fraud.service';
import { CompanyAssistantController, FraudController, IntelligenceController } from './intelligence.controller';
import { ReviewInsightsService } from './review-insights.service';
import { SupportAssistService } from './support-assist.service';
import { SurchargesService } from './surcharges.service';

/**
 * Inteligência (Fase 8): antifraude com score configurável e revisão humana, previsão de demanda
 * e de entregadores, calibração do tempo de entrega, anomalias operacionais, sugestões de preço
 * (aplicadas só com aprovação) e IA assistiva (atendimento, avaliações e assistente das lojas).
 */
@Module({
  controllers: [FraudController, IntelligenceController, CompanyAssistantController],
  providers: [
    {
      provide: AiProvider,
      inject: [AppConfig],
      useFactory: (config: AppConfig): AiProvider =>
        config.env.AI_PROVIDER === 'anthropic' && config.env.ANTHROPIC_API_KEY
          ? new AnthropicAiProvider(config.env.ANTHROPIC_API_KEY, config.env.AI_MODEL, config.env.AI_TIMEOUT_MS)
          : new DisabledAiProvider(),
    },
    AiService,
    FraudService,
    ForecastService,
    EtaService,
    AnomalyService,
    SurchargesService,
    ReviewInsightsService,
    SupportAssistService,
    CompanyAssistantService,
  ],
  exports: [FraudService, ForecastService, EtaService, AiService],
})
export class IntelligenceModule {}
