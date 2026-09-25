import { assertSafeWebhookUrl, isPrivateAddress, signPayload, UnsafeUrlError, verifySignature } from './webhook-security';

describe('segurança dos webhooks', () => {
  it('assinatura HMAC confere e expira', () => {
    const body = JSON.stringify({ id: 'evt', type: 'order.created' });
    const header = signPayload('whsec_teste', body, 1_700_000_000);
    expect(header).toMatch(/^t=1700000000,v1=[a-f0-9]{64}$/);
    expect(verifySignature('whsec_teste', body, header, 300, 1_700_000_100)).toBe(true);
    expect(verifySignature('outro', body, header, 300, 1_700_000_100)).toBe(false);
    expect(verifySignature('whsec_teste', `${body} `, header, 300, 1_700_000_100)).toBe(false);
    expect(verifySignature('whsec_teste', body, header, 300, 1_700_001_000)).toBe(false);
  });

  it('bloqueia redes internas e metadados de nuvem', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    for (const address of ['8.8.8.8', '200.160.2.3', '2001:4860:4860::8888']) expect(isPrivateAddress(address)).toBe(false);
  });

  it('exige HTTPS e IP público (exceto no modo de desenvolvimento)', async () => {
    await expect(assertSafeWebhookUrl('http://exemplo.com.br/hook', false)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertSafeWebhookUrl('https://127.0.0.1/hook', false)).rejects.toThrow('rede interna');
    await expect(assertSafeWebhookUrl('https://user:pass@exemplo.com.br', false)).rejects.toThrow('usuário e senha');
    await expect(assertSafeWebhookUrl('nao-e-url', false)).rejects.toThrow('inválido');
    await expect(assertSafeWebhookUrl('http://localhost:4000/hook', true)).resolves.toBeInstanceOf(URL);
  });
});
