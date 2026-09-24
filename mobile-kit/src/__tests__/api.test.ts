import { api, ApiError, buildUrl, session, setFetch } from '../api';
import { configureKit } from '../config';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK: 0,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void store.delete(key)),
  };
});

type Call = { url: string; init: RequestInit };

function json(status: number, body?: unknown): Response {
  return { status, ok: status >= 200 && status < 300, text: async () => (body === undefined ? '' : JSON.stringify(body)) } as Response;
}

describe('cliente HTTP', () => {
  let calls: Call[];

  beforeEach(async () => {
    configureKit({ app: 'CUSTOMER', apiUrl: 'https://api.test/', webUrl: 'https://web.test', tenant: 'levoja' });
    calls = [];
    await session.clear();
  });

  it('monta URLs com /v1 e ignora parâmetros vazios', () => {
    expect(buildUrl('/stores', { lat: -23.5, segment: '', page: 2, search: undefined })).toBe('https://api.test/v1/stores?lat=-23.5&page=2');
  });

  it('envia o tenant e o token de acesso', async () => {
    await session.setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    setFetch(async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return json(200, { ok: true });
    });
    await api.get('auth/me');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer access-1');
    expect(headers['X-Tenant']).toBe('levoja');
  });

  it('renova o token uma única vez para várias requisições com 401 simultâneas', async () => {
    await session.setTokens({ accessToken: 'expired', refreshToken: 'refresh-1' });
    let refreshes = 0;
    setFetch(async (url, init) => {
      const path = String(url);
      const auth = (init?.headers as Record<string, string>).Authorization;
      if (path.endsWith('/auth/refresh')) {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return json(200, { accessToken: 'fresh', refreshToken: 'refresh-2', expiresIn: 900 });
      }
      return auth === 'Bearer fresh' ? json(200, { path }) : json(401, { message: 'expirado' });
    });
    const results = await Promise.all([api.get<{ path: string }>('a'), api.get<{ path: string }>('b'), api.get<{ path: string }>('c')]);
    expect(refreshes).toBe(1);
    expect(results.map((result) => result.path.split('/').pop())).toEqual(['a', 'b', 'c']);
    expect(session.getAccessToken()).toBe('fresh');
  });

  it('encerra a sessão quando o refresh é recusado', async () => {
    await session.setTokens({ accessToken: 'expired', refreshToken: 'revogado' });
    const signedOut = jest.fn();
    const unsubscribe = session.onSignedOut(signedOut);
    setFetch(async (url) => (String(url).endsWith('/auth/refresh') ? json(401, { message: 'Sessão inválida.' }) : json(401)));
    await expect(api.get('auth/me')).rejects.toMatchObject({ status: 401 });
    expect(signedOut).toHaveBeenCalledTimes(1);
    expect(session.getAccessToken()).toBeNull();
    unsubscribe();
  });

  it('sem internet: erro "offline" e a sessão é mantida', async () => {
    await session.setTokens({ accessToken: 'expired', refreshToken: 'refresh-1' });
    setFetch(async () => {
      throw new TypeError('Network request failed');
    });
    const error = await api.get('auth/me').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).offline).toBe(true);
    expect(session.getAccessToken()).toBe('expired');
  });

  it('usa a mensagem de erro padronizada da API', async () => {
    await session.setTokens({ accessToken: 'ok', refreshToken: 'r' });
    setFetch(async () => json(422, { statusCode: 422, message: 'Saldo insuficiente na carteira.', requestId: 'req-1' }));
    await expect(api.post('deliveries', {})).rejects.toMatchObject({ status: 422, message: 'Saldo insuficiente na carteira.', requestId: 'req-1' });
  });
});
