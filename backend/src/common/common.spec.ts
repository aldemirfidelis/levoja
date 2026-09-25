import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { isWithinOpeningHours, localWeekMinute, validateOpeningHours } from './opening-hours';
import { assertRequirements, resolveAdminTransition, resolveOwnerSubmit, slugify } from './partner-workflow';
import { toAuthUser, AccessProfile } from './auth/auth-user';
import { diff, redact } from '../modules/audit/audit.service';
import { SETTINGS, withDefaults } from '../modules/settings/settings.service';
import { isTransientConflict, retryOnConflict } from './retry';

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

describe('Configurações salvas antes de campos novos', () => {
  it('mescla o valor salvo sobre o padrão (dois níveis) e mantém listas salvas', () => {
    const stored = { enabled: true, points: { SHARED_DEVICE: 40 }, tiers: [{ key: 'unico' }] };
    const merged = withDefaults({ enabled: false, halfLifeDays: 30, points: { SHARED_DEVICE: 30, REFERRAL_ABUSE: 25 }, tiers: [{ key: 'a' }, { key: 'b' }] }, stored);
    expect(merged).toEqual({ enabled: true, halfLifeDays: 30, points: { SHARED_DEVICE: 40, REFERRAL_ABUSE: 25 }, tiers: [{ key: 'unico' }] });
    expect(withDefaults({ a: 1 }, null)).toEqual({ a: 1 });
  });

  it('configuração antiga do antifraude continua válida com o sinal novo de indicação', () => {
    const { REFERRAL_ABUSE: _new, ...oldPoints } = SETTINGS.fraud.default.points as Record<string, number>;
    const parsed = SETTINGS.fraud.schema.safeParse(withDefaults(SETTINGS.fraud.default, { ...SETTINGS.fraud.default, points: oldPoints }));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.points.REFERRAL_ABUSE).toBe(25);
  });

  it('regras padrão de fidelidade e indicação são válidas', () => {
    expect(SETTINGS.loyalty.schema.safeParse(SETTINGS.loyalty.default).success).toBe(true);
    expect(SETTINGS.referral.schema.safeParse(SETTINGS.referral.default).success).toBe(true);
    expect(SETTINGS.loyalty.schema.safeParse({ ...SETTINGS.loyalty.default, tiers: [{ key: 'ouro', name: 'Ouro', minPoints: 10, multiplierBps: 10_000, cashbackBps: 0 }] }).success).toBe(false);
  });
});

describe('Conflitos de concorrência', () => {
  it('reconhece deadlock e erro de serialização', () => {
    expect(isTransientConflict(new Error('deadlock detected'))).toBe(true);
    expect(isTransientConflict(Object.assign(new Error('falhou'), { meta: { code: '40001' } }))).toBe(true);
    expect(isTransientConflict(new Error('Saldo insuficiente'))).toBe(false);
  });

  it('repete só o que é transitório', async () => {
    let calls = 0;
    await expect(retryOnConflict(async () => (++calls < 3 ? Promise.reject(new Error('deadlock detected')) : 'ok'))).resolves.toBe('ok');
    expect(calls).toBe(3);
    calls = 0;
    await expect(retryOnConflict(async () => { calls++; throw new Error('Saldo insuficiente'); })).rejects.toThrow('Saldo insuficiente');
    expect(calls).toBe(1);
  });
});
