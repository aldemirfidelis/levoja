import { Prisma } from '../generated/prisma/client';

/** Conflito transitório de concorrência no banco (deadlock, serialização ou gravação concorrente). */
export function isTransientConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return true;
  const text = `${(error as Error)?.message ?? ''} ${JSON.stringify((error as { meta?: unknown })?.meta ?? {})} ${String((error as { cause?: unknown })?.cause ?? '')}`;
  return /deadlock|could not serialize|40P01|40001/i.test(text);
}

/**
 * Repete a operação (tipicamente uma transação) quando o banco a aborta por conflito transitório —
 * ex.: dois ouvintes do mesmo evento lançando na mesma carteira em ordens diferentes.
 */
export async function retryOnConflict<T>(operation: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !isTransientConflict(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt + Math.floor(Math.random() * 50)));
    }
  }
}
