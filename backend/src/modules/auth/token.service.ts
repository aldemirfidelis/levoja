import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { AppConfig } from '../../config/config.module';
import { AuditService } from '../audit/audit.service';
import type { AccessTokenPayload } from '../../common/guards/jwt-auth.guard';
import type { ClientInfo } from '../../common/decorators';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Validade do access token em segundos. */
  expiresIn: number;
  tokenType: 'Bearer';
}

interface MfaTokenPayload {
  sub: string;
  typ: 'mfa';
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  /** Emite um novo par de tokens. Sem `familyId`, inicia uma nova sessão. */
  async issue(user: { id: string; tenantId: string }, client: ClientInfo, familyId: string = randomUUID()): Promise<TokenPair> {
    const { pair } = await this.issueWithId(user, client, familyId);
    return pair;
  }

  private async issueWithId(user: { id: string; tenantId: string }, client: ClientInfo, familyId: string) {
    const refreshToken = this.crypto.randomToken(48);
    const ttlDays = this.config.env.REFRESH_TOKEN_TTL_DAYS;
    const created = await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: this.crypto.sha256(refreshToken),
        expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
        userAgent: client.userAgent,
        ip: client.ip,
      },
      select: { id: true },
    });
    const pair: TokenPair = {
      accessToken: await this.signAccess(user, familyId),
      refreshToken,
      expiresIn: this.config.env.JWT_ACCESS_TTL_SECONDS,
      tokenType: 'Bearer',
    };
    return { pair, refreshTokenId: created.id };
  }

  signAccess(user: { id: string; tenantId: string }, familyId: string): Promise<string> {
    const payload: AccessTokenPayload = { sub: user.id, tid: user.tenantId, sid: familyId, typ: 'access' };
    return this.jwt.signAsync(payload, { expiresIn: this.config.env.JWT_ACCESS_TTL_SECONDS });
  }

  /**
   * Rotação de refresh token. Se um token já rotacionado for reutilizado, assume-se
   * vazamento: toda a família (sessão) é revogada.
   */
  async rotate(refreshToken: string, client: ClientInfo): Promise<TokenPair> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.crypto.sha256(refreshToken) },
      include: { user: { select: { id: true, tenantId: true, status: true } } },
    });
    if (!stored) throw new UnauthorizedException('Sessão inválida.');

    if (stored.revokedAt) {
      if (stored.revokedReason === 'rotated') {
        await this.revokeFamily(stored.familyId, 'reuse_detected');
        await this.audit.log({
          action: 'auth.refresh.reuse_detected',
          entityType: 'User',
          entityId: stored.userId,
          actorId: stored.userId,
          tenantId: stored.user.tenantId,
          metadata: { familyId: stored.familyId, ip: client.ip },
        });
      }
      throw new UnauthorizedException('Sessão encerrada. Faça login novamente.');
    }
    if (stored.expiresAt < new Date()) throw new UnauthorizedException('Sessão expirada. Faça login novamente.');
    if (stored.user.status !== 'ACTIVE') throw new UnauthorizedException('Conta indisponível.');

    // Revoga o token atual de forma condicional: se duas requisições concorrentes usarem o
    // mesmo token, apenas uma vence; a outra é tratada como reutilização.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'rotated', lastUsedAt: new Date() },
    });
    if (claimed.count === 0) throw new UnauthorizedException('Sessão encerrada. Faça login novamente.');

    const { pair, refreshTokenId } = await this.issueWithId(stored.user, client, stored.familyId);
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { replacedById: refreshTokenId } });
    return pair;
  }

  async revokeByToken(refreshToken: string, reason = 'logout'): Promise<{ userId: string; familyId: string } | null> {
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.crypto.sha256(refreshToken) } });
    if (!stored) return null;
    await this.revokeFamily(stored.familyId, reason);
    return { userId: stored.userId, familyId: stored.familyId };
  }

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  signMfaChallenge(userId: string): Promise<string> {
    const payload: MfaTokenPayload = { sub: userId, typ: 'mfa' };
    return this.jwt.signAsync(payload, { expiresIn: 300 });
  }

  async verifyMfaChallenge(token: string): Promise<string> {
    try {
      const payload = await this.jwt.verifyAsync<MfaTokenPayload>(token);
      if (payload.typ !== 'mfa') throw new Error();
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Desafio de autenticação expirado. Faça login novamente.');
    }
  }
}
