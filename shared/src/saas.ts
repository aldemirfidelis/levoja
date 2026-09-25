/** Escala (Fase 9): planos SaaS, cidades, white label e API pública. */

/** Recursos que um plano pode liberar para a empresa. */
export const PLAN_FEATURE_LABELS = {
  catalog: 'Cadastro e catálogo de produtos',
  orders: 'Pedidos do marketplace',
  deliveries: 'Entregas avulsas solicitadas pela empresa',
  reports: 'Relatórios e indicadores',
  integrations: 'Integrações (API de entregas e webhooks)',
  api: 'API pública completa (catálogo e pedidos)',
  b2b: 'Corporativo: contratos, lotes, recorrências e faturamento',
  own_fleet: 'Frota própria',
  bi: 'BI e assistente inteligente',
  sla: 'Atendimento prioritário (SLA)',
  white_label: 'Marca própria (página com domínio e cores da empresa)',
} as const;
export type PlanFeature = keyof typeof PLAN_FEATURE_LABELS;
export const PLAN_FEATURES = Object.keys(PLAN_FEATURE_LABELS) as PlanFeature[];

/** Limites de uso por plano (null = sem limite). */
export const PLAN_LIMIT_LABELS = {
  maxProducts: 'Produtos no catálogo',
  maxUsers: 'Pessoas na equipe',
  maxApiKeys: 'Chaves de API ativas',
  maxLocations: 'Unidades (locais) cadastradas',
  apiRequestsPerMinute: 'Chamadas à API por minuto',
} as const;
export type PlanLimitKey = keyof typeof PLAN_LIMIT_LABELS;
export type PlanLimits = Record<PlanLimitKey, number | null>;
export const PLAN_LIMIT_KEYS = Object.keys(PLAN_LIMIT_LABELS) as PlanLimitKey[];

/** Planos criados para cada tenant novo (editáveis no painel). */
export const DEFAULT_PLANS: { key: string; name: string; description: string; priceCents: number; features: PlanFeature[]; limits: PlanLimits; trialDays: number; isDefault: boolean; sortOrder: number }[] = [
  {
    key: 'basico',
    name: 'Básico',
    description: 'Para começar a vender: cadastro, produtos e pedidos.',
    priceCents: 0,
    features: ['catalog', 'orders'],
    limits: { maxProducts: 100, maxUsers: 3, maxApiKeys: 0, maxLocations: 1, apiRequestsPerMinute: 0 },
    trialDays: 0,
    isDefault: true,
    sortOrder: 10,
  },
  {
    key: 'profissional',
    name: 'Profissional',
    description: 'Pedidos, entregas avulsas, relatórios e integrações.',
    priceCents: 14_900,
    features: ['catalog', 'orders', 'deliveries', 'reports', 'integrations'],
    limits: { maxProducts: 2000, maxUsers: 15, maxApiKeys: 5, maxLocations: 10, apiRequestsPerMinute: 120 },
    trialDays: 14,
    isDefault: false,
    sortOrder: 20,
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    description: 'API, corporativo (B2B), frota própria, BI, SLA e marca própria.',
    priceCents: 49_900,
    features: ['catalog', 'orders', 'deliveries', 'reports', 'integrations', 'api', 'b2b', 'own_fleet', 'bi', 'sla', 'white_label'],
    limits: { maxProducts: null, maxUsers: null, maxApiKeys: 20, maxLocations: null, apiRequestsPerMinute: 600 },
    trialDays: 14,
    isDefault: false,
    sortOrder: 30,
  },
];

export const SUBSCRIPTION_STATUS_LABELS = { TRIALING: 'Em teste', ACTIVE: 'Ativa', PAST_DUE: 'Em atraso', CANCELED: 'Cancelada' } as const;
export type SubscriptionStatus = keyof typeof SUBSCRIPTION_STATUS_LABELS;

export const SUBSCRIPTION_INVOICE_STATUS_LABELS = { OPEN: 'Em aberto', PAID: 'Paga', VOID: 'Anulada' } as const;
export type SubscriptionInvoiceStatus = keyof typeof SUBSCRIPTION_INVOICE_STATUS_LABELS;

export const CITY_STATUS_LABELS = { PREPARING: 'Em preparação', ACTIVE: 'Em operação', PAUSED: 'Pausada' } as const;
export type CityStatus = keyof typeof CITY_STATUS_LABELS;

export const WAITLIST_PROFILE_LABELS = { CUSTOMER: 'Cliente', COMPANY: 'Empresa', DRIVER: 'Entregador' } as const;
export type WaitlistProfile = keyof typeof WAITLIST_PROFILE_LABELS;

/** Eventos enviados por webhook (API pública). */
export const WEBHOOK_EVENT_LABELS = {
  'order.created': 'Pedido recebido',
  'order.status_changed': 'Pedido mudou de status',
  'delivery.created': 'Entrega criada',
  'delivery.status_changed': 'Entrega mudou de status',
  'invoice.issued': 'Fatura corporativa emitida',
  'subscription.invoice_created': 'Cobrança da assinatura gerada',
} as const;
export type WebhookEvent = keyof typeof WEBHOOK_EVENT_LABELS;
export const WEBHOOK_EVENTS = Object.keys(WEBHOOK_EVENT_LABELS) as WebhookEvent[];

export const WEBHOOK_DELIVERY_STATUS_LABELS = { PENDING: 'Aguardando', SUCCEEDED: 'Entregue', FAILED: 'Falhou' } as const;

/** Domínio válido para white label (sem protocolo, porta ou caminho). */
export function isValidDomain(value: string): boolean {
  return /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value.trim().toLowerCase());
}

/** Cor hexadecimal #RRGGBB. */
export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function mix(hex: string, target: [number, number, number], weight: number): string {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const mixed = channels.map((channel, index) => Math.round(channel + (target[index] - channel) * weight));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Escala de tons (50–900) a partir da cor da marca, usada no tema white label: o tom 500 é a
 * própria cor; os claros misturam branco e os escuros, preto.
 */
export function brandPalette(hex: string): Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, string> {
  const base = isHexColor(hex) ? hex.toLowerCase() : '#ff5a1f';
  const white: [number, number, number] = [255, 255, 255];
  const black: [number, number, number] = [0, 0, 0];
  return {
    50: mix(base, white, 0.94),
    100: mix(base, white, 0.86),
    200: mix(base, white, 0.7),
    300: mix(base, white, 0.5),
    400: mix(base, white, 0.22),
    500: base,
    600: mix(base, black, 0.12),
    700: mix(base, black, 0.28),
    800: mix(base, black, 0.42),
    900: mix(base, black, 0.55),
  };
}

/** Identidade visual do tenant (white label) exposta publicamente. */
export interface TenantBranding {
  appName: string;
  logoUrl: string | null;
  primaryColor: string;
  supportEmail: string | null;
  supportPhone: string | null;
}
