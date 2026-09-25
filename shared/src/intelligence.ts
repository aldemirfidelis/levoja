/** Inteligência (Fase 8): antifraude, previsões, anomalias e análise de avaliações. */

export const RISK_SIGNAL_LABELS = {
  SHARED_DEVICE: 'Várias contas no mesmo aparelho',
  COUPON_ABUSE: 'Cupom de primeira compra reutilizado',
  NEW_ACCOUNT_HIGH_VALUE: 'Conta nova com pedido de valor alto',
  ORDER_VELOCITY: 'Muitos pedidos em pouco tempo',
  PAYMENT_FAILURES: 'Pagamentos recusados em sequência',
  CARD_TESTING: 'Vários cartões em pouco tempo',
  MOCK_LOCATION: 'Localização simulada (GPS falso)',
  IMPOSSIBLE_SPEED: 'Deslocamento impossível no GPS',
  PROOF_FAR_FROM_DROPOFF: 'Conclusão longe do destino',
  ABNORMAL_CANCELLATIONS: 'Cancelamentos acima do normal',
  DRIVER_RELEASES: 'Desistências de entregas acima do normal',
  REFERRAL_ABUSE: 'Indicação suspeita (mesmo aparelho)',
  MANUAL: 'Registro manual da equipe',
} as const;
export type RiskSignalType = keyof typeof RISK_SIGNAL_LABELS;
export const RISK_SIGNAL_TYPES = Object.keys(RISK_SIGNAL_LABELS) as RiskSignalType[];

export const RISK_LEVEL_LABELS = { LOW: 'Baixo', MEDIUM: 'Médio', HIGH: 'Alto' } as const;
export type RiskLevel = keyof typeof RISK_LEVEL_LABELS;

export const RISK_CASE_STATUS_LABELS = { OPEN: 'Aberto', IN_REVIEW: 'Em análise', DISMISSED: 'Descartado', CONFIRMED: 'Fraude confirmada' } as const;
export type RiskCaseStatus = keyof typeof RISK_CASE_STATUS_LABELS;

export const ANOMALY_KIND_LABELS = {
  DEMAND_SPIKE: 'Demanda acima do previsto',
  DEMAND_DROP: 'Demanda abaixo do previsto',
  CANCELLATION_SPIKE: 'Pico de cancelamentos',
  PAYMENT_FAILURE_SPIKE: 'Pico de pagamentos recusados',
  DISPATCH_DELAY: 'Despacho mais lento que o normal',
} as const;
export type AnomalyKind = keyof typeof ANOMALY_KIND_LABELS;

export const ANOMALY_STATUS_LABELS = { OPEN: 'Aberta', ACKNOWLEDGED: 'Em acompanhamento', RESOLVED: 'Normalizada' } as const;
export type AnomalyStatus = keyof typeof ANOMALY_STATUS_LABELS;

export const SUGGESTION_STATUS_LABELS = { PENDING: 'Aguardando decisão', APPLIED: 'Aplicada', DISMISSED: 'Descartada', EXPIRED: 'Expirada' } as const;
export type SuggestionStatus = keyof typeof SUGGESTION_STATUS_LABELS;

export const REVIEW_SENTIMENT_LABELS = { POSITIVE: 'Positiva', NEUTRAL: 'Neutra', NEGATIVE: 'Negativa' } as const;
export type ReviewSentiment = keyof typeof REVIEW_SENTIMENT_LABELS;

/** Temas identificados nos comentários das avaliações (lista fechada: a IA só escolhe entre eles). */
export const REVIEW_THEME_LABELS = {
  delay: 'Atraso',
  speed: 'Rapidez',
  food_quality: 'Qualidade do produto',
  temperature: 'Temperatura (frio/quente)',
  packaging: 'Embalagem',
  missing_item: 'Item faltando ou errado',
  damaged: 'Produto danificado',
  courtesy: 'Educação e simpatia',
  rudeness: 'Falta de educação',
  price: 'Preço',
  communication: 'Comunicação',
  location: 'Local de entrega/coleta',
  app: 'Aplicativo',
} as const;
export type ReviewTheme = keyof typeof REVIEW_THEME_LABELS;
export const REVIEW_THEMES = Object.keys(REVIEW_THEME_LABELS) as ReviewTheme[];

/** Chave normalizada de cidade ("sao paulo/sp"): previsões, adicionais de preço e chuva por cidade. */
export function cityKey(city?: string | null, state?: string | null): string {
  const clean = (value?: string | null) =>
    (value ?? '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .toLowerCase();
  return `${clean(city)}/${clean(state)}`;
}

/** Faixas horárias usadas na calibração do tempo de entrega (hora local). */
export const ETA_BAND_LABELS = ['Madrugada (0h–6h)', 'Manhã (6h–11h)', 'Almoço (11h–14h)', 'Tarde (14h–18h)', 'Jantar (18h–22h)', 'Noite (22h–24h)'] as const;

export function etaBand(localHour: number): number {
  if (localHour < 6) return 0;
  if (localHour < 11) return 1;
  if (localHour < 14) return 2;
  if (localHour < 18) return 3;
  if (localHour < 22) return 4;
  return 5;
}

/** Recursos de IA registrados em AiInteraction. */
export const AI_FEATURE_LABELS = {
  SUPPORT_DRAFT: 'Rascunho de resposta (atendimento)',
  COMPANY_ASSISTANT: 'Assistente das empresas',
  REVIEW_ANALYSIS: 'Análise de avaliações',
} as const;
export type AiFeature = keyof typeof AI_FEATURE_LABELS;
