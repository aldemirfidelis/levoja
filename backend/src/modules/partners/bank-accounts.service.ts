import { BadRequestException, Injectable } from '@nestjs/common';
import { isValidCnpj, isValidCpf, isValidEmail, normalizeBrazilianPhone, normalizeCnpj, onlyDigits } from '@levoja/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { AuditService } from '../audit/audit.service';
import { BankAccountDto } from './bank-account.dto';
import type { BankAccount } from '../../generated/prisma/client';

type Owner = { companyId: string } | { driverId: string };

/** Conta bancária/PIX para repasses. Número da conta, documento e chave PIX são criptografados. */
@Injectable()
export class BankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  async upsert(tenantId: string, owner: Owner, dto: BankAccountDto) {
    const holderDocument = normalizeCnpj(dto.holderDocument);
    if (!(isValidCpf(holderDocument) || isValidCnpj(holderDocument))) {
      throw new BadRequestException('Documento do titular inválido.');
    }
    if (!!dto.pixKeyType !== !!dto.pixKey) throw new BadRequestException('Informe o tipo e a chave PIX.');
    const pixKey = dto.pixKeyType && dto.pixKey ? this.normalizePixKey(dto.pixKeyType, dto.pixKey) : null;

    const data = {
      holderName: dto.holderName.trim(),
      holderDocumentEncrypted: this.crypto.encrypt(holderDocument),
      bankCode: dto.bankCode,
      branch: dto.branch,
      accountNumberEncrypted: this.crypto.encrypt(dto.accountNumber),
      accountLast4: dto.accountNumber.slice(-4),
      accountType: dto.accountType,
      pixKeyType: dto.pixKeyType ?? null,
      pixKeyEncrypted: pixKey ? this.crypto.encrypt(pixKey) : null,
      pixKeyMasked: pixKey ? maskPix(pixKey) : null,
      verifiedAt: null,
    };

    const where = 'companyId' in owner ? { companyId: owner.companyId } : { driverId: owner.driverId };
    const existing = await this.prisma.bankAccount.findUnique({ where });
    const account = existing
      ? await this.prisma.bankAccount.update({ where: { id: existing.id }, data })
      : await this.prisma.bankAccount.create({ data: { tenantId, ...owner, ...data } });

    await this.audit.log({
      action: existing ? 'bank_account.update' : 'bank_account.create',
      entityType: 'BankAccount',
      entityId: account.id,
      before: existing ? toView(existing) : null,
      after: toView(account),
    });
    return toView(account);
  }

  private normalizePixKey(type: string, key: string): string {
    const value = key.trim();
    switch (type) {
      case 'CPF':
        if (!isValidCpf(value)) throw new BadRequestException('Chave PIX (CPF) inválida.');
        return onlyDigits(value);
      case 'CNPJ':
        if (!isValidCnpj(value)) throw new BadRequestException('Chave PIX (CNPJ) inválida.');
        return normalizeCnpj(value);
      case 'EMAIL':
        if (!isValidEmail(value)) throw new BadRequestException('Chave PIX (e-mail) inválida.');
        return value.toLowerCase();
      case 'PHONE': {
        const phone = normalizeBrazilianPhone(value);
        if (!phone) throw new BadRequestException('Chave PIX (telefone) inválida.');
        return phone;
      }
      default:
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
          throw new BadRequestException('Chave PIX aleatória inválida.');
        }
        return value.toLowerCase();
    }
  }
}

export function toView(account: BankAccount | null) {
  if (!account) return null;
  return {
    id: account.id,
    holderName: account.holderName,
    bankCode: account.bankCode,
    branch: account.branch,
    accountLast4: account.accountLast4,
    accountType: account.accountType,
    pixKeyType: account.pixKeyType,
    pixKeyMasked: account.pixKeyMasked,
    verified: !!account.verifiedAt,
    updatedAt: account.updatedAt,
  };
}

function maskPix(key: string): string {
  if (key.includes('@')) {
    const [user, domain] = key.split('@');
    return `${user.slice(0, 2)}***@${domain}`;
  }
  return key.length <= 4 ? '****' : `${'*'.repeat(Math.max(4, key.length - 4))}${key.slice(-4)}`;
}
