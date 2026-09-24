import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto por requisição (requestId, IP, usuário, tenant), propagado via
 * AsyncLocalStorage. Permite que auditoria e logs capturem "quem/onde"
 * sem passar parâmetros por todas as camadas.
 */
export interface RequestContextData {
  requestId: string;
  ip?: string;
  userAgent?: string;
  userId?: string;
  tenantId?: string;
}

const storage = new AsyncLocalStorage<RequestContextData>();

export const RequestContext = {
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  },
  get(): RequestContextData | undefined {
    return storage.getStore();
  },
  set(patch: Partial<RequestContextData>): void {
    const current = storage.getStore();
    if (current) Object.assign(current, patch);
  },
};
