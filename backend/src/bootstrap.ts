import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { Logger } from 'nestjs-pino';
import type Redis from 'ioredis';
import { AppConfig } from './config/config.module';
import { RequestContext } from './common/request-context';
import { REDIS } from './infra/redis/redis.module';
import { RedisIoAdapter } from './infra/redis/redis-io.adapter';

/**
 * Configuração HTTP compartilhada entre `main.ts` e os testes E2E,
 * garantindo que os testes exercitem exatamente o mesmo pipeline.
 */
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  const config = app.get(AppConfig);

  express.useLogger(app.get(Logger));
  express.set('trust proxy', config.env.TRUST_PROXY ? 1 : false);
  express.disable('x-powered-by');
  express.useBodyParser('json', { limit: '1mb' });

  // Contexto por requisição (requestId, IP) para logs e auditoria.
  app.use((request: any, response: any, next: () => void) => {
    const requestId = (request.headers['x-request-id'] as string) || request.id || randomUUID();
    response.setHeader('X-Request-Id', requestId);
    const device = request.headers['x-device-id'];
    const deviceId = typeof device === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(device) ? device : undefined;
    RequestContext.run({ requestId, ip: request.ip, userAgent: request.headers['user-agent']?.slice(0, 300), deviceId }, next);
  });

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(compression());
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Tenant', 'X-Request-Id', 'X-Device-Id', 'X-Api-Key'],
    exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
  });

  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    }),
  );
  app.enableShutdownHooks();

  // Com Redis, eventos em tempo real atravessam todas as instâncias da API.
  const redis = app.get<Redis | null>(REDIS, { strict: false });
  if (redis) app.useWebSocketAdapter(new RedisIoAdapter(app, redis));

  if (config.env.SWAGGER_ENABLED || !config.isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle(`${config.env.APP_NAME} API`)
        .setDescription(
          'API REST da plataforma de marketplace, delivery e logística sob demanda.\n\n' +
            'Autenticação: `Authorization: Bearer <accessToken>`. Tenant (white label): cabeçalho `X-Tenant`.\n' +
            'Valores monetários em centavos (inteiros). Datas em ISO 8601 (UTC).',
        )
        .setVersion('1.0')
        .addBearerAuth()
        .addGlobalParameters({ in: 'header', name: 'X-Tenant', required: false, schema: { type: 'string', example: 'levoja' } })
        .build(),
    );
    SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/openapi.json', customSiteTitle: 'LevoJá API' });
  }

  // Documentação da API pública (integrações das empresas com chave de API): sempre publicada.
  SwaggerModule.setup('docs/public', app, publicApiDocument(app, config), { jsonDocumentUrl: 'docs/public.json', customSiteTitle: `${config.env.APP_NAME} — API pública` });
}

const PUBLIC_API_GUIDE = [
  'API para integrar sistemas das empresas (ERP, e-commerce, PDV) à plataforma.',
  '',
  '**Autenticação:** cabeçalho `X-Api-Key: ljk_...` (chave criada no portal da empresa, em Integração). Cada rota exige um escopo',
  '(`catalog:read`, `catalog:write`, `orders:read`, `orders:write`, `deliveries:read`, `deliveries:write`) e o recurso correspondente no plano.',
  '',
  '**Limites:** chamadas por minuto conforme o plano. As respostas trazem `X-RateLimit-Limit`, `X-RateLimit-Remaining` e `X-RateLimit-Reset`; acima do limite, `429`.',
  '',
  '**Webhooks:** cadastre endpoints HTTPS no portal e escolha os eventos (`order.created`, `order.status_changed`, `delivery.created`,',
  '`delivery.status_changed`, `invoice.issued`, `subscription.invoice_created`). Cada envio traz `X-LevoJa-Event`, `X-LevoJa-Delivery` e',
  '`X-LevoJa-Signature: t=<unix>,v1=<hex>` — HMAC-SHA256 com o segredo do endpoint sobre `<t>.<corpo bruto>`. Rejeite assinaturas com mais de',
  '5 minutos e use o `id` do evento para ignorar repetições. Respostas fora de 2xx geram novas tentativas (1 min, 5 min, 30 min, 2 h, 6 h, 12 h).',
  '',
  '**Formatos:** valores em centavos (inteiros), datas em ISO 8601 (UTC), erros como `{ statusCode, error, message, details?, requestId }`.',
].join('\n');

/** Recorte da especificação com as rotas que aceitam chave de API (marcadas por @AllowApiKey). */
function publicApiDocument(app: INestApplication, config: AppConfig) {
  const full = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle(`${config.env.APP_NAME} — API pública`)
      .setDescription(PUBLIC_API_GUIDE)
      .setVersion('1.0')
      .addServer(`${config.env.API_PUBLIC_URL.replace(/\/+$/, '')}`)
      .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'api-key')
      .build(),
  );
  const paths: typeof full.paths = {};
  for (const [path, item] of Object.entries(full.paths)) {
    const kept = Object.fromEntries(
      Object.entries(item).filter(([, operation]) => typeof operation === 'object' && operation && Array.isArray((operation as { security?: unknown[] }).security) && (operation as { security: Record<string, unknown>[] }).security.some((entry) => 'api-key' in entry)),
    );
    if (Object.keys(kept).length) paths[path] = kept;
  }
  const tags = new Set(Object.values(paths).flatMap((item) => Object.values(item).flatMap((operation) => (operation as { tags?: string[] }).tags ?? [])));
  return { ...full, paths, tags: (full.tags ?? []).filter((tag) => tags.has(tag.name)) };
}
