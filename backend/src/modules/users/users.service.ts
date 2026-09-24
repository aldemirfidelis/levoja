import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { isValidCpf, isValidEmail, maskDocument, normalizeBrazilianPhone, onlyDigits, passwordIssues } from '@levoja/shared';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { PasswordService } from '../../infra/crypto/password.service';
import { StorageService } from '../../infra/storage/storage.service';
import type { User } from '../../generated/prisma/client';

export interface NewUserInput {
  name: string;
  email: string;
  phone?: string | null;
  password?: string | null;
  cpf?: string | null;
  birthDate?: string | Date | null;
  roleIds: string[];
}

export interface UserView {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  cpfMasked: string | null;
  birthDate: string | null;
  avatarUrl: string | null;
  status: User['status'];
  statusReason: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  mfaEnabled: boolean;
  preferences: unknown;
  lastLoginAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
    private readonly storage: StorageService,
  ) {}

  normalizeEmail(email: string): string {
    const normalized = email.trim().toLowerCase();
    if (!isValidEmail(normalized)) throw new BadRequestException('E-mail inválido.');
    return normalized;
  }

  normalizePhone(phone: string): string {
    const normalized = normalizeBrazilianPhone(phone);
    if (!normalized) throw new BadRequestException('Telefone inválido. Informe DDD + número.');
    return normalized;
  }

  normalizeCpf(cpf: string): string {
    const digits = onlyDigits(cpf);
    if (!isValidCpf(digits)) throw new BadRequestException('CPF inválido.');
    return digits;
  }

  assertPassword(password: string): void {
    const issues = passwordIssues(password);
    if (issues.length) throw new BadRequestException(issues.join(' '));
  }

  cpfHash(cpfDigits: string): string {
    return this.crypto.blindIndex(`cpf:${cpfDigits}`);
  }

  /** Normaliza, valida e prepara o CPF para persistência (criptografado + índice cego). */
  protectCpf(cpf: string): { cpfEncrypted: string; cpfHash: string } {
    const digits = this.normalizeCpf(cpf);
    return { cpfEncrypted: this.crypto.encrypt(digits), cpfHash: this.cpfHash(digits) };
  }

  /** Verifica unicidade com mensagens amigáveis (as constraints do banco protegem contra corridas). */
  async assertAvailable(
    tenantId: string,
    identity: { email?: string; phone?: string | null; cpfHash?: string | null },
    excludeUserId?: string,
    tx: Tx = this.prisma,
  ): Promise<void> {
    const or = [
      identity.email ? { email: identity.email } : null,
      identity.phone ? { phone: identity.phone } : null,
      identity.cpfHash ? { cpfHash: identity.cpfHash } : null,
    ].filter((clause): clause is NonNullable<typeof clause> => clause !== null);
    if (!or.length) return;
    const existing = await tx.user.findFirst({
      where: { tenantId, OR: or, ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}) },
      select: { email: true, phone: true, cpfHash: true },
    });
    if (!existing) return;
    if (identity.email && existing.email === identity.email) throw new ConflictException('E-mail já cadastrado.');
    if (identity.phone && existing.phone === identity.phone) throw new ConflictException('Telefone já cadastrado.');
    throw new ConflictException('CPF já cadastrado.');
  }

  async create(tx: Tx, tenantId: string, input: NewUserInput): Promise<User> {
    const email = this.normalizeEmail(input.email);
    const phone = input.phone ? this.normalizePhone(input.phone) : null;
    const cpf = input.cpf ? this.normalizeCpf(input.cpf) : null;
    const cpfHash = cpf ? this.cpfHash(cpf) : null;
    if (input.password) this.assertPassword(input.password);
    await this.assertAvailable(tenantId, { email, phone, cpfHash }, undefined, tx);

    return tx.user.create({
      data: {
        tenantId,
        name: input.name.trim(),
        email,
        phone,
        passwordHash: input.password ? await this.passwords.hash(input.password) : null,
        cpfEncrypted: cpf ? this.crypto.encrypt(cpf) : null,
        cpfHash,
        birthDate: input.birthDate ? new Date(input.birthDate) : null,
        // Preferências de interface. Comunicações de marketing dependem de CONSENTIMENTO (tabela consents).
        preferences: { theme: 'system' },
        roles: { create: input.roleIds.map((roleId) => ({ roleId })) },
      },
    });
  }

  toView(user: User): UserView {
    const cpf = this.crypto.decryptNullable(user.cpfEncrypted);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      cpfMasked: cpf ? maskDocument(cpf) : null,
      birthDate: user.birthDate ? user.birthDate.toISOString().slice(0, 10) : null,
      avatarUrl: this.storage.publicUrl(user.avatarKey),
      status: user.status,
      statusReason: user.statusReason,
      emailVerified: !!user.emailVerifiedAt,
      phoneVerified: !!user.phoneVerifiedAt,
      mfaEnabled: user.mfaEnabled,
      preferences: user.preferences,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }
}
