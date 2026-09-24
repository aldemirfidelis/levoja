import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateCents,
  applyBps,
  availablePartnerActions,
  canTransitionDelivery,
  canTransitionOrder,
  geohash,
  haversineKm,
  isAdult,
  isValidCnpj,
  isValidCpf,
  normalizeBrazilianPhone,
  partnerTransition,
  passwordIssues,
  pointInPolygon,
  PERMISSIONS,
  resolveRolePermissions,
  SYSTEM_ROLES,
} from './index';

test('CPF válido e inválido', () => {
  assert.equal(isValidCpf('529.982.247-25'), true);
  assert.equal(isValidCpf('52998224725'), true);
  assert.equal(isValidCpf('529.982.247-24'), false);
  assert.equal(isValidCpf('111.111.111-11'), false);
  assert.equal(isValidCpf('123'), false);
});

test('CNPJ numérico e alfanumérico', () => {
  assert.equal(isValidCnpj('11.222.333/0001-81'), true);
  assert.equal(isValidCnpj('11222333000181'), true);
  assert.equal(isValidCnpj('11.222.333/0001-80'), false);
  assert.equal(isValidCnpj('00000000000000'), false);
  // Exemplo oficial da Receita Federal para o CNPJ alfanumérico
  assert.equal(isValidCnpj('12.ABC.345/01DE-35'), true);
  assert.equal(isValidCnpj('12abc34501de35'), true);
  assert.equal(isValidCnpj('12.ABC.345/01DE-34'), false);
});

test('telefone brasileiro é normalizado para E.164', () => {
  assert.equal(normalizeBrazilianPhone('(11) 98765-4321'), '+5511987654321');
  assert.equal(normalizeBrazilianPhone('+55 11 98765-4321'), '+5511987654321');
  assert.equal(normalizeBrazilianPhone('1133334444'), '+551133334444');
  assert.equal(normalizeBrazilianPhone('11 88765-4321'), null);
  assert.equal(normalizeBrazilianPhone('123'), null);
});

test('política de senha', () => {
  assert.deepEqual(passwordIssues('senhaForte123'), []);
  assert.ok(passwordIssues('curta1').length > 0);
  assert.ok(passwordIssues('semnumeros').length > 0);
});

test('maioridade', () => {
  const ref = new Date('2026-09-23T12:00:00Z');
  assert.equal(isAdult(new Date('2008-09-23T00:00:00Z'), ref), true);
  assert.equal(isAdult(new Date('2008-09-24T00:00:00Z'), ref), false);
});

test('máquina de estados de parceiros', () => {
  assert.equal(partnerTransition('SUBMIT', 'DRAFT')?.to, 'UNDER_REVIEW');
  assert.equal(partnerTransition('APPROVE', 'DRAFT'), null);
  assert.equal(partnerTransition('REQUEST_CHANGES', 'UNDER_REVIEW')?.to, 'PENDING_DOCUMENTS');
  assert.deepEqual(availablePartnerActions('UNDER_REVIEW', 'REVIEWER').sort(), ['APPROVE', 'REJECT', 'REQUEST_CHANGES']);
  assert.deepEqual(availablePartnerActions('APPROVED', 'MANAGER').sort(), ['BLOCK', 'SUSPEND']);
});

test('transições de pedido e entrega', () => {
  assert.equal(canTransitionOrder('NEW', 'CONFIRMED'), true);
  assert.equal(canTransitionOrder('NEW', 'DELIVERED'), false);
  assert.equal(canTransitionOrder('DELIVERED', 'CANCELED'), false);
  assert.equal(canTransitionDelivery('SEARCHING_DRIVER', 'DRIVER_ASSIGNED'), true);
  assert.equal(canTransitionDelivery('PICKED_UP', 'CANCELED'), false);
});

test('dinheiro em centavos sem perdas', () => {
  assert.equal(applyBps(10_000, 1_250), 1_250);
  assert.equal(applyBps(999, 1_000), 100);
  const parts = allocateCents(1000, [1, 1, 1]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 1000);
  assert.deepEqual(parts, [334, 333, 333]);
});

test('geografia', () => {
  const paulista = { lat: -23.5614, lng: -46.6559 };
  const se = { lat: -23.5505, lng: -46.6333 };
  const km = haversineKm(paulista, se);
  assert.ok(km > 2.4 && km < 2.8, `distância inesperada: ${km}`);
  const square: [number, number][] = [
    [-47, -24],
    [-46, -24],
    [-46, -23],
    [-47, -23],
  ];
  assert.equal(pointInPolygon(paulista, square), true);
  assert.equal(pointInPolygon({ lat: -22, lng: -46.5 }, square), false);
  assert.equal(geohash({ lat: -23.5505, lng: -46.6333 }, 5), '6gyf4');
});

test('papéis de sistema referenciam apenas permissões existentes', () => {
  const keys = new Set<string>(PERMISSIONS.map((perm) => perm.key));
  for (const role of SYSTEM_ROLES) {
    for (const perm of resolveRolePermissions(role)) assert.ok(keys.has(perm), `${role.key} -> ${perm}`);
  }
  const superAdmin = resolveRolePermissions(SYSTEM_ROLES.find((r) => r.key === 'super_admin')!);
  const admin = resolveRolePermissions(SYSTEM_ROLES.find((r) => r.key === 'admin')!);
  assert.ok(superAdmin.includes('tenants.manage'));
  assert.ok(!admin.includes('tenants.manage'));
  assert.ok(!superAdmin.includes('customer.orders.create'));
});

test('vocabulário financeiro e descrição de cupons', async () => {
  const { describeCoupon, LEDGER_ENTRY_LABELS, LEDGER_ENTRY_TYPES, formatBRL: brl } = await import('./index');
  for (const type of LEDGER_ENTRY_TYPES) assert.ok(LEDGER_ENTRY_LABELS[type]);
  assert.equal(describeCoupon({ type: 'FREE_DELIVERY' }, brl), 'Entrega grátis');
  assert.match(describeCoupon({ type: 'PERCENT', percentBps: 1000, maxDiscountCents: 1500 }, brl), /^10% \(até R\$\s15,00\)$/);
  assert.match(describeCoupon({ type: 'FIXED', amountCents: 500 }, brl), /R\$\s5,00 de desconto/);
});

test('saques ficam com proprietário e financeiro da empresa', () => {
  const keys = (key: string) => resolveRolePermissions(SYSTEM_ROLES.find((r) => r.key === key)!);
  assert.ok(keys('company_owner').includes('company.finance.withdraw'));
  assert.ok(keys('company_finance').includes('company.finance.withdraw'));
  assert.ok(!keys('company_manager').includes('company.finance.withdraw'));
  assert.ok(!keys('company_attendant').includes('company.finance.read'));
});
