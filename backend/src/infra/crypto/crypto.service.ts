import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../../config/config.module';

const KEY_VERSION = 'v1';

/**
 * Criptografia de dados sensíveis em repouso.
 *
 * - encrypt/decrypt: AES-256-GCM com IV aleatório. Formato: "v1:<iv>:<tag>:<cipher>" (base64url).
 *   O prefixo de versão permite rotação de chaves no futuro.
 * - blindIndex: HMAC-SHA256 determinístico, para buscar/garantir unicidade (ex.: CPF)
 *   sem armazenar o valor em claro.
 */
@Injectable()
export class CryptoService {
  private readonly encryptionKey: Buffer;
  private readonly hashKey: Buffer;

  constructor(config: AppConfig) {
    this.encryptionKey = Buffer.from(config.env.DATA_ENCRYPTION_KEY, 'base64');
    this.hashKey = Buffer.from(config.env.DATA_HASH_KEY, 'base64');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [KEY_VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
  }

  decrypt(payload: string): string {
    const [version, iv, tag, data] = payload.split(':');
    if (version !== KEY_VERSION || !iv || !tag || data === undefined) {
      throw new Error('Formato de dado criptografado inválido');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }

  encryptNullable(plain: string | null | undefined): string | null {
    return plain ? this.encrypt(plain) : null;
  }

  decryptNullable(payload: string | null | undefined): string | null {
    return payload ? this.decrypt(payload) : null;
  }

  blindIndex(value: string): string {
    return createHmac('sha256', this.hashKey).update(value).digest('hex');
  }

  sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /** Token opaco com alta entropia (refresh tokens, links de e-mail). */
  randomToken(bytes = 48): string {
    return randomBytes(bytes).toString('base64url');
  }

  /** Código numérico (ex.: código de entrega, OTP por SMS). */
  numericCode(length = 6): string {
    let code = '';
    for (let i = 0; i < length; i++) code += randomInt(0, 10).toString();
    return code;
  }

  safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }
}
