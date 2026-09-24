import type { Tx } from '../infra/prisma/prisma.service';

/** Próximo número sequencial por tenant (atômico; ex.: contratos, lotes, faturas). */
export async function nextCounter(tx: Tx, tenantId: string, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO counters ("tenantId", key, value) VALUES (${tenantId}::uuid, ${key}, 1)
    ON CONFLICT ("tenantId", key) DO UPDATE SET value = counters.value + 1
    RETURNING value`;
  return Number(rows[0].value);
}

/** Trava transacional por chave (serializa operações concorrentes de uma mesma empresa). */
export async function lockKey(tx: Tx, key: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
