import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { RequestContext } from '../../common/request-context';
import { Prisma } from '../../generated/prisma/client';

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  /** Sobrescreve o ator do contexto (ex.: login, onde o usuário ainda não está autenticado). */
  actorId?: string | null;
  tenantId?: string | null;
}

const SENSITIVE = /(password|secret|token|hash|encrypted|cpf|cnh|pix|account)/i;

/** Remove/mascara campos sensíveis antes de persistir na trilha de auditoria. */
export function redact(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  const output: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (SENSITIVE.test(key)) {
      output[key] = field == null ? field : '[REDACTED]';
    } else if (field instanceof Date) {
      output[key] = field.toISOString();
    } else if (field && typeof field === 'object' && !Array.isArray(field)) {
      output[key] = redact(field as Record<string, unknown>);
    } else {
      output[key] = field;
    }
  }
  return output;
}

/** Mantém apenas os campos alterados (valor anterior x novo). */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = normalize(before[key]);
    const b = normalize(after[key]);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changedBefore[key] = before[key];
      changedAfter[key] = after[key];
    }
  }
  return { before: changedBefore, after: changedAfter };
}

const normalize = (value: unknown) => (value instanceof Date ? value.toISOString() : value);

/**
 * Trilha de auditoria de operações críticas.
 * Registra: usuário, data/hora, IP, ação, registro afetado, valor anterior e novo.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, tx?: Tx): Promise<void> {
    const context = RequestContext.get();
    const client = tx ?? this.prisma;
    try {
      await client.auditLog.create({
        data: {
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          before: (redact(entry.before) ?? undefined) as Prisma.InputJsonValue | undefined,
          after: (redact(entry.after) ?? undefined) as Prisma.InputJsonValue | undefined,
          metadata: (redact(entry.metadata) ?? undefined) as Prisma.InputJsonValue | undefined,
          actorId: entry.actorId === undefined ? (context?.userId ?? null) : entry.actorId,
          tenantId: entry.tenantId === undefined ? (context?.tenantId ?? null) : entry.tenantId,
          ip: context?.ip,
          userAgent: context?.userAgent,
          requestId: context?.requestId,
        },
      });
    } catch (error) {
      // Dentro de uma transação a falha deve propagar (a operação inteira é desfeita).
      if (tx) throw error;
      this.logger.error(`Falha ao gravar auditoria (${entry.action}): ${(error as Error).message}`);
    }
  }
}
