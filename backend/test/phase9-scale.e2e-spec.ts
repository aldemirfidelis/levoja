import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { cityKey } from '@levoja/shared';
import { SettingsService } from '../src/modules/settings/settings.service';
import { LedgerService } from '../src/modules/finance/ledger.service';
import { SubscriptionsService } from '../src/modules/saas/subscriptions.service';
import { verifySignature } from '../src/modules/public-api/webhook-security';
import { ADMIN, createTestApp, login, TestContext, uniqueIdentity } from './utils';

/**
 * Fase 9 — Escala: tenants white label (provisionamento, marca, domínios, isolamento),
 * multi-cidade (status, lista de espera, bloqueio), planos SaaS (recursos, limites, teste
 * grátis, upgrade/downgrade, cobrança na carteira, atraso), API pública (escopos, limites por
 * minuto, registro de uso, documentação) com webhooks assinados e marca própria das empresas.
 */
describe('Fase 9 — Escala (E2E)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let admin: { id: string; tenantId: string };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const RUN = Date.now().toString().slice(-7);
  const CITY = `Cidade Escala ${RUN}`;
  const BASE = { lat: -10 - Math.random() * 15, lng: -40 - Math.random() * 15 };
  const at = (dLatKm: number, dLngKm = 0) => ({ lat: BASE.lat + dLatKm / 111, lng: BASE.lng + dLngKm / 111 });

  let company: { token: string; companyId: string; userId: string; email: string };
  let productId: string;
  let settings: SettingsService;
  let originalSaas: Awaited<ReturnType<SettingsService['get']>>;
  let originalCities: Awaited<ReturnType<SettingsService['get']>>;

  // Servidor que recebe os webhooks.
  let hookServer: Server;
  let hookUrl: string;
  const received: { headers: IncomingMessage['headers']; body: string }[] = [];
  let hookStatus = 200;

  async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 15_000): Promise<T> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = await check();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('Tempo esgotado aguardando condição');
  }

  async function newCompany(name: string, city = CITY) {
    const segments = await ctx.http().get('/v1/segments').expect(200);
    const owner = uniqueIdentity();
    const identity = uniqueIdentity();
    const registered = await ctx.http()
      .post('/v1/auth/register/company')
      .send({
        name: `Dono ${name}`,
        email: owner.email,
        phone: owner.phone,
        password: 'SenhaForte123',
        cpf: owner.cpf,
        acceptTerms: true,
        acceptPrivacy: true,
        acceptCompanyTerms: true,
        company: {
          legalName: `${name} LTDA`,
          tradeName: `${name} ${RUN}`,
          cnpj: identity.cnpj,
          segmentId: segments.body.find((segment: { slug: string }) => segment.slug === 'restaurantes').id,
          email: identity.email,
          phone: '(11) 3000-9000',
          responsibleName: `Dono ${name}`,
          responsibleCpf: owner.cpf,
        },
      })
      .expect(201);
    const result = { token: registered.body.accessToken as string, companyId: registered.body.companyId as string, userId: registered.body.user.id as string, email: owner.email };
    await ctx.http()
      .put(`/v1/companies/${result.companyId}/address`)
      .set(auth(result.token))
      .send({ zipCode: '01310100', street: 'Rua da Escala', number: '9', district: 'Centro', city, state: 'SP', ...at(0) })
      .expect(200);
    await ctx.http()
      .put(`/v1/companies/${result.companyId}/opening-hours`)
      .set(auth(result.token))
      .send({ hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: '00:00', closesAt: '23:59' })) })
      .expect(200);
    await ctx.prisma.company.update({ where: { id: result.companyId }, data: { status: 'APPROVED', isOpen: true } });
    return result;
  }

  async function newCustomer(city = CITY) {
    const id = uniqueIdentity();
    const response = await ctx.http()
      .post('/v1/auth/register/customer')
      .send({ name: 'Cliente Escala', email: id.email, phone: id.phone, password: 'SenhaForte123', acceptTerms: true, acceptPrivacy: true })
      .expect(201);
    const address = await ctx.http()
      .post('/v1/me/addresses')
      .set(auth(response.body.accessToken))
      .send({ zipCode: '01310200', street: 'Rua do Cliente Escala', number: '5', district: 'Centro', city, state: 'SP', ...at(1, 0.5) })
      .expect(201);
    return { token: response.body.accessToken as string, userId: response.body.user.id as string, addressId: address.body.id as string };
  }

  const enableSaas = (value: boolean) => settings.set(admin.tenantId, 'saas', { ...(originalSaas as object), enabled: value }, admin.id);

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await login(ctx, ADMIN, 'ADMIN');
    admin = await ctx.prisma.user.findFirstOrThrow({ where: { email: ADMIN.login }, select: { id: true, tenantId: true } });
    settings = ctx.app.get(SettingsService);
    originalSaas = await settings.get(admin.tenantId, 'saas');
    originalCities = await settings.get(admin.tenantId, 'cities');
    company = await newCompany('Loja Escala');
    productId = (await ctx.http().post(`/v1/companies/${company.companyId}/products`).set(auth(company.token)).send({ name: 'Sanduíche', priceCents: 2500, weightGrams: 300 }).expect(201)).body.id;

    hookServer = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        received.push({ headers: request.headers, body });
        response.statusCode = hookStatus;
        response.end(hookStatus === 200 ? 'ok' : 'erro');
      });
    });
    await new Promise<void>((resolve) => hookServer.listen(0, '127.0.0.1', resolve));
    hookUrl = `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}/hook`;
  });

  afterAll(async () => {
    await settings.set(admin.tenantId, 'saas', originalSaas, admin.id);
    await settings.set(admin.tenantId, 'cities', originalCities, admin.id);
    await new Promise((resolve) => hookServer.close(resolve));
    await ctx.app.close();
  });

  // ---------------------------------------------------------------------------
  // Tenants (white label)
  // ---------------------------------------------------------------------------

  it('cria tenant white label com dados essenciais, marca, domínio e isolamento de dados', async () => {
    const slug = `marca-${RUN}`;
    const domain = `entregas${RUN}.exemplo.com.br`;
    const adminEmail = `admin.${RUN}@marca.test`;
    await ctx.http().post('/v1/admin/tenants').set(auth(company.token)).send({}).expect(403);
    await ctx.http().post('/v1/admin/tenants').set(auth(adminToken)).send({ slug, name: 'Marca Teste', domains: ['https://errado.com'], admin: { name: 'Admin Marca', email: adminEmail } }).expect(400);
    const created = await ctx.http()
      .post('/v1/admin/tenants')
      .set(auth(adminToken))
      .send({ slug, name: 'Marca Teste', domains: [domain], branding: { appName: 'Marca Express', primaryColor: '#1F7A4D', webUrl: `https://${domain}` }, admin: { name: 'Admin Marca', email: adminEmail } })
      .expect(201);
    const tenantId = created.body.id as string;
    await ctx.http().post('/v1/admin/tenants').set(auth(adminToken)).send({ slug: `outra-${RUN}`, name: 'Outra', domains: [domain], admin: { name: 'Xavier Outro', email: `x.${RUN}@x.test` } }).expect(409);

    // Provisionamento: papéis, segmentos, preços, planos e documentos legais próprios.
    expect(await ctx.prisma.role.count({ where: { tenantId } })).toBeGreaterThanOrEqual(10);
    expect(await ctx.prisma.segment.count({ where: { tenantId } })).toBeGreaterThanOrEqual(10);
    expect(await ctx.prisma.pricingRule.count({ where: { tenantId } })).toBeGreaterThan(0);
    expect((await ctx.prisma.plan.findMany({ where: { tenantId } })).map((plan) => plan.key).sort()).toEqual(['basico', 'enterprise', 'profissional']);
    const tenantAdmin = await ctx.prisma.user.findFirstOrThrow({ where: { tenantId, email: adminEmail }, include: { roles: { include: { role: true } } } });
    expect(tenantAdmin.roles.map((role) => role.role.key)).toEqual(['admin']);
    const invite = ctx.mail.outbox.find((message) => message.to === adminEmail);
    expect(invite?.brand).toBe('Marca Express');

    // Marca pública por cabeçalho e por domínio.
    const bySlug = await ctx.http().get('/v1/tenant').set('X-Tenant', slug).expect(200);
    expect(bySlug.body).toMatchObject({ slug, appName: 'Marca Express', primaryColor: '#1F7A4D', webUrl: `https://${domain}` });
    const byHost = await ctx.http().get('/v1/tenant').set('Host', domain).expect(200);
    expect(byHost.body.slug).toBe(slug);

    // Isolamento: o mesmo e-mail pode existir nos dois tenants, com contas separadas.
    const id = uniqueIdentity();
    const customer = { name: 'Cliente Isolado', email: id.email, phone: id.phone, password: 'SenhaForte123', acceptTerms: true, acceptPrivacy: true };
    await ctx.http().post('/v1/auth/register/customer').set('X-Tenant', slug).send(customer).expect(201);
    await ctx.http().post('/v1/auth/login').send({ login: id.email, password: 'SenhaForte123' }).expect(401);
    const inTenant = await ctx.http().post('/v1/auth/login').set('X-Tenant', slug).send({ login: id.email, password: 'SenhaForte123' }).expect(200);
    const stores = await ctx.http().get('/v1/stores').set(auth(inTenant.body.accessToken)).query({ lat: at(0).lat, lng: at(0).lng }).expect(200);
    expect(JSON.stringify(stores.body)).not.toContain(company.companyId);

    // Suspensão bloqueia o tenant inteiro; não é possível suspender o próprio tenant.
    await ctx.http().patch(`/v1/admin/tenants/${admin.tenantId}`).set(auth(adminToken)).send({ status: 'SUSPENDED' }).expect(409);
    await ctx.http().patch(`/v1/admin/tenants/${tenantId}`).set(auth(adminToken)).send({ status: 'SUSPENDED' }).expect(200);
    await ctx.http().get('/v1/tenant').set('X-Tenant', slug).expect(403);
    await ctx.http().patch(`/v1/admin/tenants/${tenantId}`).set(auth(adminToken)).send({ status: 'ACTIVE' }).expect(200);
    const list = await ctx.http().get('/v1/admin/tenants').set(auth(adminToken)).expect(200);
    expect(list.body.find((tenant: { id: string }) => tenant.id === tenantId)).toMatchObject({ users: 2, status: 'ACTIVE' });
  });

  it('administrador ajusta a marca da própria plataforma', async () => {
    const before = await ctx.http().get('/v1/admin/branding').set(auth(adminToken)).expect(200);
    await ctx.http().patch('/v1/admin/branding').set(auth(adminToken)).send({ primaryColor: 'azul' }).expect(400);
    const updated = await ctx.http().patch('/v1/admin/branding').set(auth(adminToken)).send({ supportEmail: 'ajuda@levoja.test', supportPhone: '(11) 4000-0000' }).expect(200);
    expect(updated.body.branding).toMatchObject({ supportEmail: 'ajuda@levoja.test' });
    const branding = await ctx.http().get('/v1/tenant').expect(200);
    expect(branding.body).toMatchObject({ supportEmail: 'ajuda@levoja.test', supportPhone: '(11) 4000-0000' });
    await ctx.http().patch('/v1/admin/branding').set(auth(adminToken)).send({ supportEmail: before.body.supportEmail ?? '', supportPhone: before.body.supportPhone ?? '' }).expect(200);
  });

  // ---------------------------------------------------------------------------
  // Multi-cidade
  // ---------------------------------------------------------------------------

  it('cidades: pausa bloqueia pedidos e entregas; lista de espera recebe aviso no lançamento', async () => {
    const created = await ctx.http().post('/v1/admin/cities').set(auth(adminToken)).send({ name: CITY, state: 'SP', status: 'ACTIVE' }).expect(201);
    await ctx.http().post('/v1/admin/cities').set(auth(adminToken)).send({ name: CITY, state: 'sp' }).expect(409);
    const customer = await newCustomer();
    await ctx.http().post('/v1/cart/items').set(auth(customer.token)).send({ productId, quantity: 1 }).expect(201);
    const okQuote = await ctx.http().post('/v1/orders/quote').set(auth(customer.token)).send({ companyId: company.companyId, addressId: customer.addressId }).expect(201);
    expect(okQuote.body.issues).toEqual([]);

    await ctx.http().patch(`/v1/admin/cities/${created.body.id}`).set(auth(adminToken)).send({ status: 'PAUSED', message: 'Operação pausada por causa da enchente.' }).expect(200);
    const paused = await ctx.http().post('/v1/orders/quote').set(auth(customer.token)).send({ companyId: company.companyId, addressId: customer.addressId }).expect(201);
    expect(paused.body.issues).toContain('Operação pausada por causa da enchente.');
    const delivery = await ctx.http()
      .post('/v1/deliveries/quote')
      .set(auth(customer.token))
      .send({ pickup: { addressId: customer.addressId }, dropoff: { street: 'Rua Destino', number: '1', city: CITY, state: 'SP', ...at(2) }, itemCategory: 'DOCUMENT', weightKg: 0.2 })
      .expect(422);
    expect(delivery.body.message).toBe('Operação pausada por causa da enchente.');
    expect((await ctx.http().get('/v1/cities/check').query({ city: CITY, state: 'SP' }).expect(200)).body).toEqual({ operating: false, message: 'Operação pausada por causa da enchente.' });
    await ctx.http().patch(`/v1/admin/cities/${created.body.id}`).set(auth(adminToken)).send({ status: 'ACTIVE' }).expect(200);
    await ctx.prisma.cart.deleteMany({ where: { customer: { userId: customer.userId } } });

    // Lista de espera de uma cidade nova (cadastrada automaticamente "em preparação").
    const futureCity = `Futura ${RUN}`;
    const joined = await ctx.http().post('/v1/cities/waitlist').send({ city: futureCity, state: 'MG', email: `espera.${RUN}@teste.test`, name: 'Maria Espera', profile: 'COMPANY' }).expect(201);
    expect(joined.body).toMatchObject({ joined: true, operating: false, city: { status: 'PREPARING' } });
    await ctx.http().post('/v1/cities/waitlist').send({ city: futureCity, state: 'MG', email: `espera.${RUN}@teste.test`, profile: 'COMPANY' }).expect(201);
    const cities = await ctx.http().get('/v1/admin/cities').set(auth(adminToken)).expect(200);
    const future = cities.body.cities.find((city: { key: string }) => city.key === cityKey(futureCity, 'MG'));
    expect(future).toMatchObject({ status: 'PREPARING', waitlist: 1 });
    expect(cities.body.cities.find((city: { id: string }) => city.id === created.body.id)).toMatchObject({ companies: 1 });

    // Cidades sem cadastro são recusadas quando a operação exige cadastro.
    await settings.set(admin.tenantId, 'cities', { restrictToRegistered: true }, admin.id);
    const unknown = await ctx.http().get('/v1/cities/check').query({ city: `Sem Cadastro ${RUN}`, state: 'RJ' }).expect(200);
    expect(unknown.body.operating).toBe(false);
    await settings.set(admin.tenantId, 'cities', originalCities, admin.id);

    await ctx.http().patch(`/v1/admin/cities/${future.id}`).set(auth(adminToken)).send({ status: 'ACTIVE' }).expect(200);
    const mail = await waitFor(async () => ctx.mail.outbox.find((message) => message.to === `espera.${RUN}@teste.test`));
    expect(mail.subject).toContain(futureCity);
    const waitlist = await ctx.http().get(`/v1/admin/cities/${future.id}/waitlist`).set(auth(adminToken)).expect(200);
    expect(waitlist.body.entries[0].notifiedAt).not.toBeNull();
    const publicList = await ctx.http().get('/v1/cities').expect(200);
    expect(publicList.body.some((city: { name: string; status: string }) => city.name === futureCity && city.status === 'ACTIVE')).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Planos SaaS
  // ---------------------------------------------------------------------------

  it('planos: recursos e limites por plano, teste grátis, upgrade na hora e downgrade no fim do período', async () => {
    const plans = await ctx.http().get('/v1/plans').expect(200);
    expect(plans.body.map((plan: { key: string }) => plan.key)).toEqual(expect.arrayContaining(['basico', 'profissional', 'enterprise']));

    // Desligado: tudo liberado.
    await ctx.http().get(`/v1/companies/${company.companyId}/b2b`).set(auth(company.token)).expect(200);
    await enableSaas(true);
    const blocked = await ctx.http().get(`/v1/companies/${company.companyId}/b2b`).set(auth(company.token)).expect(403);
    expect(blocked.body.message).toContain('Enterprise');
    await ctx.http().post(`/v1/companies/${company.companyId}/b2b/api-keys`).set(auth(company.token)).send({ name: 'ERP', scopes: ['catalog:read'] }).expect(403);
    // A equipe da plataforma não é bloqueada.
    await ctx.http().get(`/v1/companies/${company.companyId}/b2b`).set(auth(adminToken)).expect(200);

    // Limite de produtos do plano (plano personalizado com 1 produto).
    await ctx.http().post('/v1/admin/saas/plans').set(auth(adminToken)).send({ key: `mini-${RUN}`, name: 'Mini', priceCents: 0, features: ['catalog', 'orders', 'voar'], limits: {} }).expect(400);
    const mini = await ctx.http()
      .post('/v1/admin/saas/plans')
      .set(auth(adminToken))
      .send({ key: `mini-${RUN}`, name: 'Mini', priceCents: 0, features: ['catalog', 'orders'], limits: { maxProducts: 1, maxUsers: 2, maxApiKeys: 0, maxLocations: 0, apiRequestsPerMinute: 0 }, isPublic: false })
      .expect(201);
    await ctx.http().post(`/v1/companies/${company.companyId}/subscription`).set(auth(company.token)).send({ planKey: mini.body.key }).expect(404);
    await ctx.http().post(`/v1/admin/saas/companies/${company.companyId}/plan`).set(auth(adminToken)).send({ planKey: mini.body.key }).expect(201);
    const limited = await ctx.http().post(`/v1/companies/${company.companyId}/products`).set(auth(company.token)).send({ name: 'Segundo', priceCents: 100 }).expect(403);
    expect(limited.body.message).toContain('máximo de 1');
    await ctx.http().patch(`/v1/admin/saas/plans/${(await ctx.prisma.plan.findFirstOrThrow({ where: { tenantId: admin.tenantId, isDefault: true } })).id}`).set(auth(adminToken)).send({ isActive: false }).expect(400);

    // Profissional com 14 dias grátis: libera entregas e integrações, mas não o corporativo.
    const trial = await ctx.http().post(`/v1/companies/${company.companyId}/subscription`).set(auth(company.token)).send({ planKey: 'profissional' }).expect(200);
    expect(trial.body.subscription).toMatchObject({ status: 'TRIALING', plan: { key: 'profissional' } });
    expect(trial.body.effective.features).toEqual(expect.arrayContaining(['deliveries', 'integrations']));
    expect(await ctx.prisma.subscriptionInvoice.count({ where: { companyId: company.companyId } })).toBe(0);
    await ctx.http().get(`/v1/companies/${company.companyId}/b2b/locations`).set(auth(company.token)).expect(200);
    await ctx.http().get(`/v1/companies/${company.companyId}/b2b`).set(auth(company.token)).expect(403);

    // Upgrade durante o teste: na hora, sem cobrança.
    const enterprise = await ctx.http().post(`/v1/companies/${company.companyId}/subscription`).set(auth(company.token)).send({ planKey: 'enterprise' }).expect(200);
    expect(enterprise.body.subscription).toMatchObject({ status: 'TRIALING', plan: { key: 'enterprise' } });
    await ctx.http().get(`/v1/companies/${company.companyId}/b2b`).set(auth(company.token)).expect(200);

    // Fim do teste: vira assinatura paga e a mensalidade é lançada na carteira.
    const subscriptions = ctx.app.get(SubscriptionsService);
    await ctx.prisma.companySubscription.update({ where: { companyId: company.companyId }, data: { currentPeriodEnd: new Date(Date.now() - 60_000) } });
    await ctx.http().post('/v1/admin/saas/billing/run').set(auth(adminToken)).expect(201);
    const active = await ctx.prisma.companySubscription.findUniqueOrThrow({ where: { companyId: company.companyId } });
    expect(active).toMatchObject({ status: 'ACTIVE', priceCents: 49_900 });
    const invoice = await ctx.prisma.subscriptionInvoice.findFirstOrThrow({ where: { companyId: company.companyId } });
    expect(invoice).toMatchObject({ amountCents: 49_900, status: 'OPEN' });
    const entries = await ctx.prisma.walletTransaction.findMany({ where: { type: 'SUBSCRIPTION', description: { contains: `#${invoice.number}` } }, include: { wallet: { select: { ownerType: true } } } });
    expect(entries.map((entry) => [entry.wallet.ownerType, entry.amountCents]).sort()).toEqual([
      ['COMPANY', -49_900],
      ['PLATFORM', 49_900],
    ]);

    // Crédito na carteira cobre a cobrança.
    const ledger = ctx.app.get(LedgerService);
    await ctx.prisma.$transaction((tx) =>
      ledger.post(tx, admin.tenantId, [{ owner: { type: 'COMPANY', companyId: company.companyId }, type: 'CREDIT', amountCents: 60_000, description: 'Crédito de teste', referenceKey: `teste:${RUN}:credito` }]),
    );
    await subscriptions.reconcile();
    expect((await ctx.prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('PAID');

    // Downgrade: agendado para o fim do período; na renovação vale o plano menor.
    const scheduled = await ctx.http().post(`/v1/companies/${company.companyId}/subscription`).set(auth(company.token)).send({ planKey: 'profissional' }).expect(200);
    expect(scheduled.body.subscription).toMatchObject({ plan: { key: 'enterprise' }, scheduledPlan: { key: 'profissional' } });
    await ctx.prisma.companySubscription.update({ where: { companyId: company.companyId }, data: { currentPeriodEnd: new Date(Date.now() - 60_000) } });
    await subscriptions.billingCycle();
    const renewed = await ctx.http().get(`/v1/companies/${company.companyId}/subscription`).set(auth(company.token)).expect(200);
    expect(renewed.body.subscription).toMatchObject({ status: 'ACTIVE', plan: { key: 'profissional' }, priceCents: 14_900, scheduledPlan: null });
    expect(renewed.body.invoices[0]).toMatchObject({ amountCents: 14_900 });

    // Upgrade no meio do período: diferença proporcional.
    const period = await ctx.prisma.companySubscription.findUniqueOrThrow({ where: { companyId: company.companyId } });
    const upgraded = await ctx.http().post(`/v1/companies/${company.companyId}/subscription`).set(auth(company.token)).send({ planKey: 'enterprise' }).expect(200);
    const proration = upgraded.body.invoices.find((row: { description: string }) => row.description.includes('Diferença proporcional'));
    const fraction = (period.currentPeriodEnd.getTime() - Date.now()) / (period.currentPeriodEnd.getTime() - period.currentPeriodStart.getTime());
    expect(Math.abs(proration.amountCents - Math.round((49_900 - 14_900) * fraction))).toBeLessThanOrEqual(50);
    const member = await ctx.prisma.companyUser.findFirstOrThrow({ where: { companyId: company.companyId, userId: company.userId }, include: { role: true } });
    expect(member.role.key).toBe('company_owner');

    // Anular a cobrança devolve o valor à carteira.
    const walletBefore = (await ctx.prisma.wallet.findUniqueOrThrow({ where: { companyId: company.companyId } })).availableCents;
    await ctx.http().post(`/v1/admin/saas/invoices/${proration.id}/void`).set(auth(adminToken)).send({ reason: 'Cortesia comercial' }).expect(204);
    expect((await ctx.prisma.wallet.findUniqueOrThrow({ where: { companyId: company.companyId } })).availableCents).toBe(walletBefore + proration.amountCents);
    const listed = await ctx.http().get('/v1/admin/saas/subscriptions').set(auth(adminToken)).query({ search: `Loja Escala ${RUN}` }).expect(200);
    expect(listed.body.data[0]).toMatchObject({ plan: { key: 'enterprise' }, status: 'ACTIVE' });
    expect(listed.body.mrrCents).toBeGreaterThanOrEqual(49_900);
  });

  it('assinatura em atraso: após a carência vira "em atraso" e, depois, volta aos recursos do plano padrão', async () => {
    const late = await newCompany('Loja Atrasada');
    await ctx.http().post(`/v1/admin/saas/companies/${late.companyId}/plan`).set(auth(adminToken)).send({ planKey: 'enterprise' }).expect(201);
    const subscription = await ctx.prisma.companySubscription.findUniqueOrThrow({ where: { companyId: late.companyId } });
    // A equipe contratou direto (sem teste grátis se já passou por teste) — força cobrança aberta antiga.
    await ctx.prisma.companySubscription.update({ where: { id: subscription.id }, data: { status: 'ACTIVE', trialEndsAt: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() - 60_000) } });
    await ctx.app.get(SubscriptionsService).billingCycle();
    const invoice = await ctx.prisma.subscriptionInvoice.findFirstOrThrow({ where: { companyId: late.companyId }, orderBy: { createdAt: 'desc' } });
    expect(invoice.status).toBe('OPEN');
    await ctx.prisma.subscriptionInvoice.update({ where: { id: invoice.id }, data: { createdAt: new Date(Date.now() - 10 * 86_400_000) } });
    await ctx.app.get(SubscriptionsService).reconcile();
    expect((await ctx.prisma.companySubscription.findUniqueOrThrow({ where: { id: subscription.id } })).status).toBe('PAST_DUE');
    await ctx.http().get(`/v1/companies/${late.companyId}/b2b`).set(auth(late.token)).expect(200);
    await ctx.prisma.companySubscription.update({ where: { id: subscription.id }, data: { pastDueSince: new Date(Date.now() - 10 * 86_400_000) } });
    await ctx.app.get(SubscriptionsService).invalidate(late.companyId);
    const restricted = await ctx.http().get(`/v1/companies/${late.companyId}/b2b`).set(auth(late.token)).expect(403);
    expect(restricted.body.message).toContain('em atraso');
  });

  // ---------------------------------------------------------------------------
  // API pública e webhooks
  // ---------------------------------------------------------------------------

  it('API pública: escopos por rota, limite por minuto do plano, registro de uso e documentação', async () => {
    const key = await ctx.http().post(`/v1/companies/${company.companyId}/b2b/api-keys`).set(auth(company.token)).send({ name: 'ERP', scopes: ['catalog:read', 'orders:read'] }).expect(201);
    const apiKey = key.body.key as string;
    const products = await ctx.http().get(`/v1/companies/${company.companyId}/products`).set('X-Api-Key', apiKey).expect(200);
    expect(products.headers['x-ratelimit-limit']).toBe('600');
    expect(JSON.stringify(products.body)).toContain('Sanduíche');
    await ctx.http().get(`/v1/companies/${company.companyId}/orders`).set('X-Api-Key', apiKey).expect(200);
    const noScope = await ctx.http().post(`/v1/companies/${company.companyId}/products`).set('X-Api-Key', apiKey).send({ name: 'Via API', priceCents: 100 }).expect(403);
    expect(noScope.body.message).toContain('catalog:write');
    await ctx.http().get(`/v1/companies/${company.companyId}`).set('X-Api-Key', apiKey).expect(403);

    // Limite por minuto do plano.
    const enterprise = await ctx.prisma.plan.findUniqueOrThrow({ where: { tenantId_key: { tenantId: admin.tenantId, key: 'enterprise' } } });
    await ctx.http().patch(`/v1/admin/saas/plans/${enterprise.id}`).set(auth(adminToken)).send({ limits: { apiRequestsPerMinute: 2 } }).expect(200);
    const window = Math.floor(Date.now() / 60_000);
    let limited = false;
    for (let index = 0; index < 5 && !limited; index++) {
      const response = await ctx.http().get(`/v1/companies/${company.companyId}/products`).set('X-Api-Key', apiKey);
      if (response.status === 429) limited = true;
    }
    if (!limited && Math.floor(Date.now() / 60_000) === window) throw new Error('limite por minuto não aplicado');
    await ctx.http().patch(`/v1/admin/saas/plans/${enterprise.id}`).set(auth(adminToken)).send({ limits: { apiRequestsPerMinute: 600 } }).expect(200);

    const usage = await waitFor(async () => {
      const response = await ctx.http().get(`/v1/companies/${company.companyId}/api-usage`).set(auth(company.token)).expect(200);
      return response.body.recent.length >= 4 ? response.body : null;
    });
    expect(usage.recent.some((row: { status: number; path: string }) => row.status === 403 && row.path.includes('products'))).toBe(true);
    expect(usage.byKey[0]).toMatchObject({ apiKeyId: key.body.id });

    const docs = await ctx.http().get('/docs/public.json').expect(200);
    expect(Object.keys(docs.body.paths)).toEqual(expect.arrayContaining(['/v1/companies/{companyId}/products', '/v1/companies/{companyId}/orders']));
    expect(Object.keys(docs.body.paths).some((path) => path.startsWith('/v1/admin'))).toBe(false);
    expect(docs.body.components.securitySchemes['api-key']).toMatchObject({ type: 'apiKey', name: 'X-Api-Key' });
  });

  it('webhooks assinados: eventos do pedido, teste, falha com nova tentativa agendada', async () => {
    await ctx.http().post(`/v1/companies/${company.companyId}/webhooks`).set(auth(company.token)).send({ url: 'ftp://x.test/hook', events: ['order.created'] }).expect(400);
    const endpoint = await ctx.http()
      .post(`/v1/companies/${company.companyId}/webhooks`)
      .set(auth(company.token))
      .send({ url: hookUrl, events: ['order.created', 'order.status_changed'], description: 'ERP' })
      .expect(201);
    const secret = endpoint.body.secret as string;
    expect(secret).toMatch(/^whsec_/);
    const listed = await ctx.http().get(`/v1/companies/${company.companyId}/webhooks`).set(auth(company.token)).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(secret);

    const customer = await newCustomer();
    await ctx.http().post('/v1/cart/items').set(auth(customer.token)).send({ productId, quantity: 2 }).expect(201);
    const order = await ctx.http().post('/v1/orders').set(auth(customer.token)).send({ companyId: company.companyId, addressId: customer.addressId, paymentMethod: 'CASH' }).expect(201);
    const created = await waitFor(async () => received.find((hook) => JSON.parse(hook.body).type === 'order.created' && JSON.parse(hook.body).data.order.id === order.body.id));
    expect(verifySignature(secret, created.body, String(created.headers['x-levoja-signature']))).toBe(true);
    expect(created.headers['x-levoja-event']).toBe('order.created');
    expect(JSON.parse(created.body).data.order.items[0]).toMatchObject({ productName: 'Sanduíche', quantity: 2 });

    await ctx.http().post(`/v1/companies/${company.companyId}/orders/${order.body.id}/confirm`).set(auth(company.token)).expect(201);
    const changed = await waitFor(async () => received.find((hook) => JSON.parse(hook.body).type === 'order.status_changed' && JSON.parse(hook.body).data.orderId === order.body.id));
    expect(JSON.parse(changed.body).data).toMatchObject({ from: 'NEW', to: 'CONFIRMED' });

    const ping = await ctx.http().post(`/v1/companies/${company.companyId}/webhooks/${endpoint.body.id}/test`).set(auth(company.token)).expect(200);
    expect(ping.body).toMatchObject({ status: 'SUCCEEDED', responseStatus: 200, event: 'ping' });

    // Falha do destino: nova tentativa agendada e contador de falhas.
    hookStatus = 500;
    await ctx.http().post(`/v1/companies/${company.companyId}/orders/${order.body.id}/prepare`).set(auth(company.token)).expect(201);
    const failed = await waitFor(async () =>
      ctx.prisma.webhookDelivery.findFirst({ where: { endpointId: endpoint.body.id, event: 'order.status_changed', responseStatus: 500 } }),
    );
    expect(failed).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(failed.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 30_000);
    expect((await ctx.prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.body.id } })).consecutiveFailures).toBeGreaterThanOrEqual(1);
    hookStatus = 200;
    const retried = await ctx.http().post(`/v1/companies/${company.companyId}/webhook-deliveries/${failed.id}/retry`).set(auth(company.token)).expect(200);
    expect(retried.body).toMatchObject({ status: 'SUCCEEDED', attempts: 2 });

    const rotated = await ctx.http().post(`/v1/companies/${company.companyId}/webhooks/${endpoint.body.id}/rotate-secret`).set(auth(company.token)).expect(201);
    expect(rotated.body.secret).not.toBe(secret);
  });

  it('marca própria da empresa (Enterprise): cor e domínio resolvidos para a página da loja; SLA prioriza chamados', async () => {
    const domain = `pedidos${RUN}.minhaloja.com.br`;
    await ctx.http().put(`/v1/companies/${company.companyId}/brand`).set(auth(company.token)).send({ customDomain: 'https://x.com' }).expect(400);
    const brand = await ctx.http().put(`/v1/companies/${company.companyId}/brand`).set(auth(company.token)).send({ brandColor: '#1F7A4D', customDomain: domain }).expect(200);
    expect(brand.body).toMatchObject({ available: true, brandColor: '#1F7A4D', customDomain: domain, pageUrl: `https://${domain}` });
    const resolved = await ctx.http().get('/v1/brands/resolve').query({ host: domain }).expect(200);
    expect(resolved.body).toMatchObject({ tenant: { slug: 'levoja' }, store: { brandColor: '#1F7A4D', tradeName: `Loja Escala ${RUN}` } });
    const store = await ctx.http().get(`/v1/stores/${resolved.body.store.slug}`).expect(200);
    expect(store.body.brandColor).toBe('#1F7A4D');

    const other = await newCompany('Loja Básica');
    await ctx.http().put(`/v1/companies/${other.companyId}/brand`).set(auth(other.token)).send({ brandColor: '#000000' }).expect(403);
    await ctx.http().get('/v1/brands/resolve').query({ host: `nada${RUN}.exemplo.com.br` }).expect(404);

    const ticket = await ctx.http()
      .post('/v1/support/tickets')
      .set(auth(company.token))
      .send({ as: 'COMPANY', companyId: company.companyId, category: 'OTHER', subject: 'Dúvida sobre relatório', description: 'Como exportar o relatório de entregas?' })
      .expect(201);
    expect(ticket.body.priority).toBe('HIGH');
    await enableSaas(false);
    // Sem planos, nada é restringido.
    await ctx.http().put(`/v1/companies/${other.companyId}/brand`).set(auth(other.token)).send({ brandColor: '#000000' }).expect(200);
  });
});
