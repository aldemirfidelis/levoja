import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { testDatabaseUrl } from './test-db';

/**
 * Prepara o banco de testes de forma NÃO destrutiva:
 * - aplica as migrations versionadas pendentes (`migrate deploy`) — valida que as migrations funcionam;
 * - executa o seed essencial (idempotente).
 *
 * Os testes geram identidades únicas a cada execução, então não dependem de um banco vazio.
 * Para zerar o banco de testes manualmente: `DATABASE_URL=<url de teste> pnpm db:reset`.
 */
export default async function globalSetup(): Promise<void> {
  const url = testDatabaseUrl();
  if (!/levoja_test|_test\b/.test(url)) throw new Error(`Banco de testes inválido (esperado *_test): ${url}`);
  const cwd = resolve(__dirname, '..');
  const env = { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' };

  execSync('npx prisma migrate deploy', { cwd, env, stdio: 'pipe' });
  execSync('npx tsx prisma/seed.ts', {
    cwd,
    env: { ...env, SEED_ADMIN_EMAIL: 'admin@levoja.test', SEED_ADMIN_PASSWORD: 'AdminTeste123' },
    stdio: 'pipe',
  });
  rmSync(resolve(cwd, '.test-storage'), { recursive: true, force: true });
}
