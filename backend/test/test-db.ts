import { config } from 'dotenv';

config({ quiet: true });

/**
 * URL do banco de testes: DATABASE_URL_TEST, ou a DATABASE_URL de desenvolvimento
 * com o nome do banco trocado para `levoja_test`. Nunca aponta para o banco de dev.
 */
export function testDatabaseUrl(): string {
  if (process.env.DATABASE_URL_TEST) return process.env.DATABASE_URL_TEST;
  const base = process.env.DATABASE_URL ?? 'postgresql://levoja:levoja@localhost:5433/levoja';
  const url = new URL(base);
  url.pathname = '/levoja_test';
  return url.toString();
}
