import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

/**
 * BFF (Backend for Frontend) dos apps web.
 *
 * - Os tokens ficam em cookies httpOnly: o JavaScript do navegador nunca os vê (mitiga XSS).
 * - O navegador fala apenas com o próprio app (mesma origem); o proxy repassa para a API
 *   adicionando o Bearer token e renovando o access token automaticamente.
 * - Mutações exigem o cabeçalho `x-lj-csrf` (formulários de outros sites não conseguem enviá-lo)
 *   e os cookies são SameSite=Lax (proteção contra CSRF).
 */
export interface BffConfig {
  /** URL interna da API, ex.: http://localhost:3333 */
  apiUrl: string;
  tenant?: string;
  /** Aplicação informada no login (ADMIN exige usuário da equipe). */
  app: 'ADMIN' | 'COMPANY' | 'CUSTOMER';
  cookiePrefix: string;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const REFRESH_MAX_AGE = 30 * 86_400;
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'content-disposition', 'x-request-id', 'cache-control'];

export function createBff(config: BffConfig) {
  const accessCookie = `${config.cookiePrefix}_at`;
  const refreshCookie = `${config.cookiePrefix}_rt`;
  const secure = process.env.NODE_ENV === 'production';

  const apiHeaders = (request?: NextRequest): Record<string, string> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (config.tenant) headers['X-Tenant'] = config.tenant;
    const forwarded = request?.headers.get('x-forwarded-for');
    const userAgent = request?.headers.get('user-agent');
    if (forwarded) headers['X-Forwarded-For'] = forwarded;
    if (userAgent) headers['User-Agent'] = userAgent;
    const requestId = request?.headers.get('x-request-id');
    if (requestId) headers['X-Request-Id'] = requestId;
    return headers;
  };

  const setSession = (response: NextResponse, pair: TokenPair) => {
    response.cookies.set(accessCookie, pair.accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.max(60, pair.expiresIn - 30),
    });
    response.cookies.set(refreshCookie, pair.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: REFRESH_MAX_AGE,
    });
  };

  const clearSession = (response: NextResponse) => {
    response.cookies.set(accessCookie, '', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0 });
    response.cookies.set(refreshCookie, '', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0 });
  };

  const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

  const csrfOk = (request: NextRequest) => request.method === 'GET' || request.headers.get('x-lj-csrf') === '1';

  async function callApi(path: string, init: RequestInit & { request?: NextRequest; token?: string }) {
    const headers = new Headers(init.headers);
    for (const [key, value] of Object.entries(apiHeaders(init.request))) if (!headers.has(key)) headers.set(key, value);
    if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
    return fetch(`${config.apiUrl}${path}`, { ...init, headers, cache: 'no-store', redirect: 'manual' });
  }

  async function refreshTokens(refreshToken: string, request: NextRequest): Promise<TokenPair | null> {
    const response = await callApi('/v1/auth/refresh', {
      method: 'POST',
      request,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    return response.ok ? ((await response.json()) as TokenPair) : null;
  }

  /** POST /api/auth/login */
  async function login(request: NextRequest) {
    if (!csrfOk(request)) return json({ message: 'Requisição inválida.' }, 403);
    const body = await request.json().catch(() => ({}));
    const response = await callApi('/v1/auth/login', {
      method: 'POST',
      request,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, app: config.app }),
    });
    return sessionResponse(response);
  }

  /** POST /api/auth/mfa */
  async function mfa(request: NextRequest) {
    if (!csrfOk(request)) return json({ message: 'Requisição inválida.' }, 403);
    const body = await request.text();
    const response = await callApi('/v1/auth/mfa/login', {
      method: 'POST',
      request,
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return sessionResponse(response);
  }

  /** POST /api/auth/register/{customer|company|driver} */
  async function register(request: NextRequest, kind: string) {
    if (!csrfOk(request)) return json({ message: 'Requisição inválida.' }, 403);
    if (!['customer', 'company', 'driver'].includes(kind)) return json({ message: 'Não encontrado.' }, 404);
    const response = await callApi(`/v1/auth/register/${kind}`, {
      method: 'POST',
      request,
      headers: { 'Content-Type': 'application/json' },
      body: await request.text(),
    });
    return sessionResponse(response);
  }

  async function sessionResponse(apiResponse: Response) {
    const payload = await apiResponse.json().catch(() => ({ message: 'Resposta inválida da API.' }));
    if (!apiResponse.ok) return json(payload, apiResponse.status);
    if (payload.mfaRequired) return json({ mfaRequired: true, mfaToken: payload.mfaToken });
    const { accessToken: _a, refreshToken: _r, ...rest } = payload;
    const response = json({ ...rest, authenticated: true });
    setSession(response, payload);
    return response;
  }

  /** POST /api/auth/logout */
  async function logout(request: NextRequest) {
    if (!csrfOk(request)) return json({ message: 'Requisição inválida.' }, 403);
    const refreshToken = request.cookies.get(refreshCookie)?.value;
    if (refreshToken) {
      await callApi('/v1/auth/logout', {
        method: 'POST',
        request,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => undefined);
    }
    const response = new NextResponse(null, { status: 204 });
    clearSession(response);
    return response;
  }

  /** /api/proxy/[...path] — repassa para /v1/<path> com autenticação. */
  async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
    if (!csrfOk(request)) return json({ message: 'Requisição inválida (CSRF).' }, 403);
    const { path } = await context.params;
    const target = `/v1/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;
    const hasBody = !['GET', 'HEAD'].includes(request.method);
    const body = hasBody ? await request.arrayBuffer() : undefined;
    const headers: Record<string, string> = {};
    const contentType = request.headers.get('content-type');
    if (contentType) headers['Content-Type'] = contentType;

    let accessToken = request.cookies.get(accessCookie)?.value;
    const refreshToken = request.cookies.get(refreshCookie)?.value;
    let renewed: TokenPair | null = null;

    if (!accessToken && refreshToken) {
      renewed = await refreshTokens(refreshToken, request);
      accessToken = renewed?.accessToken;
    }

    let apiResponse = await callApi(target, { method: request.method, request, headers, body, token: accessToken });
    if (apiResponse.status === 401 && refreshToken && !renewed) {
      renewed = await refreshTokens(refreshToken, request);
      if (renewed) {
        apiResponse = await callApi(target, { method: request.method, request, headers, body, token: renewed.accessToken });
      }
    }

    const responseHeaders = new Headers();
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = apiResponse.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    const response = new NextResponse(apiResponse.status === 204 ? null : apiResponse.body, {
      status: apiResponse.status,
      headers: responseHeaders,
    });
    if (renewed) setSession(response, renewed);
    else if (apiResponse.status === 401 && (accessToken || refreshToken)) clearSession(response);
    return response;
  }

  /** Access token atual para Server Components (sem renovação). */
  async function serverToken(): Promise<string | undefined> {
    return (await cookies()).get(accessCookie)?.value;
  }

  /** Há sessão (mesmo que o access token precise ser renovado)? Usado pelo proxy de rotas. */
  function hasSession(request: NextRequest): boolean {
    return !!(request.cookies.get(accessCookie)?.value || request.cookies.get(refreshCookie)?.value);
  }

  /** Chamada autenticada da API a partir do servidor Next (Server Components). */
  async function serverFetch<T>(path: string): Promise<T | null> {
    const token = await serverToken();
    if (!token) return null;
    const response = await callApi(`/v1/${path.replace(/^\//, '')}`, { method: 'GET', token });
    return response.ok ? ((await response.json()) as T) : null;
  }

  return { login, mfa, register, logout, proxy, serverToken, serverFetch, hasSession, accessCookie, refreshCookie };
}
