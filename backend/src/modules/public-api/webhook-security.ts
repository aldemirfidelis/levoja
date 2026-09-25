import { createHmac, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Segurança dos webhooks da API pública:
 * - assinatura HMAC-SHA256 no formato `t=<unix>,v1=<hex>` sobre `<t>.<corpo>` (o destinatário
 *   confere com o segredo e rejeita timestamps antigos — proteção contra reenvio);
 * - destino só em HTTPS e IP público (evita que a plataforma seja usada para acessar a rede
 *   interna — SSRF). O endereço é resolvido de novo a cada envio (DNS rebinding).
 */

export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

/** Verificação (referência para integradores e testes). */
export function verifySignature(secret: string, body: string, header: string, toleranceSeconds = 300, now = Math.floor(Date.now() / 1000)): boolean {
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=') as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || !parts.v1 || Math.abs(now - timestamp) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
  const received = Buffer.from(parts.v1, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Endereços que nunca podem receber webhooks (loopback, redes privadas, link-local, metadados de nuvem). */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('::ffff:')) return isPrivateAddress(normalized.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(normalized);
  }
  return true;
}

export class UnsafeUrlError extends Error {}

/** Valida o destino do webhook; `allowPrivate` só em desenvolvimento/testes. */
export async function assertSafeWebhookUrl(raw: string, allowPrivate: boolean): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Endereço inválido.');
  }
  if (url.username || url.password) throw new UnsafeUrlError('O endereço não pode conter usuário e senha.');
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) throw new UnsafeUrlError('Use um endereço HTTPS.');
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((entry) => entry.address);
  if (!addresses.length) throw new UnsafeUrlError('Não foi possível resolver o endereço.');
  if (addresses.some(isPrivateAddress)) throw new UnsafeUrlError('O endereço aponta para uma rede interna.');
  return url;
}
