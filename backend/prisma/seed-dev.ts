/**
 * Dados FICTÍCIOS para desenvolvimento e demonstração.
 * NUNCA execute em produção (o script se recusa quando NODE_ENV=production).
 *
 *   pnpm --filter @levoja/backend db:seed:dev
 *
 * Todas as contas usam a senha de DEV_SEED_PASSWORD (ou uma senha aleatória exibida ao final).
 */
import 'reflect-metadata';
import 'dotenv/config';
import { createCipheriv, createHmac, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import type { VehicleType } from '../src/generated/prisma/enums';
import { seedEssentials } from './seed';

if (process.env.NODE_ENV === 'production') {
  console.error('seed-dev é exclusivo para desenvolvimento. Abortado.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const encryptionKey = Buffer.from(process.env.DATA_ENCRYPTION_KEY!, 'base64');
const hashKey = Buffer.from(process.env.DATA_HASH_KEY!, 'base64');

// Mesmo formato do CryptoService (v1:iv:tag:data)
function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join(':');
}
const cpfHash = (cpf: string) => createHmac('sha256', hashKey).update(`cpf:${cpf}`).digest('hex');

// Gerador determinístico (resultados estáveis entre execuções)
let state = 20260923;
const random = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
const between = (min: number, max: number) => Math.floor(random() * (max - min + 1)) + min;

function cpf(): string {
  const d = Array.from({ length: 9 }, () => between(0, 9));
  const calc = (len: number) => {
    const sum = d.slice(0, len).reduce((total, value, i) => total + value * (len + 1 - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  d.push(calc(9));
  d.push(calc(10));
  return d.join('');
}

function cnpj(): string {
  const d = [...Array.from({ length: 8 }, () => between(0, 9)), 0, 0, 0, 1];
  const calc = (weights: number[]) => {
    const rest = weights.reduce((total, weight, i) => total + d[i] * weight, 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  d.push(calc([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  d.push(calc([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  return d.join('');
}

const FIRST = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Larissa', 'Marcos', 'Natália', 'Otávio', 'Paula', 'Rafael', 'Sofia', 'Thiago', 'Vitória', 'William'];
const LAST = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes', 'Costa', 'Ribeiro', 'Martins', 'Carvalho', 'Almeida'];
const DISTRICTS = [
  { district: 'Bela Vista', street: 'Avenida Paulista', lat: -23.5614, lng: -46.6559, zip: '01310100' },
  { district: 'Pinheiros', street: 'Rua dos Pinheiros', lat: -23.5663, lng: -46.6834, zip: '05422001' },
  { district: 'Vila Madalena', street: 'Rua Harmonia', lat: -23.5552, lng: -46.6906, zip: '05435000' },
  { district: 'Moema', street: 'Avenida Ibirapuera', lat: -23.6009, lng: -46.6645, zip: '04029000' },
  { district: 'Liberdade', street: 'Rua da Glória', lat: -23.5587, lng: -46.6335, zip: '01510000' },
  { district: 'Consolação', street: 'Rua Augusta', lat: -23.5534, lng: -46.6573, zip: '01305000' },
  { district: 'Vila Mariana', street: 'Rua Domingos de Morais', lat: -23.5889, lng: -46.6357, zip: '04010000' },
  { district: 'Perdizes', street: 'Rua Cardoso de Almeida', lat: -23.5372, lng: -46.6752, zip: '05013000' },
];

const COMPANIES = [
  { tradeName: 'Cantina da Nonna', segment: 'restaurantes' },
  { tradeName: 'Burger Paulista', segment: 'restaurantes' },
  { tradeName: 'Sushi Liberdade', segment: 'restaurantes' },
  { tradeName: 'Farmácia Saúde Já', segment: 'farmacias' },
  { tradeName: 'Drogaria Bem Estar', segment: 'farmacias' },
  { tradeName: 'Mercadinho do Bairro', segment: 'mercado' },
  { tradeName: 'Empório Natural', segment: 'mercado' },
  { tradeName: 'Tech Store Augusta', segment: 'lojas' },
  { tradeName: 'Conveniência 24h', segment: 'conveniencia' },
  { tradeName: 'Floricultura Primavera', segment: 'presentes' },
];

function address(index: number) {
  const base = DISTRICTS[index % DISTRICTS.length];
  return {
    zipCode: base.zip,
    street: base.street,
    number: String(between(10, 2500)),
    district: base.district,
    city: 'São Paulo',
    state: 'SP',
    lat: base.lat + (random() - 0.5) * 0.01,
    lng: base.lng + (random() - 0.5) * 0.01,
  };
}

async function main() {
  const tenant = await seedEssentials(prisma, { quiet: true });
  const password = process.env.DEV_SEED_PASSWORD || `Dev${randomBytes(6).toString('hex')}1`;
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const role = async (key: string) => prisma.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId: tenant.id, key } } });
  const [customerRole, driverRole, ownerRole] = await Promise.all([role('customer'), role('driver'), role('company_owner')]);
  const segments = new Map((await prisma.segment.findMany({ where: { tenantId: tenant.id } })).map((s) => [s.slug, s]));
  const now = new Date();

  const existing = await prisma.user.count({ where: { tenantId: tenant.id, email: { endsWith: '@dev.levoja.local' } } });
  if (existing > 0) {
    console.log('Pessoas e empresas de desenvolvimento já existem — completando catálogo e histórico, se faltarem.');
    await seedCatalog(tenant.id);
    await seedHistory(tenant.id);
    await seedCoupons(tenant.id);
    return;
  }

  const person = (i: number, domain = 'dev.levoja.local') => {
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
    const document = cpf();
    return {
      tenantId: tenant.id,
      name,
      email: `${name.toLowerCase().normalize('NFKD').replace(/[^\w ]/g, '').replace(/ /g, '.')}.${i}@${domain}`,
      phone: `+55119${String(70000000 + i * 1373).slice(0, 8)}`,
      passwordHash,
      cpfEncrypted: encrypt(document),
      cpfHash: cpfHash(document),
      birthDate: new Date(Date.UTC(1975 + (i % 25), i % 12, 1 + (i % 27))),
      emailVerifiedAt: now,
      preferences: { theme: 'system' },
    };
  };

  const consents = (userId: string, extra: ('DRIVER_TERMS' | 'COMPANY_TERMS' | 'LOCATION_TRACKING')[] = []) =>
    prisma.consent.createMany({
      data: [
        { userId, type: 'TERMS_OF_USE' as const, granted: true, version: '1.0' },
        { userId, type: 'PRIVACY_POLICY' as const, granted: true, version: '1.0' },
        ...extra.map((type) => ({ userId, type, granted: true, version: type === 'LOCATION_TRACKING' ? null : '1.0' })),
      ],
    });

  // --- 10 empresas aprovadas e abertas ---
  for (const [i, spec] of COMPANIES.entries()) {
    const owner = await prisma.user.create({ data: { ...person(100 + i) } });
    await consents(owner.id, ['COMPANY_TERMS']);
    const document = cpf();
    const addr = await prisma.address.create({ data: address(i) });
    const company = await prisma.company.create({
      data: {
        tenantId: tenant.id,
        segmentId: segments.get(spec.segment)!.id,
        legalName: `${spec.tradeName} Comércio LTDA`,
        tradeName: spec.tradeName,
        slug: spec.tradeName.toLowerCase().normalize('NFKD').replace(/[^\w ]/g, '').trim().replace(/\s+/g, '-'),
        cnpj: cnpj(),
        responsibleName: owner.name,
        responsibleCpfEncrypted: encrypt(document),
        responsibleCpfHash: cpfHash(document),
        email: `contato.${i}@empresa.dev.levoja.local`,
        phone: `+55113${String(3000000 + i * 911).slice(0, 7)}`,
        description: `${spec.tradeName}: qualidade e rapidez na sua casa.`,
        addressId: addr.id,
        status: 'APPROVED',
        submittedAt: now,
        approvedAt: now,
        isOpen: true,
        averagePrepMinutes: spec.segment === 'restaurantes' ? between(20, 40) : between(5, 15),
        minimumOrderCents: spec.segment === 'restaurantes' ? 2000 : 0,
        members: { create: { userId: owner.id, roleId: ownerRole.id } },
        openingHours: {
          create: [0, 1, 2, 3, 4, 5, 6].map((weekday) =>
            spec.segment === 'conveniencia' ? { weekday, opensAt: '00:00', closesAt: '23:59' } : { weekday, opensAt: '08:00', closesAt: '23:00' },
          ),
        },
        statusHistory: {
          create: [
            { fromStatus: 'DRAFT', toStatus: 'UNDER_REVIEW', action: 'SUBMIT', changedById: owner.id },
            { fromStatus: 'UNDER_REVIEW', toStatus: 'APPROVED', action: 'APPROVE' },
          ],
        },
      },
    });
    await prisma.bankAccount.create({
      data: {
        tenantId: tenant.id,
        companyId: company.id,
        holderName: company.legalName,
        holderDocumentEncrypted: encrypt(company.cnpj),
        bankCode: '260',
        branch: '0001',
        accountNumberEncrypted: encrypt(`${between(100000, 999999)}`),
        accountLast4: String(between(1000, 9999)),
        accountType: 'CHECKING',
        pixKeyType: 'CNPJ',
        pixKeyEncrypted: encrypt(company.cnpj),
        pixKeyMasked: `**********${company.cnpj.slice(-4)}`,
        verifiedAt: now,
      },
    });
  }
  console.log(`✔ ${COMPANIES.length} empresas aprovadas`);

  // --- 30 clientes com endereço ---
  for (let i = 0; i < 30; i++) {
    const user = await prisma.user.create({
      data: {
        ...person(i),
        roles: { create: { roleId: customerRole.id } },
        customer: { create: { tenantId: tenant.id } },
        addresses: { create: { ...address(i), label: 'Casa', isDefault: true } },
      },
    });
    await consents(user.id);
  }
  console.log('✔ 30 clientes');

  // --- 20 entregadores aprovados ---
  const vehicleTypes: VehicleType[] = ['MOTORCYCLE', 'MOTORCYCLE', 'MOTORCYCLE', 'BICYCLE', 'CAR'];
  for (let i = 0; i < 20; i++) {
    const user = await prisma.user.create({ data: { ...person(200 + i), roles: { create: { roleId: driverRole.id } } } });
    await consents(user.id, ['DRIVER_TERMS', 'LOCATION_TRACKING']);
    const type = vehicleTypes[i % vehicleTypes.length];
    const addr = await prisma.address.create({ data: address(i + 3) });
    const driver = await prisma.driver.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        addressId: addr.id,
        status: 'APPROVED',
        submittedAt: now,
        approvedAt: now,
        cnhNumberEncrypted: type === 'BICYCLE' ? null : encrypt(String(10000000000 + i * 7919)),
        cnhCategory: type === 'CAR' ? 'B' : type === 'BICYCLE' ? null : 'A',
        cnhExpiresAt: type === 'BICYCLE' ? null : new Date(Date.UTC(2030, i % 12, 1)),
        ratingAvg: Number((4.3 + random() * 0.7).toFixed(2)),
        ratingCount: between(5, 300),
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        driverId: driver.id,
        type,
        status: 'APPROVED',
        plate: type === 'BICYCLE' ? null : `${pick(['FGH', 'ABC', 'QWE', 'RTY'])}${between(1, 9)}${pick(['A', 'B', 'C', 'D'])}${between(10, 99)}`,
        brand: type === 'BICYCLE' ? 'Caloi' : type === 'CAR' ? 'Fiat' : 'Honda',
        model: type === 'BICYCLE' ? 'Urbam' : type === 'CAR' ? 'Fiorino' : 'CG 160',
        year: between(2016, 2025),
        maxWeightKg: type === 'CAR' ? 500 : type === 'BICYCLE' ? 10 : 25,
      },
    });
    await prisma.driver.update({ where: { id: driver.id }, data: { activeVehicleId: vehicle.id } });
    await prisma.bankAccount.create({
      data: {
        tenantId: tenant.id,
        driverId: driver.id,
        holderName: user.name,
        holderDocumentEncrypted: user.cpfEncrypted!,
        bankCode: '260',
        branch: '0001',
        accountNumberEncrypted: encrypt(`${between(100000, 999999)}`),
        accountLast4: String(between(1000, 9999)),
        accountType: 'PAYMENT',
        pixKeyType: 'EMAIL',
        pixKeyEncrypted: encrypt(user.email),
        pixKeyMasked: `${user.email.slice(0, 2)}***@${user.email.split('@')[1]}`,
      },
    });
  }
  console.log('✔ 20 entregadores aprovados');

  await seedCatalog(tenant.id);
  await seedHistory(tenant.id);
  await seedCoupons(tenant.id);

  console.log('\nContas de desenvolvimento (domínio @dev.levoja.local):');
  const sample = await prisma.user.findMany({
    where: { tenantId: tenant.id, email: { endsWith: '@dev.levoja.local' } },
    select: { email: true, customer: { select: { id: true } }, driver: { select: { id: true } }, companyMemberships: { select: { id: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const firstOf = (predicate: (u: (typeof sample)[number]) => boolean) => sample.find(predicate)?.email;
  console.log(`  Cliente:     ${firstOf((u) => !!u.customer)}`);
  console.log(`  Empresa:     ${firstOf((u) => u.companyMemberships.length > 0)}`);
  console.log(`  Entregador:  ${firstOf((u) => !!u.driver)}`);
  console.log(`  Senha:       ${process.env.DEV_SEED_PASSWORD ? '(valor de DEV_SEED_PASSWORD)' : password}`);
}

// -----------------------------------------------------------------------------
// Catálogo: 10 produtos por empresa (100 no total)
// -----------------------------------------------------------------------------

type ProductSeed = { name: string; price: number; category: string; weight?: number; minimumAge?: number; requiresPrescription?: boolean; stock?: number };

const CATALOG: Record<string, ProductSeed[]> = {
  restaurantes: [
    { name: 'Lasanha à bolonhesa', price: 4290, category: 'Pratos', weight: 600 },
    { name: 'Nhoque ao sugo', price: 3690, category: 'Pratos', weight: 500 },
    { name: 'Filé à parmegiana', price: 5490, category: 'Pratos', weight: 700 },
    { name: 'Salada Caesar', price: 2990, category: 'Entradas', weight: 350 },
    { name: 'Bruschetta (4 un.)', price: 2490, category: 'Entradas', weight: 300 },
    { name: 'Tiramisù', price: 1990, category: 'Sobremesas', weight: 200 },
    { name: 'Pudim de leite', price: 1490, category: 'Sobremesas', weight: 200 },
    { name: 'Suco natural 500 ml', price: 1190, category: 'Bebidas', weight: 550 },
    { name: 'Refrigerante lata', price: 690, category: 'Bebidas', weight: 360, stock: 120 },
    { name: 'Água sem gás', price: 450, category: 'Bebidas', weight: 520, stock: 200 },
  ],
  farmacias: [
    { name: 'Dipirona 500 mg (10 comp.)', price: 890, category: 'Medicamentos', weight: 30, stock: 300 },
    { name: 'Paracetamol 750 mg (20 comp.)', price: 1290, category: 'Medicamentos', weight: 40, stock: 300 },
    { name: 'Amoxicilina 500 mg', price: 3490, category: 'Medicamentos', weight: 60, stock: 80, requiresPrescription: true },
    { name: 'Protetor solar FPS 50', price: 5990, category: 'Cuidados', weight: 220, stock: 60 },
    { name: 'Escova dental macia', price: 1190, category: 'Higiene', weight: 30, stock: 150 },
    { name: 'Creme dental 90 g', price: 790, category: 'Higiene', weight: 100, stock: 200 },
    { name: 'Álcool em gel 500 ml', price: 1590, category: 'Higiene', weight: 520, stock: 100 },
    { name: 'Termômetro digital', price: 2990, category: 'Equipamentos', weight: 50, stock: 40 },
    { name: 'Vitamina C 1 g', price: 2490, category: 'Suplementos', weight: 120, stock: 90 },
    { name: 'Fralda infantil M (30 un.)', price: 5490, category: 'Infantil', weight: 1200, stock: 50 },
  ],
  mercado: [
    { name: 'Arroz 5 kg', price: 2890, category: 'Mercearia', weight: 5000, stock: 80 },
    { name: 'Feijão carioca 1 kg', price: 849, category: 'Mercearia', weight: 1000, stock: 120 },
    { name: 'Café 500 g', price: 1790, category: 'Mercearia', weight: 500, stock: 90 },
    { name: 'Leite integral 1 L', price: 549, category: 'Laticínios', weight: 1030, stock: 200 },
    { name: 'Queijo muçarela 200 g', price: 1290, category: 'Laticínios', weight: 200, stock: 60 },
    { name: 'Banana prata (kg)', price: 699, category: 'Hortifruti', weight: 1000, stock: 100 },
    { name: 'Tomate (kg)', price: 899, category: 'Hortifruti', weight: 1000, stock: 100 },
    { name: 'Pão de forma', price: 899, category: 'Padaria', weight: 500, stock: 70 },
    { name: 'Ovos (12 un.)', price: 1190, category: 'Mercearia', weight: 700, stock: 80 },
    { name: 'Sabão em pó 1 kg', price: 1590, category: 'Limpeza', weight: 1000, stock: 60 },
  ],
  lojas: [
    { name: 'Fone Bluetooth', price: 19_990, category: 'Áudio', weight: 250, stock: 30 },
    { name: 'Carregador USB-C 20 W', price: 8990, category: 'Acessórios', weight: 120, stock: 50 },
    { name: 'Cabo USB-C 1 m', price: 3990, category: 'Acessórios', weight: 50, stock: 80 },
    { name: 'Capinha de celular', price: 4990, category: 'Acessórios', weight: 60, stock: 60 },
    { name: 'Power bank 10.000 mAh', price: 12_990, category: 'Acessórios', weight: 250, stock: 25 },
    { name: 'Mouse sem fio', price: 7990, category: 'Informática', weight: 150, stock: 30 },
    { name: 'Teclado compacto', price: 14_990, category: 'Informática', weight: 500, stock: 20 },
    { name: 'Caixa de som portátil', price: 24_990, category: 'Áudio', weight: 700, stock: 15 },
    { name: 'Pendrive 64 GB', price: 4490, category: 'Informática', weight: 20, stock: 60 },
    { name: 'Película de vidro', price: 2990, category: 'Acessórios', weight: 30, stock: 100 },
  ],
  conveniencia: [
    { name: 'Cerveja lata 350 ml', price: 590, category: 'Bebidas', weight: 360, minimumAge: 18, stock: 300 },
    { name: 'Vinho tinto 750 ml', price: 5990, category: 'Bebidas', weight: 1300, minimumAge: 18, stock: 40 },
    { name: 'Energético 250 ml', price: 1090, category: 'Bebidas', weight: 270, stock: 100 },
    { name: 'Água com gás 500 ml', price: 450, category: 'Bebidas', weight: 520, stock: 200 },
    { name: 'Salgadinho 100 g', price: 890, category: 'Snacks', weight: 100, stock: 120 },
    { name: 'Chocolate 90 g', price: 790, category: 'Snacks', weight: 90, stock: 150 },
    { name: 'Gelo 5 kg', price: 1490, category: 'Outros', weight: 5000, stock: 50 },
    { name: 'Carvão 3 kg', price: 2490, category: 'Outros', weight: 3000, stock: 40 },
    { name: 'Amendoim 150 g', price: 690, category: 'Snacks', weight: 150, stock: 100 },
    { name: 'Biscoito recheado', price: 390, category: 'Snacks', weight: 130, stock: 150 },
  ],
  presentes: [
    { name: 'Buquê de rosas vermelhas', price: 12_990, category: 'Flores', weight: 800, stock: 20 },
    { name: 'Arranjo de girassóis', price: 9990, category: 'Flores', weight: 900, stock: 15 },
    { name: 'Orquídea em vaso', price: 14_990, category: 'Plantas', weight: 1500, stock: 10 },
    { name: 'Cesta de café da manhã', price: 18_990, category: 'Cestas', weight: 3000, stock: 10 },
    { name: 'Caixa de chocolates finos', price: 8990, category: 'Doces', weight: 400, stock: 30 },
    { name: 'Pelúcia urso', price: 6990, category: 'Presentes', weight: 300, stock: 25 },
    { name: 'Cartão personalizado', price: 1490, category: 'Presentes', weight: 20, stock: 100 },
    { name: 'Balão metalizado', price: 2490, category: 'Presentes', weight: 30, stock: 60 },
    { name: 'Suculentas (kit 3)', price: 5990, category: 'Plantas', weight: 900, stock: 20 },
    { name: 'Vela aromática', price: 4990, category: 'Presentes', weight: 350, stock: 30 },
  ],
};

/** Cupons de exemplo: dois da plataforma e um de loja. */
async function seedCoupons(tenantId: string) {
  const company = await prisma.company.findFirst({ where: { tenantId, email: { endsWith: '@empresa.dev.levoja.local' } }, orderBy: { createdAt: 'asc' } });
  const coupons = [
    { code: 'BEMVINDO10', description: '10% na primeira compra (até R$ 15)', type: 'PERCENT' as const, percentBps: 1000, maxDiscountCents: 1500, firstOrderOnly: true, fundedBy: 'PLATFORM' as const, visibility: 'PUBLIC' },
    { code: 'FRETEGRATIS', description: 'Entrega grátis em pedidos acima de R$ 50', type: 'FREE_DELIVERY' as const, minOrderCents: 5000, maxPerCustomer: 3, fundedBy: 'PLATFORM' as const, visibility: 'PUBLIC' },
    { code: 'PRATA15', description: '15% para clientes Prata ou Ouro (até R$ 20)', type: 'PERCENT' as const, percentBps: 1500, maxDiscountCents: 2000, maxPerCustomer: 2, fundedBy: 'PLATFORM' as const, visibility: 'TIER', minTier: 'prata' },
    { code: 'SEGREDO20', description: 'R$ 20 em pedidos acima de R$ 100 (só com o código)', type: 'FIXED' as const, amountCents: 2000, minOrderCents: 10_000, fundedBy: 'PLATFORM' as const },
    ...(company ? [{ code: 'LOJA5', description: `R$ 5 de desconto na ${company.tradeName}`, type: 'FIXED' as const, amountCents: 500, minOrderCents: 3000, companyId: company.id, fundedBy: 'COMPANY' as const, visibility: 'PUBLIC' }] : []),
  ];
  for (const coupon of coupons) {
    await prisma.coupon.upsert({ where: { tenantId_code: { tenantId, code: coupon.code } }, create: { tenantId, weekdays: [], ...coupon }, update: {} });
  }
  console.log(`✔ ${coupons.length} cupons de exemplo (listados, por nível e só com código)`);

  // Fidelidade e Indique e ganhe ligados para demonstração (em produção ficam desligados até o painel ativar).
  const programs: Record<string, unknown> = {
    loyalty: {
      enabled: true,
      pointsPerReal: 1,
      pointValueCents: 1,
      minRedeemPoints: 500,
      expireAfterInactiveDays: 365,
      tiers: [
        { key: 'bronze', name: 'Bronze', minPoints: 0, multiplierBps: 10_000, cashbackBps: 0 },
        { key: 'prata', name: 'Prata', minPoints: 2_000, multiplierBps: 12_500, cashbackBps: 100 },
        { key: 'ouro', name: 'Ouro', minPoints: 6_000, multiplierBps: 15_000, cashbackBps: 200 },
      ],
    },
    referral: {
      enabled: true,
      windowDays: 60,
      maxPerReferrerPerMonth: 20,
      customer: { enabled: true, referrerRewardCents: 1000, referredRewardCents: 1000, minOrderCents: 3000 },
      driver: { enabled: true, referrerRewardCents: 5000, referredRewardCents: 2000, deliveriesRequired: 10 },
      company: { enabled: true, referrerRewardCents: 10_000, referredRewardCents: 5000, ordersRequired: 10 },
    },
  };
  for (const [key, value] of Object.entries(programs)) {
    await prisma.platformSetting.upsert({ where: { tenantId_key: { tenantId, key } }, create: { tenantId, key, value: value as object }, update: {} });
  }
  console.log('✔ Fidelidade e Indique e ganhe ativos (configurações de demonstração)');
}

async function seedCatalog(tenantId: string) {
  const companies = await prisma.company.findMany({
    where: { tenantId, email: { endsWith: '@empresa.dev.levoja.local' } },
    include: { segment: true, _count: { select: { products: true } } },
    orderBy: { createdAt: 'asc' },
  });
  let created = 0;
  for (const company of companies) {
    if (company._count.products > 0) continue;
    const template = CATALOG[company.segment.slug] ?? CATALOG.mercado;
    const categories = new Map<string, string>();
    for (const [index, name] of [...new Set(template.map((product) => product.category))].entries()) {
      const category = await prisma.productCategory.create({ data: { companyId: company.id, name, sortOrder: index * 10 } });
      categories.set(name, category.id);
    }
    for (const [index, product] of template.entries()) {
      await prisma.product.create({
        data: {
          tenantId,
          companyId: company.id,
          categoryId: categories.get(product.category),
          name: product.name,
          priceCents: product.price,
          // Algumas promoções vigentes para a vitrine
          promoPriceCents: index % 4 === 0 ? Math.round(product.price * 0.85) : null,
          weightGrams: product.weight,
          trackStock: product.stock != null,
          stockQuantity: product.stock ?? 0,
          minimumAge: product.minimumAge,
          isRegulated: !!(product.minimumAge || product.requiresPrescription),
          requiresPrescription: !!product.requiresPrescription,
          sortOrder: index,
          sku: `${company.slug.slice(0, 6).toUpperCase()}-${String(index + 1).padStart(3, '0')}`,
        },
      });
      created += 1;
    }
    await prisma.serviceArea.create({ data: { companyId: company.id, name: 'Raio de 8 km', type: 'RADIUS', radiusKm: 8, districts: [], cities: [] } });
  }
  if (created) console.log(`✔ ${created} produtos em ${companies.length} empresas`);
}

// -----------------------------------------------------------------------------
// Histórico: 200 pedidos nos últimos 30 dias (entregues e cancelados), com entregas e avaliações
// -----------------------------------------------------------------------------

async function seedHistory(tenantId: string) {
  const customers = await prisma.customer.findMany({ where: { tenantId, user: { email: { endsWith: '@dev.levoja.local' } } }, include: { user: { include: { addresses: true } } } });
  const alreadySeeded = await prisma.order.count({ where: { customerId: { in: customers.map((c) => c.id) } } });
  if (alreadySeeded >= 200 || !customers.length) return;

  const companies = await prisma.company.findMany({
    where: { tenantId, email: { endsWith: '@empresa.dev.levoja.local' } },
    include: { address: true, products: { where: { deletedAt: null, requiresPrescription: false, minimumAge: null } } },
  });
  const driverRows = await prisma.driver.findMany({ where: { tenantId, user: { email: { endsWith: '@dev.levoja.local' } } }, select: { id: true, userId: true } });
  if (!companies.length || !driverRows.length) return;

  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const counter = await prisma.counter.findUnique({ where: { tenantId_key: { tenantId, key: 'order' } } });
  let number = counter?.value ?? 0;

  for (let i = 0; i < 200; i++) {
    const customer = customers[i % customers.length];
    const company = companies[(i * 7) % companies.length];
    const address = customer.user.addresses[0];
    if (!address || !company.address || !company.products.length) continue;
    number += 1;

    const createdAt = new Date(Date.now() - between(1, 30 * 24 * 60) * 60_000);
    const lines = Array.from({ length: between(1, 3) }, () => {
      const product = pick(company.products);
      const quantity = between(1, 3);
      return { product, quantity };
    });
    const subtotal = lines.reduce((sum, line) => sum + line.product.priceCents * line.quantity, 0);
    const distanceKm = Math.round((1 + random() * 6) * 100) / 100;
    const deliveryFee = 599 + Math.round(Math.max(0, distanceKm - 2) * 150);
    const tip = random() < 0.3 ? pick([200, 300, 500]) : 0;
    const canceled = random() < 0.1;
    const status = canceled ? 'CANCELED' : 'DELIVERED';
    // Pedidos cancelados ficam em dinheiro (sem cobrança); os entregues são 80% online.
    const paymentMethod = canceled || random() < 0.2 ? 'CASH' : pick(['PIX', 'PIX', 'CREDIT_CARD'] as const);
    const at = (minutes: number) => new Date(createdAt.getTime() + minutes * 60_000);
    const driver = pick(driverRows);

    const order = await prisma.order.create({
      data: {
        tenantId,
        number,
        customerId: customer.id,
        companyId: company.id,
        status,
        fulfillment: 'DELIVERY',
        deliveryAddress: { street: address.street, number: address.number, district: address.district, city: address.city, state: address.state, zipCode: address.zipCode, lat: address.lat, lng: address.lng },
        subtotalCents: subtotal,
        deliveryFeeCents: deliveryFee,
        tipCents: tip,
        totalCents: subtotal + deliveryFee + tip,
        paymentMethod,
        paymentStatus: canceled ? 'CANCELED' : paymentMethod === 'CASH' ? 'PENDING' : 'PAID',
        distanceKm,
        deliveryCode: String(between(1000, 9999)),
        createdAt,
        confirmedAt: canceled ? null : at(2),
        preparingAt: canceled ? null : at(3),
        readyAt: canceled ? null : at(3 + company.averagePrepMinutes),
        pickedUpAt: canceled ? null : at(8 + company.averagePrepMinutes),
        deliveredAt: canceled ? null : at(22 + company.averagePrepMinutes + Math.round(distanceKm * 3)),
        canceledAt: canceled ? at(4) : null,
        canceledBy: canceled ? pick(['CUSTOMER', 'COMPANY'] as const) : null,
        cancelReason: canceled ? pick(['Cliente desistiu', 'Item indisponível', 'Loja muito cheia']) : null,
        items: {
          create: lines.map((line) => ({
            productId: line.product.id,
            productName: line.product.name,
            unitPriceCents: line.product.priceCents,
            quantity: line.quantity,
            totalCents: line.product.priceCents * line.quantity,
          })),
        },
        statusHistory: {
          create: canceled
            ? [
                { toStatus: 'NEW', actorType: 'CUSTOMER', createdAt },
                { fromStatus: 'NEW', toStatus: 'CANCELED', actorType: 'COMPANY', createdAt: at(4) },
              ]
            : [
                { toStatus: 'NEW', actorType: 'CUSTOMER', createdAt },
                { fromStatus: 'NEW', toStatus: 'CONFIRMED', actorType: 'COMPANY', createdAt: at(2) },
                { fromStatus: 'CONFIRMED', toStatus: 'PREPARING', actorType: 'COMPANY', createdAt: at(3) },
                { fromStatus: 'PREPARING', toStatus: 'READY_FOR_PICKUP', actorType: 'COMPANY', createdAt: at(3 + company.averagePrepMinutes) },
                { fromStatus: 'READY_FOR_PICKUP', toStatus: 'DRIVER_ASSIGNED', actorType: 'DRIVER', createdAt: at(5 + company.averagePrepMinutes) },
                { fromStatus: 'DRIVER_ASSIGNED', toStatus: 'PICKED_UP', actorType: 'DRIVER', createdAt: at(8 + company.averagePrepMinutes) },
                { fromStatus: 'PICKED_UP', toStatus: 'DELIVERED', actorType: 'DRIVER', createdAt: at(22 + company.averagePrepMinutes + Math.round(distanceKm * 3)) },
              ],
        },
      },
    });

    if (!canceled) {
      const code = Array.from({ length: 8 }, () => CODE_ALPHABET[between(0, CODE_ALPHABET.length - 1)]).join('');
      await prisma.delivery.create({
        data: {
          tenantId,
          code,
          kind: 'ORDER',
          orderId: order.id,
          requesterUserId: customer.userId,
          companyId: company.id,
          status: 'DELIVERED',
          pickup: { name: company.tradeName, street: company.address.street, number: company.address.number, district: company.address.district, city: company.address.city, state: company.address.state, lat: company.address.lat, lng: company.address.lng },
          dropoff: { name: customer.user.name.split(' ')[0], street: address.street, number: address.number, district: address.district, city: address.city, state: address.state, lat: address.lat, lng: address.lng },
          pickupLat: company.address.lat!,
          pickupLng: company.address.lng!,
          dropoffLat: address.lat!,
          dropoffLng: address.lng!,
          city: company.address.city,
          state: company.address.state,
          itemCategory: 'FOOD',
          vehicleType: 'MOTORCYCLE',
          distanceKm,
          durationMin: Math.round(distanceKm * 3) + 5,
          feeCents: deliveryFee,
          payoutCents: 500 + Math.round(Math.max(0, distanceKm - 2) * 120),
          tipCents: tip,
          paymentMethod,
          paymentStatus: paymentMethod === 'CASH' ? 'PENDING' : 'PAID',
          dropoffCode: order.deliveryCode,
          driverId: driver.id,
          assignedAt: at(5 + company.averagePrepMinutes),
          pickedUpAt: order.pickedUpAt,
          deliveredAt: order.deliveredAt,
          createdAt: at(2),
        },
      });
      await prisma.driver.update({ where: { id: driver.id }, data: { completedDeliveries: { increment: 1 }, acceptedOffers: { increment: 1 } } });
      if (paymentMethod !== 'CASH') {
        await prisma.payment.create({
          data: {
            tenantId,
            purpose: 'ORDER',
            orderId: order.id,
            payerUserId: customer.userId,
            method: paymentMethod,
            status: 'PAID',
            amountCents: order.totalCents,
            provider: 'sandbox',
            providerPaymentId: `seed_${order.id}`,
            cardBrand: paymentMethod === 'CREDIT_CARD' ? 'visa' : null,
            cardLast4: paymentMethod === 'CREDIT_CARD' ? '4242' : null,
            paidAt: createdAt,
            createdAt,
          },
        });
      }
      if (random() < 0.6) {
        await prisma.review.createMany({
          data: [
            { tenantId, orderId: order.id, authorUserId: customer.userId, authorType: 'CUSTOMER', subjectType: 'COMPANY', subjectId: company.id, rating: pick([5, 5, 5, 4, 4, 3]), createdAt: order.deliveredAt! },
            { tenantId, orderId: order.id, authorUserId: customer.userId, authorType: 'CUSTOMER', subjectType: 'DRIVER', subjectId: driver.id, rating: pick([5, 5, 4, 4, 3]), createdAt: order.deliveredAt! },
          ],
          skipDuplicates: true,
        });
      }
    }
  }

  await prisma.counter.upsert({ where: { tenantId_key: { tenantId, key: 'order' } }, create: { tenantId, key: 'order', value: number }, update: { value: number } });

  // Médias de avaliação
  for (const subjectType of ['COMPANY', 'DRIVER'] as const) {
    const groups = await prisma.review.groupBy({ by: ['subjectId'], where: { tenantId, subjectType, isHidden: false }, _avg: { rating: true }, _count: { _all: true } });
    for (const group of groups) {
      const data = { ratingAvg: Math.round((group._avg.rating ?? 0) * 100) / 100, ratingCount: group._count._all };
      if (subjectType === 'COMPANY') await prisma.company.update({ where: { id: group.subjectId }, data });
      else await prisma.driver.update({ where: { id: group.subjectId }, data });
    }
  }
  console.log('✔ 200 pedidos históricos (entregues e cancelados), entregas e avaliações');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
