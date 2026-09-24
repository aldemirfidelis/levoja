import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import type { OneTimeTokenPurpose } from '../../generated/prisma/enums';

const MAX_CODE_ATTEMPTS = 5;

/**
 * Tokens de uso único. Apenas o hash é armazenado.
 * - "link": token longo enviado por e-mail (redefinição de senha, convite).
 * - "code": código numérico de 6 dígitos (verificação de e-mail/telefone), com limite de tentativas.
 */
@Injectable()
export class OneTimeTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async issueLink(userId: string, purpose: OneTimeTokenPurpose, ttlMinutes: number): Promise<string> {
    const token = this.crypto.randomToken(32);
    await this.store(userId, purpose, this.crypto.sha256(token), ttlMinutes);
    return token;
  }

  async issueCode(userId: string, purpose: OneTimeTokenPurpose, ttlMinutes = 15): Promise<string> {
    const code = this.crypto.numericCode(6);
    await this.store(userId, purpose, this.codeHash(userId, purpose, code), ttlMinutes);
    return code;
  }

  /** Consome um token de link. Retorna o userId. */
  async consumeLink(purposes: OneTimeTokenPurpose[], token: string): Promise<{ userId: string; purpose: OneTimeTokenPurpose }> {
    const record = await this.prisma.oneTimeToken.findUnique({ where: { tokenHash: this.crypto.sha256(token) } });
    if (!record || !purposes.includes(record.purpose) || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Link inválido ou expirado. Solicite um novo.');
    }
    const claimed = await this.prisma.oneTimeToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count === 0) throw new BadRequestException('Link já utilizado.');
    return { userId: record.userId, purpose: record.purpose };
  }

  async consumeCode(userId: string, purpose: OneTimeTokenPurpose, code: string): Promise<void> {
    const record = await this.prisma.oneTimeToken.findFirst({
      where: { userId, purpose, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) throw new BadRequestException('Código expirado. Solicite um novo.');
    if (record.attempts >= MAX_CODE_ATTEMPTS) throw new BadRequestException('Muitas tentativas. Solicite um novo código.');
    if (!this.crypto.safeEqual(record.tokenHash, this.codeHash(userId, purpose, code))) {
      await this.prisma.oneTimeToken.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException('Código incorreto.');
    }
    await this.prisma.oneTimeToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  }

  private async store(userId: string, purpose: OneTimeTokenPurpose, tokenHash: string, ttlMinutes: number) {
    // Invalida tokens anteriores do mesmo propósito: só o mais recente vale.
    await this.prisma.oneTimeToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
    await this.prisma.oneTimeToken.create({
      data: { userId, purpose, tokenHash, expiresAt: new Date(Date.now() + ttlMinutes * 60_000) },
    });
  }

  /** Códigos curtos são "salgados" com usuário e propósito para evitar colisões na coluna única. */
  private codeHash(userId: string, purpose: string, code: string): string {
    return this.crypto.blindIndex(`otp:${userId}:${purpose}:${code}`);
  }
}
