/** Erro padronizado da API ({ statusCode, message, details, requestId }). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
  }

  /** Mensagens de validação (lista) ou a mensagem principal. */
  get messages(): string[] {
    return Array.isArray(this.details) ? (this.details as string[]) : [this.message];
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  /** Para uploads multipart. */
  form?: FormData;
  signal?: AbortSignal;
}

const listeners = new Set<() => void>();
/** Chamado quando a sessão expira (401) — o app redireciona para o login. */
export const onUnauthorized = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function buildQuery(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function request<T>(base: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'x-lj-csrf': '1' };
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`${base}/${path.replace(/^\//, '')}${buildQuery(options.query)}`, {
      method: options.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Verifique sua internet e tente novamente.');
  }

  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) listeners.forEach((listener) => listener());
    throw new ApiError(
      response.status,
      payload?.message ?? 'Não foi possível concluir a operação.',
      payload?.details,
      payload?.requestId,
    );
  }
  return payload as T;
}

/** Chamadas à API via proxy do próprio app (/api/proxy/*). */
export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>('/api/proxy', path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>('/api/proxy', path, { method: 'POST', body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>('/api/proxy', path, { method: 'PUT', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>('/api/proxy', path, { method: 'PATCH', body: body ?? {} }),
  delete: <T = void>(path: string) => request<T>('/api/proxy', path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData, method: 'POST' | 'PUT' = 'POST') =>
    request<T>('/api/proxy', path, { method, form }),
  /** URL para abrir arquivos protegidos (documentos) em nova aba. */
  fileUrl: (path: string) => `/api/proxy/${path.replace(/^\//, '')}`,
};

/** Rotas de sessão do BFF (/api/auth/*). */
export const session = {
  login: <T>(body: { login: string; password: string }) => request<T>('/api/auth', 'login', { method: 'POST', body }),
  mfa: <T>(body: { mfaToken: string; code: string }) => request<T>('/api/auth', 'mfa', { method: 'POST', body }),
  register: <T>(kind: 'customer' | 'company' | 'driver', body: unknown) =>
    request<T>('/api/auth', `register/${kind}`, { method: 'POST', body }),
  logout: () => request<void>('/api/auth', 'logout', { method: 'POST', body: {} }),
};

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}
