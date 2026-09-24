import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { isWithinOpeningHours, localWeekMinute, validateOpeningHours } from './opening-hours';
import { assertRequirements, resolveAdminTransition, resolveOwnerSubmit, slugify } from './partner-workflow';
import { toAuthUser, AccessProfile } from './auth/auth-user';
import { diff, redact } from '../modules/audit/audit.service';

const actor = (permissions: string[]) =>
  toAuthUser(
    {
      userId: 'u1',
      tenantId: 't1',
      status: 'ACTIVE',
      roles: [],
      permissions,
      isStaff: true,
      customerId: null,
      driverId: null,
      companies: [{ companyId: 'c1', roleKey: 'company_owner', permissions: ['company.products.manage'] }],
    } satisfies AccessProfile,
    'session',
  );

describe('Horário de funcionamento', () => {
  it('rejeita turnos sobrepostos e horários iguais', () => {
    expect(() => validateOpeningHours([{ weekday: 1, opensAt: '08:00', closesAt: '08:00' }])).toThrow(BadRequestException);
    expect(() =>
      validateOpeningHours([
        { weekday: 1, opensAt: '08:00', closesAt: '14:00' },
        { weekday: 1, opensAt: '13:00', closesAt: '18:00' },
      ]),
    ).toThrow('sobrepostos');
    // Turno noturno de sábado (até 02:00 de domingo) conflita com domingo 01:00
    expect(() =>
      validateOpeningHours([
        { weekday: 6, opensAt: '18:00', closesAt: '02:00' },
        { weekday: 0, opensAt: '01:00', closesAt: '05:00' },
      ]),
    ).toThrow('sobrepostos');
    expect(() =>
      validateOpeningHours([
        { weekday: 1, opensAt: '08:00', closesAt: '12:00' },
        { weekday: 1, opensAt: '14:00', closesAt: '22:00' },
      ]),
    ).not.toThrow();
  });

  it('avalia se está aberto no fuso da loja, incluindo turnos após a meia-noite', () => {
    const hours = [
      { weekday: 1, opensAt: '08:00', closesAt: '18:00' },
      { weekday: 5, opensAt: '18:00', closesAt: '02:00' },
    ];
    // Segunda, 10:00 em São Paulo (13:00 UTC)
    expect(isWithinOpeningHours(hours, new Date('2026-09-21T13:00:00Z'), 'America/Sao_Paulo')).toBe(true);
    // Segunda, 19:00 em São Paulo
    expect(isWithinOpeningHours(hours, new Date('2026-09-21T22:00:00Z'), 'America/Sao_Paulo')).toBe(false);
    // Sábado 01:00 em São Paulo — ainda no turno de sexta
    expect(isWithinOpeningHours(hours, new Date('2026-09-26T04:00:00Z'), 'America/Sao_Paulo')).toBe(true);
    // Mesmo instante em Manaus (UTC-4) é sábado 00:00 — também dentro do turno
    expect(localWeekMinute(new Date('2026-09-26T04:00:00Z'), 'America/Manaus')).toEqual({ weekday: 6, minute: 0 });
  });
});

describe('Fluxo de aprovação de parceiros', () => {
  it('revisor aprova, gestor suspende, e cada um precisa da permissão certa', () => {
    expect(resolveAdminTransition(actor(['companies.review']), 'APPROVE', 'UNDER_REVIEW', undefined, { review: 'companies.review', manage: 'companies.manage' })).toBe('APPROVED');
    expect(() =>
      resolveAdminTransition(actor(['companies.review']), 'SUSPEND', 'APPROVED', 'x', { review: 'companies.review', manage: 'companies.manage' }),
    ).toThrow(ForbiddenException);
    expect(() =>
      resolveAdminTransition(actor(['companies.review']), 'APPROVE', 'DRAFT', undefined, { review: 'companies.review', manage: 'companies.manage' }),
    ).toThrow(ConflictException);
  });

  it('exige motivo para reprovação', () => {
    expect(() =>
      resolveAdminTransition(actor(['companies.review']), 'REJECT', 'UNDER_REVIEW', ' ', { review: 'companies.review', manage: 'companies.manage' }),
    ).toThrow('Informe o motivo');
  });

  it('titular só envia a partir de rascunho, pendência ou reprovação', () => {
    expect(resolveOwnerSubmit('DRAFT')).toBe('UNDER_REVIEW');
    expect(resolveOwnerSubmit('PENDING_DOCUMENTS')).toBe('UNDER_REVIEW');
    expect(() => resolveOwnerSubmit('APPROVED')).toThrow(ConflictException);
  });

  it('lista pendências do checklist', () => {
    expect(() => assertRequirements([{ key: 'a', label: 'Endereço', done: false }])).toThrow(BadRequestException);
    expect(() => assertRequirements([{ key: 'a', label: 'Endereço', done: true }])).not.toThrow();
  });

  it('gera slugs legíveis', () => {
    expect(slugify('Pão & Café — São João!')).toBe('pao-cafe-sao-joao');
    expect(slugify('***')).toBe('empresa');
  });
});

describe('Permissões', () => {
  it('verifica permissões de plataforma e por empresa', () => {
    const user = actor(['orders.read']);
    expect(user.can('orders.read')).toBe(true);
    expect(user.can('orders.manage')).toBe(false);
    expect(user.canInCompany('c1', 'company.products.manage')).toBe(true);
    expect(user.canInCompany('c2', 'company.products.manage')).toBe(false);
  });
});

describe('Auditoria', () => {
  it('mascara campos sensíveis', () => {
    expect(redact({ name: 'Ana', passwordHash: 'x', nested: { cpfEncrypted: 'y', city: 'SP' } })).toEqual({
      name: 'Ana',
      passwordHash: '[REDACTED]',
      nested: { cpfEncrypted: '[REDACTED]', city: 'SP' },
    });
  });

  it('registra apenas campos alterados', () => {
    expect(diff({ a: 1, b: 2, d: new Date(0) }, { a: 1, b: 3, d: new Date(0) })).toEqual({ before: { b: 2 }, after: { b: 3 } });
  });
});
