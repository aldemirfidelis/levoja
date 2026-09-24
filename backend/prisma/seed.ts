/**
 * Seed de dados ESSENCIAIS (seguro para qualquer ambiente, idempotente):
 * tenant padrão, catálogo de permissões, papéis de sistema, segmentos,
 * documentos legais e o usuário Super Admin inicial.
 *
 * Dados fictícios de desenvolvimento ficam em `seed-dev.ts`.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PERMISSIONS, resolveRolePermissions, SYSTEM_ROLES } from '@levoja/shared';
import { PrismaClient } from '../src/generated/prisma/client';
import type { CompanyDocumentType, LegalDocumentType, SegmentKind, VehicleType } from '../src/generated/prisma/enums';
import { LEGAL_TEMPLATES } from './legal-templates';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

interface SegmentSeed {
  slug: string;
  name: string;
  icon: string;
  kind: SegmentKind;
  description: string;
  isRegulated?: boolean;
  requiredDocuments?: CompanyDocumentType[];
}

export const SEGMENTS: SegmentSeed[] = [
  { slug: 'restaurantes', name: 'Restaurantes', icon: 'utensils', kind: 'MARKETPLACE', description: 'Refeições, lanches e sobremesas', requiredDocuments: ['SANITARY_LICENSE'] },
  {
    slug: 'farmacias',
    name: 'Farmácias',
    icon: 'pill',
    kind: 'MARKETPLACE',
    description: 'Medicamentos, higiene e cuidados pessoais',
    isRegulated: true,
    requiredDocuments: ['OPERATING_LICENSE', 'SANITARY_LICENSE', 'PHARMACIST_REGISTRATION'],
  },
  { slug: 'mercado', name: 'Mercado', icon: 'shopping-basket', kind: 'MARKETPLACE', description: 'Supermercados, hortifruti e açougues' },
  { slug: 'lojas', name: 'Lojas', icon: 'store', kind: 'MARKETPLACE', description: 'Roupas, eletrônicos, casa e muito mais' },
  { slug: 'conveniencia', name: 'Conveniência', icon: 'cup-soda', kind: 'MARKETPLACE', description: 'Bebidas, snacks e itens do dia a dia' },
  { slug: 'presentes', name: 'Presentes', icon: 'gift', kind: 'MARKETPLACE', description: 'Flores, cestas e presentes' },
  { slug: 'servicos', name: 'Serviços', icon: 'wrench', kind: 'MARKETPLACE', description: 'Peças, materiais e serviços locais' },
  { slug: 'documentos', name: 'Documentos', icon: 'file-text', kind: 'ON_DEMAND', description: 'Envie documentos com segurança' },
  { slug: 'encomendas', name: 'Encomendas', icon: 'package', kind: 'ON_DEMAND', description: 'Pequenos volumes entre pessoas e empresas' },
  { slug: 'entrega-expressa', name: 'Entrega expressa', icon: 'zap', kind: 'ON_DEMAND', description: 'Coleta imediata e entrega direta' },
  { slug: 'outros', name: 'Outros', icon: 'more-horizontal', kind: 'MARKETPLACE', description: 'Outros estabelecimentos' },
];

export async function seedEssentials(client: PrismaClient = prisma, options: { quiet?: boolean } = {}) {
  const log = (message: string) => !options.quiet && console.log(message);

  // 1. Tenant padrão
  const slug = process.env.DEFAULT_TENANT_SLUG ?? 'levoja';
  const tenant = await client.tenant.upsert({
    where: { slug },
    create: { slug, name: process.env.APP_NAME ?? 'LevoJá', domains: [], branding: { primaryColor: '#FF5A1F', appName: 'LevoJá' } },
    update: {},
  });
  log(`✔ Tenant "${tenant.slug}"`);

  // 2. Permissões (catálogo global)
  for (const permission of PERMISSIONS) {
    await client.permission.upsert({
      where: { key: permission.key },
      create: permission,
      update: { group: permission.group, description: permission.description, scope: permission.scope },
    });
  }
  const permissionIds = new Map((await client.permission.findMany()).map((permission) => [permission.key, permission.id]));
  log(`✔ ${permissionIds.size} permissões`);

  // 3. Papéis de sistema — sincronização ADITIVA: novas permissões do código são concedidas,
  //    mas customizações feitas pelo administrador nunca são removidas.
  for (const definition of SYSTEM_ROLES) {
    const role = await client.role.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key: definition.key } },
      create: {
        tenantId: tenant.id,
        key: definition.key,
        name: definition.name,
        description: definition.description,
        scope: definition.scope,
        isSystem: true,
        isStaff: definition.isStaff,
      },
      update: { isSystem: true, scope: definition.scope, isStaff: definition.isStaff },
    });
    await client.rolePermission.createMany({
      data: resolveRolePermissions(definition).map((key) => ({ roleId: role.id, permissionId: permissionIds.get(key)! })),
      skipDuplicates: true,
    });
  }
  log(`✔ ${SYSTEM_ROLES.length} papéis de sistema`);

  // 4. Segmentos da Home
  for (const [index, segment] of SEGMENTS.entries()) {
    await client.segment.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: segment.slug } },
      create: { tenantId: tenant.id, sortOrder: index * 10, requiredDocuments: [], ...segment },
      update: {},
    });
  }
  log(`✔ ${SEGMENTS.length} segmentos`);

  // 5. Regras de preço padrão (somente se o tenant ainda não tiver regras — nunca sobrescreve ajustes).
  if ((await client.pricingRule.count({ where: { tenantId: tenant.id } })) === 0) {
    const surcharges = { nightSurchargeBps: 1500, rainSurchargeBps: 2000, demandSurchargeMaxBps: 5000, includedKm: 2 };
    type RuleSeed = { name: string; target: string; vehicleType?: VehicleType; baseCents: number; perKmCents: number; minimumCents: number };
    const defaults: RuleSeed[] = [
        { name: 'Cliente — moto (padrão)', target: 'CUSTOMER_FEE', baseCents: 599, perKmCents: 150, minimumCents: 599 },
        { name: 'Cliente — bicicleta', target: 'CUSTOMER_FEE', vehicleType: 'BICYCLE', baseCents: 499, perKmCents: 120, minimumCents: 499 },
        { name: 'Cliente — carro', target: 'CUSTOMER_FEE', vehicleType: 'CAR', baseCents: 1299, perKmCents: 250, minimumCents: 1299 },
        { name: 'Cliente — utilitário', target: 'CUSTOMER_FEE', vehicleType: 'VAN', baseCents: 2999, perKmCents: 350, minimumCents: 2999 },
        { name: 'Entregador — moto (padrão)', target: 'DRIVER_PAYOUT', baseCents: 500, perKmCents: 120, minimumCents: 500 },
        { name: 'Entregador — bicicleta', target: 'DRIVER_PAYOUT', vehicleType: 'BICYCLE', baseCents: 450, perKmCents: 110, minimumCents: 450 },
        { name: 'Entregador — carro', target: 'DRIVER_PAYOUT', vehicleType: 'CAR', baseCents: 1000, perKmCents: 200, minimumCents: 1000 },
        { name: 'Entregador — utilitário', target: 'DRIVER_PAYOUT', vehicleType: 'VAN', baseCents: 2500, perKmCents: 300, minimumCents: 2500 },
    ];
    await client.pricingRule.createMany({
      data: defaults.map((rule) => ({
        ...rule,
        ...surcharges,
        tenantId: tenant.id,
        target: rule.target as 'CUSTOMER_FEE' | 'DRIVER_PAYOUT',
        vehicleType: rule.vehicleType ?? null,
      })),
    });
    log('✔ Regras de preço padrão');
  }

  // 6. Comissão padrão da plataforma (somente se não houver regras — ajustes do admin são preservados).
  if ((await client.commissionRule.count({ where: { tenantId: tenant.id } })) === 0) {
    await client.commissionRule.create({ data: { tenantId: tenant.id, name: 'Comissão padrão', percentBps: 1200, fixedCents: 0 } });
    log('✔ Comissão padrão (12%)');
  }

  // 7. Documentos legais (versão 1.0) — publica apenas se ainda não houver versão vigente.
  for (const [type, template] of Object.entries(LEGAL_TEMPLATES) as [LegalDocumentType, { title: string; content: string }][]) {
    const current = await client.legalDocument.findFirst({ where: { tenantId: tenant.id, type, isCurrent: true } });
    if (!current) {
      await client.legalDocument.create({ data: { tenantId: tenant.id, type, version: '1.0', isCurrent: true, ...template } });
    }
  }
  log('✔ Documentos legais');

  return tenant;
}

async function seedSuperAdmin(tenantId: string) {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@levoja.local').toLowerCase();
  const existing = await prisma.user.findUnique({ where: { tenantId_email: { tenantId, email } } });
  if (existing) {
    console.log(`✔ Super Admin já existe (${email})`);
    return;
  }
  const generated = !process.env.SEED_ADMIN_PASSWORD;
  const password = process.env.SEED_ADMIN_PASSWORD || `${randomBytes(9).toString('base64url')}9a`;
  const role = await prisma.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId, key: 'super_admin' } } });
  await prisma.user.create({
    data: {
      tenantId,
      name: 'Super Admin',
      email,
      emailVerifiedAt: new Date(),
      passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
      preferences: { theme: 'system' },
      roles: { create: { roleId: role.id } },
    },
  });
  console.log(`✔ Super Admin criado: ${email}`);
  if (generated) {
    console.log(`  Senha gerada (exibida UMA vez — anote e altere no primeiro acesso): ${password}`);
  }
}

async function main() {
  const tenant = await seedEssentials();
  await seedSuperAdmin(tenant.id);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
