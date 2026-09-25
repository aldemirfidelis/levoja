import { DEFAULT_PLANS, PERMISSIONS, resolveRolePermissions, SYSTEM_ROLES } from '@levoja/shared';
import type { PrismaClient } from '../../generated/prisma/client';
import type { CompanyDocumentType, LegalDocumentType, SegmentKind, VehicleType } from '../../generated/prisma/enums';
import { LEGAL_TEMPLATES } from './legal-templates';

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

type RuleSeed = { name: string; target: 'CUSTOMER_FEE' | 'DRIVER_PAYOUT'; vehicleType?: VehicleType; baseCents: number; perKmCents: number; minimumCents: number };

const DEFAULT_PRICING: RuleSeed[] = [
  { name: 'Cliente — moto (padrão)', target: 'CUSTOMER_FEE', baseCents: 599, perKmCents: 150, minimumCents: 599 },
  { name: 'Cliente — bicicleta', target: 'CUSTOMER_FEE', vehicleType: 'BICYCLE', baseCents: 499, perKmCents: 120, minimumCents: 499 },
  { name: 'Cliente — carro', target: 'CUSTOMER_FEE', vehicleType: 'CAR', baseCents: 1299, perKmCents: 250, minimumCents: 1299 },
  { name: 'Cliente — utilitário', target: 'CUSTOMER_FEE', vehicleType: 'VAN', baseCents: 2999, perKmCents: 350, minimumCents: 2999 },
  { name: 'Entregador — moto (padrão)', target: 'DRIVER_PAYOUT', baseCents: 500, perKmCents: 120, minimumCents: 500 },
  { name: 'Entregador — bicicleta', target: 'DRIVER_PAYOUT', vehicleType: 'BICYCLE', baseCents: 450, perKmCents: 110, minimumCents: 450 },
  { name: 'Entregador — carro', target: 'DRIVER_PAYOUT', vehicleType: 'CAR', baseCents: 1000, perKmCents: 200, minimumCents: 1000 },
  { name: 'Entregador — utilitário', target: 'DRIVER_PAYOUT', vehicleType: 'VAN', baseCents: 2500, perKmCents: 300, minimumCents: 2500 },
];

/**
 * Dados essenciais de um tenant (idempotente e aditivo — nunca sobrescreve ajustes feitos no
 * painel): catálogo de permissões, papéis de sistema, segmentos, regras de preço e comissão
 * padrão, planos SaaS e documentos legais 1.0. Usado pelo seed e pela criação de tenants
 * (white label) no painel.
 */
export async function provisionTenant(client: PrismaClient, tenantId: string, log: (message: string) => void = () => undefined) {
  // 1. Permissões (catálogo global)
  for (const permission of PERMISSIONS) {
    await client.permission.upsert({
      where: { key: permission.key },
      create: permission,
      update: { group: permission.group, description: permission.description, scope: permission.scope },
    });
  }
  const permissionIds = new Map((await client.permission.findMany()).map((permission) => [permission.key, permission.id]));
  log(`✔ ${permissionIds.size} permissões`);

  // 2. Papéis de sistema — sincronização ADITIVA: novas permissões do código são concedidas,
  //    mas customizações feitas pelo administrador nunca são removidas.
  for (const definition of SYSTEM_ROLES) {
    const role = await client.role.upsert({
      where: { tenantId_key: { tenantId, key: definition.key } },
      create: {
        tenantId,
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

  // 3. Segmentos da Home
  for (const [index, segment] of SEGMENTS.entries()) {
    await client.segment.upsert({
      where: { tenantId_slug: { tenantId, slug: segment.slug } },
      create: { tenantId, sortOrder: index * 10, requiredDocuments: [], ...segment },
      update: {},
    });
  }
  log(`✔ ${SEGMENTS.length} segmentos`);

  // 4. Regras de preço padrão (somente se o tenant ainda não tiver regras).
  if ((await client.pricingRule.count({ where: { tenantId } })) === 0) {
    const surcharges = { nightSurchargeBps: 1500, rainSurchargeBps: 2000, demandSurchargeMaxBps: 5000, includedKm: 2 };
    await client.pricingRule.createMany({
      data: DEFAULT_PRICING.map((rule) => ({ ...rule, ...surcharges, tenantId, vehicleType: rule.vehicleType ?? null })),
    });
    log('✔ Regras de preço padrão');
  }

  // 5. Comissão padrão da plataforma (somente se não houver regras).
  if ((await client.commissionRule.count({ where: { tenantId } })) === 0) {
    await client.commissionRule.create({ data: { tenantId, name: 'Comissão padrão', percentBps: 1200, fixedCents: 0 } });
    log('✔ Comissão padrão (12%)');
  }

  // 6. Planos SaaS (somente se o tenant ainda não tiver planos).
  if ((await client.plan.count({ where: { tenantId } })) === 0) {
    await client.plan.createMany({ data: DEFAULT_PLANS.map((plan) => ({ ...plan, tenantId, features: plan.features, limits: plan.limits })) });
    log(`✔ ${DEFAULT_PLANS.length} planos SaaS`);
  }

  // 7. Documentos legais (versão 1.0) — publica apenas se ainda não houver versão vigente.
  for (const [type, template] of Object.entries(LEGAL_TEMPLATES) as [LegalDocumentType, { title: string; content: string }][]) {
    const current = await client.legalDocument.findFirst({ where: { tenantId, type, isCurrent: true } });
    if (!current) await client.legalDocument.create({ data: { tenantId, type, version: '1.0', isCurrent: true, ...template } });
  }
  log('✔ Documentos legais');
}
