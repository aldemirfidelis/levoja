import { CryptoService } from './crypto.service';
import { generateTotp, generateTotpSecret, totpUri, verifyTotp } from './totp';
import { AppConfig } from '../../config/config.module';
import { loadEnv } from '../../config/env';

describe('CryptoService', () => {
  const crypto = new CryptoService(new AppConfig(loadEnv({ ...process.env, DATABASE_URL: 'postgresql://x' })));

  it('criptografa e decifra (AES-256-GCM) com IV aleatório', () => {
    const a = crypto.encrypt('52998224725');
    const b = crypto.encrypt('52998224725');
    expect(a).not.toEqual(b);
    expect(a.startsWith('v1:')).toBe(true);
    expect(crypto.decrypt(a)).toBe('52998224725');
  });

  it('detecta adulteração do texto cifrado', () => {
    const payload = crypto.encrypt('segredo');
    const [v, iv, tag, data] = payload.split(':');
    const tampered = [v, iv, tag, Buffer.from('outro').toString('base64url') + data.slice(6)].join(':');
    expect(() => crypto.decrypt(tampered)).toThrow();
  });

  it('índice cego é determinístico e não revela o valor', () => {
    expect(crypto.blindIndex('cpf:1')).toBe(crypto.blindIndex('cpf:1'));
    expect(crypto.blindIndex('cpf:1')).not.toBe(crypto.blindIndex('cpf:2'));
    const index = crypto.blindIndex('cpf:52998224725');
    expect(index).toMatch(/^[0-9a-f]{64}$/);
    expect(index).not.toContain('52998224725');
  });

  it('gera códigos numéricos e tokens com o tamanho esperado', () => {
    expect(crypto.numericCode(6)).toMatch(/^\d{6}$/);
    expect(crypto.randomToken(32).length).toBeGreaterThanOrEqual(42);
    expect(crypto.safeEqual('abc', 'abc')).toBe(true);
    expect(crypto.safeEqual('abc', 'abd')).toBe(false);
  });
});

describe('TOTP (RFC 6238)', () => {
  it('bate com os vetores de teste da RFC (SHA-1)', () => {
    // Segredo ASCII "12345678901234567890" em base32
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(generateTotp(secret, 59_000)).toBe('287082');
    expect(generateTotp(secret, 1_111_111_109_000)).toBe('081804');
    expect(generateTotp(secret, 1_234_567_890_000)).toBe('005924');
  });

  it('aceita a janela de ±30s e rejeita códigos antigos', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    expect(verifyTotp(secret, generateTotp(secret, now), 1, now)).toBe(true);
    expect(verifyTotp(secret, generateTotp(secret, now - 30_000), 1, now)).toBe(true);
    expect(verifyTotp(secret, generateTotp(secret, now - 120_000), 1, now)).toBe(false);
    expect(verifyTotp(secret, 'abc123', 1, now)).toBe(false);
  });

  it('gera URI otpauth para apps autenticadores', () => {
    const uri = totpUri('JBSWY3DPEHPK3PXP', 'maria@email.com', 'LevoJá');
    expect(uri).toMatch(/^otpauth:\/\/totp\/LevoJ%C3%A1%3Amaria%40email.com\?/);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
  });
});
