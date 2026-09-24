#!/usr/bin/env node
/**
 * PostgreSQL embutido para desenvolvimento local SEM Docker.
 *
 * Uso:  pnpm db:embedded            (mantém o banco rodando até Ctrl+C)
 *
 * Cria os bancos `levoja` (desenvolvimento) e `levoja_test` (testes de integração).
 * Em ambientes com Docker prefira `docker compose up -d` (infrastructure/docker-compose.yml),
 * que também sobe Redis, MinIO (S3) e Mailpit.
 *
 * Variáveis opcionais: EMBEDDED_PG_PORT (5433), EMBEDDED_PG_USER (levoja), EMBEDDED_PG_PASSWORD (levoja).
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const databaseDir = resolve(root, '.data', 'postgres');
const port = Number(process.env.EMBEDDED_PG_PORT ?? 5433);
const user = process.env.EMBEDDED_PG_USER ?? 'levoja';
const password = process.env.EMBEDDED_PG_PASSWORD ?? 'levoja';
const databases = ['levoja', 'levoja_test'];
// 5433 evita conflito com instalações locais do PostgreSQL (porta padrão 5432).
const recentLogs = [];

const pg = new EmbeddedPostgres({
  databaseDir,
  user,
  password,
  port,
  persistent: true,
  onLog: (message) => {
    recentLogs.push(String(message).trim());
    if (recentLogs.length > 20) recentLogs.shift();
  },
  onError: (message) => console.error('[postgres]', String(message).trim()),
});

const alreadyInitialised = existsSync(resolve(databaseDir, 'PG_VERSION'));
if (!alreadyInitialised) {
  console.log(`[dev-db] Inicializando cluster em ${databaseDir} ...`);
  await pg.initialise();
}

try {
  await pg.start();
} catch (error) {
  console.error('[dev-db] Falha ao iniciar o PostgreSQL:', error?.message ?? '');
  console.error(recentLogs.join('\n'));
  process.exit(1);
}

const client = pg.getPgClient();
await client.connect();
const { rows } = await client.query('SELECT datname FROM pg_database');
const existing = new Set(rows.map((row) => row.datname));
for (const name of databases) {
  if (!existing.has(name)) {
    await client.query(`CREATE DATABASE "${name}"`);
    console.log(`[dev-db] Banco "${name}" criado.`);
  }
}
await client.end();

console.log(`[dev-db] PostgreSQL pronto em postgresql://${user}:${password}@localhost:${port}/levoja`);
console.log('[dev-db] Pressione Ctrl+C para encerrar.');

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  console.log('\n[dev-db] Encerrando PostgreSQL ...');
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Mantém o processo vivo.
setInterval(() => {}, 1 << 30);
