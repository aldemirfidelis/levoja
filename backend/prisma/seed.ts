/**
 * Seed de dados ESSENCIAIS (seguro para qualquer ambiente, idempotente):
 * tenant padrão, catálogo de permissões, papéis de sistema, segmentos, planos SaaS,
 * documentos legais e o usuário Super Admin inicial.
 *
 * Dados fictícios de desenvolvimento ficam em `seed-dev.ts`.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { provisionTenant } from '../src/modules/tenants/provisioning';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

export async function seedEssentials(client: PrismaClient = prisma, options: { quiet?: boolean } = {}) {
  const log = (message: string) => !options.quiet && console.log(message);

  // Tenant padrão (os demais tenants white label são criados pelo painel).
  const slug = process.env.DEFAULT_TENANT_SLUG ?? 'levoja';
  const tenant = await client.tenant.upsert({
    where: { slug },
    create: { slug, name: process.env.APP_NAME ?? 'LevoJá', domains: [], branding: { primaryColor: '#FF5A1F', appName: 'LevoJá' } },
    update: {},
  });
  log(`✔ Tenant "${tenant.slug}"`);
  await provisionTenant(client, tenant.id, log);
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
