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

test('B2B: cabeçalhos, categorias, comprovação e números no formato brasileiro', async () => {
  const { matchBatchColumn, parseItemCategory, parseProofMethod, parseDecimal, BATCH_COLUMNS } = await import('./index');
  assert.equal(matchBatchColumn('Destinatário'), 'recipientName');
  assert.equal(matchBatchColumn('Nº'), 'number');
  assert.equal(matchBatchColumn('coluna qualquer'), null);
  assert.equal(matchBatchColumn('número'), 'number');
  assert.equal(matchBatchColumn('Centro de Custo'), 'costCenter');
  assert.equal(matchBatchColumn('lon'), 'lng');
  assert.equal(parseItemCategory('Documentos'), 'DOCUMENT');
  assert.equal(parseItemCategory('package'), 'PACKAGE');
  assert.equal(parseItemCategory('foguete'), null);
  assert.equal(parseProofMethod('Assinatura digital'), 'SIGNATURE');
  assert.equal(parseProofMethod('assinatura'), 'SIGNATURE');
  assert.equal(parseProofMethod('QR'), 'QR_CODE');
  assert.equal(parseDecimal('1.234,56'), 1234.56);
  assert.equal(parseDecimal('R$ 12,90'), 12.9);
  assert.equal(parseDecimal('0.5'), 0.5);
  assert.equal(parseDecimal('abc'), null);
  // Cada coluna tem cabeçalho único.
  assert.equal(new Set(BATCH_COLUMNS.map((column) => column.header)).size, BATCH_COLUMNS.length);
});

test('Inteligência: faixas horárias e rótulos completos', async () => {
  const { etaBand, ETA_BAND_LABELS, REVIEW_THEMES, REVIEW_THEME_LABELS, RISK_SIGNAL_TYPES } = await import('./index');
  assert.deepEqual([0, 5, 6, 10, 11, 13, 14, 17, 18, 21, 22, 23].map(etaBand), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.equal(ETA_BAND_LABELS.length, 6);
  assert.ok(REVIEW_THEMES.every((theme) => REVIEW_THEME_LABELS[theme].length > 0));
  assert.ok(RISK_SIGNAL_TYPES.includes('MOCK_LOCATION'));
  const { cityKey } = await import('./index');
  assert.equal(cityKey(' São Paulo ', 'SP'), 'sao paulo/sp');
  assert.equal(cityKey('Jundiaí', null), 'jundiai/');
});

test('Escala: paleta da marca, domínios e planos padrão', async () => {
  const { brandPalette, isValidDomain, isHexColor, DEFAULT_PLANS, PLAN_FEATURES, PLAN_LIMIT_KEYS, API_KEY_SCOPES } = await import('./index');
  const palette = brandPalette('#2A78D6');
  assert.equal(palette[500], '#2a78d6');
  assert.ok(isHexColor(palette[50]) && isHexColor(palette[900]));
  assert.notEqual(palette[50], palette[900]);
  assert.equal(brandPalette('vermelho')[500], '#ff5a1f');
  assert.ok(isValidDomain('entregas.empresa.com.br'));
  assert.ok(!isValidDomain('https://empresa.com.br'));
  assert.ok(!isValidDomain('localhost'));
  assert.ok(!isValidDomain('empresa.com.br/loja'));
  assert.equal(DEFAULT_PLANS.filter((plan) => plan.isDefault).length, 1);
  for (const plan of DEFAULT_PLANS) {
    assert.ok(plan.features.every((feature) => PLAN_FEATURES.includes(feature)));
    assert.deepEqual(Object.keys(plan.limits).sort(), [...PLAN_LIMIT_KEYS].sort());
  }
  assert.ok(Object.values(API_KEY_SCOPES).every((scope) => PLAN_FEATURES.includes(scope.feature)));
});
