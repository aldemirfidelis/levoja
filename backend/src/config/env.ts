import { z } from 'zod';

/**
 * Todas as variáveis de ambiente são validadas na inicialização.
 * Segredos NUNCA têm valor padrão em produção.
 */
const bool = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((value) => value === 'true' || value === '1');

const base64Key32 = z
  .string()
  .refine((value) => Buffer.from(value, 'base64').length === 32, 'deve ser uma chave de 32 bytes em base64');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3333),
    APP_NAME: z.string().default('LevoJá'),
    /** URL pública da API (links em e-mails, webhooks). */
    API_PUBLIC_URL: z.string().url().default('http://localhost:3333'),
    /** URL do portal web (links de redefinição de senha, convites). */
    WEB_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
    ADMIN_PUBLIC_URL: z.string().url().default('http://localhost:3001'),
    CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),
    TRUST_PROXY: bool,
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    LOG_PRETTY: bool,

    DATABASE_URL: z.string().min(1),
    /** Opcional: sem Redis, cache/filas/rate limit funcionam em memória (somente 1 instância). */
    REDIS_URL: z.string().optional(),

    DEFAULT_TENANT_SLUG: z.string().default('levoja'),

    JWT_ACCESS_SECRET: z.string().min(32, 'mínimo de 32 caracteres'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    /** Chave AES-256-GCM (base64, 32 bytes) para dados sensíveis. */
    DATA_ENCRYPTION_KEY: base64Key32,
    /** Chave HMAC (base64, 32 bytes) para índices cegos (busca por CPF sem expor o valor). */
    DATA_HASH_KEY: base64Key32,

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_PATH: z.string().default('./storage'),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool,
    /** Base pública para arquivos públicos (logos, fotos). Se vazio, a API serve os arquivos. */
    PUBLIC_FILES_BASE_URL: z.string().optional(),

    MAIL_DRIVER: z.enum(['log', 'smtp']).default('log'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_SECURE: bool,
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().default('LevoJá <nao-responda@levoja.local>'),

    SMS_DRIVER: z.enum(['log']).default('log'),
    PUSH_DRIVER: z.enum(['log', 'expo']).default('log'),
    EXPO_ACCESS_TOKEN: z.string().optional(),

    /** Rotas: haversine (estimativa, dev) ou osrm (OSRM_URL). */
    MAPS_PROVIDER: z.enum(['haversine', 'osrm']).default('haversine'),
    OSRM_URL: z.string().url().optional(),
    /** Geocodificação de endereços: none (usa coordenadas do app) ou nominatim. */
    GEOCODER: z.enum(['none', 'nominatim']).default('none'),
    NOMINATIM_URL: z.string().url().default('https://nominatim.openstreetmap.org'),

    /**
     * Pagamentos online: none (apenas dinheiro), sandbox (simulado, somente fora de produção)
     * ou mercadopago.
     */
    PAYMENT_GATEWAY: z.enum(['none', 'sandbox', 'mercadopago']).default('none'),
    MERCADOPAGO_ACCESS_TOKEN: z.string().optional(),
    MERCADOPAGO_WEBHOOK_SECRET: z.string().optional(),
    /** Chave pública (tokenização do cartão no app/portal; o número do cartão nunca chega à API). */
    MERCADOPAGO_PUBLIC_KEY: z.string().optional(),
    /**
     * Saques: manual (a equipe financeira transfere e confirma no painel) ou sandbox
     * (transferência simulada, somente fora de produção).
     */
    PAYOUT_PROVIDER: z.enum(['manual', 'sandbox']).default('manual'),
    MERCHANT_CITY: z.string().default('SAO PAULO'),

    /** Ligação mascarada entre cliente, loja e entregador: none (desativada) ou twilio (ponte telefônica). */
    VOICE_PROVIDER: z.enum(['none', 'twilio']).default('none'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    /** Número da plataforma em E.164 (ex.: +551130000000), exibido nas duas pontas da ligação. */
    TWILIO_CALLER_ID: z.string().regex(/^\+\d{10,15}$/).optional(),

    /**
     * IA assistiva (rascunhos de atendimento, assistente das empresas, análise de avaliações):
     * none (recursos determinísticos, sem modelo de linguagem) ou anthropic (ANTHROPIC_API_KEY).
     * A IA nunca executa ações críticas: sugere e a equipe decide.
     */
    AI_PROVIDER: z.enum(['none', 'anthropic']).default('none'),
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_MODEL: z.string().min(3).default('claude-opus-5'),
    AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(90_000),

    /**
     * Webhooks para endereços internos (localhost, rede privada) e sem HTTPS — somente para
     * desenvolvimento e testes. Em produção os webhooks exigem HTTPS e IP público.
     */
    WEBHOOK_ALLOW_PRIVATE_URLS: bool,

    /** Token opcional exigido em /metrics (Authorization: Bearer ...). */
    METRICS_TOKEN: z.string().optional(),
    SWAGGER_ENABLED: bool,

    RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    MAX_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'obrigatório quando STORAGE_DRIVER=s3' });
      }
    }
    if (env.PAYMENT_GATEWAY === 'mercadopago' && !env.MERCADOPAGO_ACCESS_TOKEN) {
      ctx.addIssue({ code: 'custom', path: ['MERCADOPAGO_ACCESS_TOKEN'], message: 'obrigatório quando PAYMENT_GATEWAY=mercadopago' });
    }
    if (env.VOICE_PROVIDER === 'twilio') {
      for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_CALLER_ID'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'obrigatório quando VOICE_PROVIDER=twilio' });
      }
    }
    if (env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['ANTHROPIC_API_KEY'], message: 'obrigatório quando AI_PROVIDER=anthropic' });
    }
    if (env.MAIL_DRIVER === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'obrigatório quando MAIL_DRIVER=smtp' });
    }
    if (env.NODE_ENV === 'production') {
      if (env.STORAGE_DRIVER === 'local') {
        ctx.addIssue({ code: 'custom', path: ['STORAGE_DRIVER'], message: 'use s3 em produção' });
      }
      if (!env.REDIS_URL) {
        ctx.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'obrigatório em produção' });
      }
      if (env.PAYMENT_GATEWAY === 'sandbox') {
        ctx.addIssue({ code: 'custom', path: ['PAYMENT_GATEWAY'], message: 'sandbox não é permitido em produção (use none ou mercadopago)' });
      }
      if (env.WEBHOOK_ALLOW_PRIVATE_URLS) {
        ctx.addIssue({ code: 'custom', path: ['WEBHOOK_ALLOW_PRIVATE_URLS'], message: 'não é permitido em produção' });
      }
      if (env.PAYOUT_PROVIDER === 'sandbox') {
        ctx.addIssue({ code: 'custom', path: ['PAYOUT_PROVIDER'], message: 'sandbox não é permitido em produção (use manual)' });
      }
      if (env.PAYMENT_GATEWAY === 'mercadopago' && !env.MERCADOPAGO_WEBHOOK_SECRET) {
        ctx.addIssue({ code: 'custom', path: ['MERCADOPAGO_WEBHOOK_SECRET'], message: 'obrigatório em produção (validação dos webhooks)' });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  return parsed.data;
}
