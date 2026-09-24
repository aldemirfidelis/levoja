/**
 * Ambiente de testes: isolado do desenvolvimento (banco `levoja_test`, arquivos em .test-storage,
 * e-mail/push em memória, limites de requisição altos).
 *
 * As chaves são FIXAS e exclusivas de teste: todos os arquivos de teste compartilham o mesmo
 * banco, então precisam decifrar os dados uns dos outros. Nunca use estes valores fora de testes.
 */
import { testDatabaseUrl } from './test-db';

const testKey = (fill: number) => Buffer.alloc(32, fill).toString('base64');

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  LOG_PRETTY: 'false',
  DATABASE_URL: testDatabaseUrl(),
  JWT_ACCESS_SECRET: 'segredo-exclusivo-de-teste-nao-usar-em-producao-0123456789',
  DATA_ENCRYPTION_KEY: testKey(7),
  DATA_HASH_KEY: testKey(9),
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_PATH: './.test-storage',
  MAIL_DRIVER: 'log',
  PUSH_DRIVER: 'log',
  RATE_LIMIT_MAX: '10000',
  AUTH_RATE_LIMIT_MAX: '10000',
  DEFAULT_TENANT_SLUG: 'levoja',
  MAPS_PROVIDER: 'haversine',
  GEOCODER: 'none',
  PAYMENT_GATEWAY: 'sandbox',
  PAYOUT_PROVIDER: 'sandbox',
  // Testes nunca chamam o provedor de IA (o caminho com IA usa um provedor simulado).
  AI_PROVIDER: 'none',
});
delete process.env.ANTHROPIC_API_KEY;
delete process.env.REDIS_URL;
