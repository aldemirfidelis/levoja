import { kitConfig } from './config';
import { tokenStore } from './token-store';

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export type Query = Record<string, string | number | boolean | null | undefined>;

/** Erro padronizado da API (`{ statusCode, error, message, details, requestId }`) ou de rede. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
    /** Falha de conexão (sem internet, servidor inacessível, tempo esgotado). */
    readonly offline = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
  /** false = rota pública (não envia nem renova tokens). */
  auth?: boolean;
  timeoutMs?: number;
}

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...args) => fetch(...args);
/** Permite substituir o fetch (testes). */
export function setFetch(impl: Fetch): void {
  fetchImpl = impl;
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const signedOutListeners = new Set<() => void>();

export const session = {
  async setTokens(pair: Pick<TokenPair, 'accessToken' | 'refreshToken'>): Promise<void> {
    accessToken = pair.accessToken;
    await tokenStore.setRefreshToken(pair.refreshToken);
  },
  getAccessToken(): string | null {
    return accessToken;
  },
  async clear(): Promise<void> {
    accessToken = null;
    await tokenStore.clear();
  },
  /** Sessão expirada ou revogada no servidor (refresh recusado). */
  onSignedOut(listener: () => void): () => void {
    signedOutListeners.add(listener);
    return () => signedOutListeners.delete(listener);
  },
  /** Garante um access token válido (renova com o refresh token se necessário). */
  async ensure(): Promise<boolean> {
    if (accessToken) return true;
    return refresh();
  },
  refresh: () => refresh(),
};

export function buildUrl(path: string, query?: Query): string {
  const base = `${kitConfig().apiUrl}/v1/${path.replace(/^\/+/, '')}`;
  const params = Object.entries(query ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return params.length ? `${base}?${params.join('&')}` : base;
}

async function send(method: string, path: string, options: RequestOptions, withAuth: boolean): Promise<Response> {
  const { tenant } = kitConfig();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (tenant) headers['X-Tenant'] = tenant;
  if (withAuth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort);
  try {
    return await fetchImpl(buildUrl(path, options.query), { method, headers, body, signal: controller.signal });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(0, 'Sem conexão com o servidor. Verifique sua internet e tente novamente.', undefined, undefined, true);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const data = text ? safeJson(text) : undefined;
  if (response.ok) return data as T;
  const payload = (data ?? {}) as { message?: string | string[]; details?: unknown; requestId?: string };
  const message = Array.isArray(payload.message) ? payload.message[0] : payload.message;
  throw new ApiError(response.status, message || defaultMessage(response.status), payload.details, payload.requestId);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 200) };
  }
}

function defaultMessage(status: number): string {
  if (status === 401) return 'Sua sessão expirou. Entre novamente.';
  if (status === 403) return 'Você não tem permissão para esta ação.';
  if (status === 404) return 'Não encontrado.';
  if (status === 429) return 'Muitas tentativas. Aguarde um instante.';
  if (status >= 500) return 'O serviço está instável. Tente novamente em instantes.';
  return 'Não foi possível concluir a operação.';
}

/**
 * Renovação única e compartilhada: várias requisições com 401 simultâneas aguardam o mesmo refresh
 * (o servidor revoga a família inteira se um refresh token for reutilizado).
 */
function refresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const refreshToken = await tokenStore.getRefreshToken();
      if (!refreshToken) return false;
      try {
        const response = await send('POST', 'auth/refresh', { body: { refreshToken } }, false);
        const pair = await parse<TokenPair>(response);
        await session.setTokens(pair);
        return true;
      } catch (error) {
        // Sem internet: mantém a sessão para tentar de novo quando a conexão voltar.
        if (error instanceof ApiError && !error.offline) {
          await session.clear();
          signedOutListeners.forEach((listener) => listener());
        }
        return false;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const withAuth = options.auth !== false;
  if (withAuth && !accessToken) await refresh();
  const sentWith = accessToken;
  let response = await send(method, path, options, withAuth);
  if (response.status === 401 && withAuth) {
    // Outra requisição pode ter renovado o token enquanto esta estava em voo.
    const renewed = accessToken !== null && accessToken !== sentWith ? true : await refresh();
    if (renewed) response = await send(method, path, options, withAuth);
  }
  return parse<T>(response);
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) => request<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  delete: <T>(path: string) => request<T>('DELETE', path),
  /** Rotas públicas (cadastro, login, vitrine sem sessão). */
  public: {
    get: <T>(path: string, query?: Query) => request<T>('GET', path, { query, auth: false }),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body, auth: false }),
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Não foi possível concluir a operação.';
}
