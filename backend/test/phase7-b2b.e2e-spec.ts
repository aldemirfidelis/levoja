import { DispatchService } from '../src/modules/logistics/dispatch.service';
import { InvoicesService } from '../src/modules/b2b/invoices.service';
import { SmsProvider } from '../src/modules/notifications/providers';
import { SettingsService } from '../src/modules/settings/settings.service';
import { ADMIN, createTestApp, login, TestContext, uniqueIdentity } from './utils';

/**
 * Fase 7 — B2B: contratos e tabelas especiais, limites e centros de custo, unidades e transferências,
 * chaves de API, entregas em lote (CSV/API) com rotas, faturamento mensal e entregas recorrentes.
 */
describe('Fase 7 — Corporativo (E2E)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let admin: { id: string; tenantId: string };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const apiKey = (key: string) => ({ 'X-Api-Key': key });

  const CITY = `Cidade B2B ${Date.now()}`;
  const BASE = { lat: -10 - Math.random() * 15, lng: -40 - Math.random() * 15 };
  const at = (dLatKm: number, dLngKm = 0) => ({ lat: BASE.lat + dLatKm / 111, lng: BASE.lng + dLngKm / 111 });
  const STORE = at(0);
  const inThreeDays = () => new Date(Date.now() + 3 * 86_400_000).toISOString();

  let company: { token: string; companyId: string; userId: string };
  let drivers: { token: string; driverId: string; userId: string }[] = [];
  let contractId: string;
  const centers: Record<string, string> = {};
  const locations: Record<string, string> = {};

  async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 20_000): Promise<T> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = await check();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('Tempo esgotado aguardando condição');
  }

  const deliveryBody = (extra: Record<string, unknown> = {}) => ({
    dropoff: { street: 'Rua do Cliente Corporativo', number: '10', city: CITY, state: 'SP', ...at(1.5, 0.5) },
    itemCategory: 'DOCUMENT',
    paymentMethod: 'INVOICE',
    scheduledFor: inThreeDays(),
    ...extra,
  });

  async function newDriver(position: { lat: number; lng: number }) {
    const id = uniqueIdentity();
    const response = await ctx.http()
      .post('/v1/auth/register/driver')
      .send({ name: 'Entregador Corporativo', email: id.email, phone: id.phone, password: 'SenhaForte123', cpf: id.cpf, birthDate: '1990-01-01', vehicleType: 'MOTORCYCLE', acceptTerms: true, acceptPrivacy: true, acceptDriverTerms: true, acceptLocationTracking: true })
      .expect(201);
    const row = await ctx.prisma.driver.findUniqueOrThrow({ where: { userId: response.body.user.id } });
    await ctx.prisma.driver.update({ where: { id: row.id }, data: { status: 'APPROVED', approvedAt: new Date() } });
    await ctx.prisma.vehicle.update({ where: { id: row.activeVehicleId! }, data: { status: 'APPROVED', plate: 'B2B1A23' } });
    await ctx.http().post('/v1/drivers/me/availability').set(auth(response.body.accessToken)).send({ online: true, ...position }).expect(200);
    return { token: response.body.accessToken as string, driverId: row.id, userId: response.body.user.id as string };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await login(ctx, ADMIN, 'ADMIN');
    admin = await ctx.prisma.user.findFirstOrThrow({ where: { email: ADMIN.login }, select: { id: true, tenantId: true } });

    const segments = await ctx.http().get('/v1/segments').expect(200);
    const owner = uniqueIdentity();
    const identity = uniqueIdentity();
    const registered = await ctx.http()
      .post('/v1/auth/register/company')
      .send({
        name: 'Gestora Corporativa',
        email: owner.email,
        phone: owner.phone,
        password: 'SenhaForte123',
        cpf: owner.cpf,
        acceptTerms: true,
        acceptPrivacy: true,
        acceptCompanyTerms: true,
        company: {
          legalName: 'Corporativa Teste SA',
          tradeName: `Corporativa ${Date.now()}`,
          cnpj: identity.cnpj,
          segmentId: segments.body.find((segment: { slug: string }) => segment.slug === 'restaurantes').id,
          email: identity.email,
          phone: '(11) 3000-7000',
          responsibleName: 'Gestora Corporativa',
          responsibleCpf: owner.cpf,
        },
      })
      .expect(201);
    company = { token: registered.body.accessToken, companyId: registered.body.companyId, userId: registered.body.user.id };
    await ctx.http()
      .put(`/v1/companies/${company.companyId}/address`)
      .set(auth(company.token))
      .send({ zipCode: '01310100', street: 'Avenida Matriz', number: '1', district: 'Centro', city: CITY, state: 'SP', ...STORE })
      .expect(200);
    await ctx.prisma.company.update({ where: { id: company.companyId }, data: { status: 'APPROVED' } });
    drivers = [await newDriver(at(0.1)), await newDriver(at(0.2, 0.1))];
  });

  afterAll(async () => {
    await ctx.prisma.driver.updateMany({ where: { id: { in: drivers.map((driver) => driver.driverId) } }, data: { availability: 'OFFLINE' } });
    await ctx.prisma.delivery.updateMany({ where: { companyId: company.companyId, status: { in: ['SCHEDULED', 'PENDING', 'SEARCHING_DRIVER'] } }, data: { status: 'CANCELED', canceledAt: new Date() } });
    await ctx.app.close();
  });

  // ---------------------------------------------------------------------------
  // Contrato e tabela especial
  // ---------------------------------------------------------------------------

  it('faturado exige contrato ativo; contrato com desconto e tabela especial altera a cotação', async () => {
    const noContract = await ctx.http().post(`/v1/companies/${company.companyId}/deliveries`).set(auth(company.token)).send(deliveryBody()).expect(422);
    expect(noContract.body.message).toContain('contrato corporativo');

    await ctx.http().post('/v1/admin/b2b/contracts').set(auth(company.token)).send({}).expect(403);
    const created = await ctx.http()
      .post('/v1/admin/b2b/contracts')
      .set(auth(adminToken))
      .send({ companyId: company.companyId, title: 'Contrato Documentos', startsOn: new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10), billingDay: 1, paymentTermDays: 10, creditLimitCents: 50_000, discountBps: 1000 })
      .expect(201);
    contractId = created.body.id;
    expect(created.body).toMatchObject({ status: 'DRAFT', number: expect.any(Number), availableCreditCents: 50_000 });
    expect((await ctx.http().get(`/v1/companies/${company.companyId}/b2b`).set(auth(company.token)).expect(200)).body).toMatchObject({ contract: null, contractStatus: 'DRAFT', canInvoice: false });

    await ctx.http().post(`/v1/admin/b2b/contracts/${contractId}/activate`).set(auth(adminToken)).send({}).expect(200);
    const other = await ctx.http()
      .post('/v1/admin/b2b/contracts')
      .set(auth(adminToken))
      .send({ companyId: company.companyId, title: 'Segundo', startsOn: '2026-01-01', billingDay: 5, paymentTermDays: 5, creditLimitCents: 1000 })
      .expect(201);
    await ctx.http().post(`/v1/admin/b2b/contracts/${other.body.id}/activate`).set(auth(adminToken)).send({}).expect(409);
    await ctx.http().post(`/v1/admin/b2b/contracts/${other.body.id}/end`).set(auth(adminToken)).send({}).expect(400);
    await ctx.http().post(`/v1/admin/b2b/contracts/${other.body.id}/end`).set(auth(adminToken)).send({ reason: 'Proposta substituída' }).expect(200);

    const overview = await ctx.http().get(`/v1/companies/${company.companyId}/b2b`).set(auth(company.token)).expect(200);
    expect(overview.body).toMatchObject({ canInvoice: true, contract: { id: contractId, status: 'ACTIVE', discountBps: 1000 } });

    const quoteBody = { dropoff: deliveryBody().dropoff, itemCategory: 'DOCUMENT' };
    const discounted = await ctx.http().post(`/v1/companies/${company.companyId}/deliveries/quote`).set(auth(company.token)).send(quoteBody).expect(201);
    const discount = discounted.body.breakdown.find((line: { label: string }) => line.label.startsWith('Desconto do contrato'));
    expect(discount.cents).toBeLessThan(0);
    expect(discounted.body.breakdown.reduce((sum: number, line: { cents: number }) => sum + line.cents, 0)).toBe(discounted.body.feeCents);

    await ctx.http().post(`/v1/admin/b2b/contracts/${contractId}/rules`).set(auth(adminToken)).send({ name: 'Moto até 2 km', baseCents: 900, perKmCents: 100, includedKm: 2 }).expect(201);
    const special = await ctx.http().post(`/v1/companies/${company.companyId}/deliveries/quote`).set(auth(company.token)).send(quoteBody).expect(201);
    expect(special.body.feeCents).toBe(900 + Math.round(Math.max(0, special.body.distanceKm - 2) * 100));
    expect(special.body.breakdown[0].label).toContain('contrato');
    const simulated = await ctx.http().post(`/v1/admin/b2b/contracts/${contractId}/simulate`).set(auth(adminToken)).send({ distanceKm: 5 }).expect(200);
    expect(simulated.body).toMatchObject({ source: 'SPECIAL_TABLE', contractCents: 1200, rule: 'Moto até 2 km' });
  });

  // ---------------------------------------------------------------------------
  // Centros de custo, unidades e limites
  // ---------------------------------------------------------------------------

  it('centros de custo com orçamento, limite de crédito e centro de custo obrigatório', async () => {
    await ctx.http().post(`/v1/companies/${company.companyId}/b2b/cost-centers`).set(auth(drivers[0].token)).send({ code: 'X', name: 'Intruso' }).expect(403);
    centers.MKT = (await ctx.http().post(`/v1/companies/${company.companyId}/b2b/cost-centers`).set(auth(company.token)).send({ code: 'mkt', name: 'Marketing', monthlyBudgetCents: 1500 }).expect(201)).body.id;
    centers.OPS = (await ctx.http().post(`/v1/companies/${company.companyId}/b2b/cost-centers`).set(auth(company.token)).send({ code: 'OPS', name: 'Operações' }).expect(201)).body.id;
    await ctx.http().post(`/v1/companies/${company.companyId}/b2b/cost-centers`).set(auth(company.token)).send({ code: 'MKT', name: 'Duplicado' }).expect(409);

    const first = await ctx.http().post(`/v1/companies/${company.companyId}/deliveries`).set(auth(company.token)).send(deliveryBody({ costCenterId: centers.MKT, externalRef: 'NF-1' })).expect(201);
    expect(first.body).toMatchObject({ status: 'SCHEDULED', contractId, costCenterId: centers.MKT, externalRef: 'NF-1' });
    const budget = await ctx.http().post(`/v1/companies/${company.companyId}/deliveries`).set(auth(company.token)).send(deliveryBody({ costCenterId: centers.MKT })).expect(422);
    expect(budget.body.message).toContain('Orçamento mensal do centro de custo MKT');
    const list = await ctx.http().get(`/v1/companies/${company.companyId}/b2b/cost-centers`).set(auth(company.token)).expect(200);
    expect(list.body.find((center: { code: string }) => center.code === 'MKT')).toMatchObject({ spentThisMonthCents: first.body.feeCents, availableThisMonthCents: 1500 - first.body.feeCents });

    // Limite de crédito: exposição atual + R$ 1,00.
    const exposure = (await ctx.http().get(`/v1/companies/${company.companyId}/b2b`).set(auth(company.token)).expect(200)).body.exposureCents;
    expect(exposure).toBe(first.body.feeCents);
    await ctx.http().patch(`/v1/admin/b2b/contracts/${contractId}`).set(auth(adminToken)).send({ creditLimitCents: exposure + 100 }).expect(200);
    const credit = await ctx.http().post(`/v1/companies/${company.companyId}/deliveries`).set(auth(company.token)).send(deliveryBody({ costCenterId: centers.OPS })).expect(422);
    expect(credit.body.message).toContain('Limite de crédito');
    // Carteira não usa o crédito do contrato (mas exige saldo).
    await ctx.http().patch(`/v1/admin/b2b/contracts/${contractId}`).set(auth(adminToken)).send({ creditLimitCents: 50_000, requireCostCenter: true }).expect(200);
    await ctx.http().post(`/v1/companies/${company.companyId}/deliveries`).set(auth(company.token)).send(deliveryBody()).expect(400);
    await ctx.http().patch(`/v1/admin/b2b/contracts/${contractId}`).set(auth(adminToken)).send({ requireCostCenter: false }).expect(200);
    await ctx.http().post(`/v1/companies/${company.companyId}/deliveries/${first.body.id}/cancel`).set(auth(company.token)).send({ reason: 'Teste de orçamento' }).expect(201);
  });

  it('unidades cadastradas: transferência entre unidades; clientes não usam locais de empresa', async () => {
    locations.A = (await ctx.http().post(`/v1/companies/${company.companyId}/b2b/locations`).set(auth(company.token)).send({ name: 'Filial Norte', street: 'Rua Norte', number: '100', city: CITY, state: 'sp', contactName: 'Recepção Norte', ...at(0.5, 0.3) }).expect(201)).body.id;
    locations.B = (await ctx.http().post(`/v1/companies/${company.companyId}/b2b/locations`).set(auth(company.token)).send({ name: 'Filial Sul', street: 'Rua Sul', number: '200', city: CITY, state: 'SP', contactPhone: '11999990000', ...at(-1, 0.2) }).expect(201)).body.id;
    await ctx.http().post(`/v1/companies/${company.companyId}/b2b/locations`).set(auth(company.token)).send({ name: 'Sem mapa', street: 'Rua X', number: '1', city: CITY, state: 'SP' }).expect(422);

    const transfer = await ctx.http()
      .post(`/v1/companies/${company.companyId}/deliveries`)
      .set(auth(company.token))
      .send({ pickup: { locationId: locations.A }, dropoff: { locationId: locations.B }, itemCategory: 'DOCUMENT', paymentMethod: 'INVOICE', scheduledFor: inThreeDays(), costCenterId: centers.OPS })
      .expect(201);
    expect(transfer.body.pickup).toMatchObject({ street: 'Rua Norte', name: 'Recepção Norte', state: 'SP' });
    expect(transfer.body.dropoff).toMatchObject({ street: 'Rua Sul', name: 'Filial Sul' });
    await ctx.http().post(`/v1/companies/${company.companyId}/deliveries/${transfer.body.id}/cancel`).set(auth(company.token)).send({ reason: 'Transferência de teste' }).expect(201);

    const customer = await ctx.http()
      .post('/v1/auth/register/customer')
      .send({ ...(() => { const id = uniqueIdentity(); return { email: id.email, phone: id.phone }; })(), name: 'Cliente Curioso', password: 'SenhaForte123', acceptTerms: true, acceptPrivacy: true })
      .expect(201);
    await ctx.http().post('/v1/deliveries').set(auth(customer.body.accessToken)).send({ pickup: { locationId: locations.A }, dropoff: { locationId: locations.B }, itemCategory: 'DOCUMENT', paymentMethod: 'CASH' }).expect(400);
  });

  // ---------------------------------------------------------------------------
  // Chaves de API
  // ---------------------------------------------------------------------------

  let key: string;

  it('chave de API: só nas rotas de integração, restrita à empresa e aos escopos, revogável', async () => {
    const created = await ctx.http().post(`/v1/companies/${company.companyId}/b2b/api-keys`).set(auth(company.token)).send({ name: 'ERP', scopes: ['deliveries:write', 'deliveries:read'] }).expect(201);
    key = created.body.key;
    expect(key).toMatch(/^ljk_[A-Za-z0-9]{40}$/);
    const keys = await ctx.http().get(`/v1/companies/${company.companyId}/b2b/api-keys`).set(auth(company.token)).expect(200);
    expect(JSON.stringify(keys.body)).not.toContain(key);
    expect(keys.body[0]).toMatchObject({ name: 'ERP', prefix: key.slice(0, 12), active: true });

    await ctx.http().get(`/v1/companies/${company.companyId}/delivery-batches`).set(apiKey(key)).expect(200);
    await ctx.http().post(`/v1/companies/${company.companyId}/deliveries/quote`).set(apiKey(key)).send({ dropoff: deliveryBody().dropoff, itemCategory: 'PACKAGE' }).expect(201);
    expect((await ctx.http().get('/v1/auth/me').set(apiKey(key)).expect(403)).body.message).toContain('não aceita chave');
    await ctx.http().get(`/v1/companies/${company.companyId}/b2b/api-keys`).set(apiKey(key)).expect(403);
    const otherCompany = await ctx.prisma.company.findFirstOrThrow({ where: { id: { not: company.companyId }, status: 'APPROVED' } });
    await ctx.http().get(`/v1/companies/${otherCompany.id}/delivery-batches`).set(apiKey(key)).expect(403);
    await ctx.http().get(`/v1/companies/${company.companyId}/delivery-batches`).set(apiKey(`ljk_${'x'.repeat(40)}`)).expect(401);

    const readOnly = await ctx.http().post(`/v1/companies/${company.companyId}/b2b/api-keys`).set(auth(company.token)).send({ name: 'BI', scopes: ['deliveries:read'] }).expect(201);
    await ctx.http().post(`/v1/companies/${company.companyId}/deliveries/quote`).set(apiKey(readOnly.body.key)).send({ dropoff: deliveryBody().dropoff, itemCategory: 'PACKAGE' }).expect(403);
    await ctx.http().delete(`/v1/companies/${company.companyId}/b2b/api-keys/${readOnly.body.id}`).set(auth(company.token)).expect(204);
    await ctx.http().get(`/v1/companies/${company.companyId}/delivery-batches`).set(apiKey(readOnly.body.key)).expect(401);
  });

  // ---------------------------------------------------------------------------
  // Lotes: validação, rotas, despacho e conclusão
  // ---------------------------------------------------------------------------

  let batchId: string;

  it('lote por CSV: valida endereços e preços, aponta erros por linha e planeja a rota', async () => {
    const template = await ctx.http().get(`/v1/companies/${company.companyId}/delivery-batches/template.csv`).set(auth(company.token)).expect(200);
    expect(template.text.charCodeAt(0)).toBe(0xfeff);
    const xlsx = await ctx.http().get(`/v1/companies/${company.companyId}/delivery-batches/template.xlsx`).set(auth(company.token)).buffer(true).parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    }).expect(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');

    const p = (dLat: number, dLng: number) => at(dLat, dLng);
    const rows = [
      ['referencia', 'destinatário', 'telefone', 'rua', 'número', 'cidade', 'uf', 'latitude', 'longitude', 'categoria', 'centro_custo', 'peso_kg', 'comprovação'],
      ['PED-1', 'Ana', '11988887777', 'Rua Um', '1', CITY, 'SP', p(1.0, 0.2).lat, p(1.0, 0.2).lng, 'Documentos', 'OPS', '0,5', 'código'],
      ['PED-2', 'Bruno', '', 'Rua Dois', '2', CITY, 'SP', p(1.3, 0.4).lat, p(1.3, 0.4).lng, 'Encomenda', '', '1', ''],
      ['PED-3', 'Carla', '', 'Rua Três', '3', CITY, 'SP', p(1.1, 0.6).lat, p(1.1, 0.6).lng, '', 'OPS', '', ''],
      ['PED-4', 'Davi', '', '', '4', CITY, 'SP', p(1.2, 0.1).lat, p(1.2, 0.1).lng, '', '', '', ''],
      ['PED-5', 'Eva', '', 'Rua Cinco', '5', CITY, 'SP', '', '', 'Foguete', 'NAOEXISTE', '', ''],
    ];
    const csv = rows.map((row) => row.join(';')).join('\n');
    const uploaded = await ctx.http()
      .post(`/v1/companies/${company.companyId}/delivery-batches/upload`)
      .set(auth(company.token))
      .field('paymentMethod', 'INVOICE')
      .field('name', 'Malotes de segunda')
      .attach('file', Buffer.from(csv, 'utf8'), 'lote.csv')
      .expect(201);
    batchId = uploaded.body.id;
    expect(uploaded.body).toMatchObject({ status: 'VALIDATING', itemsCount: 5, source: 'CSV' });

    const ready = await waitFor(async () => {
      const response = await ctx.http().get(`/v1/companies/${company.companyId}/delivery-batches/${batchId}`).set(auth(company.token)).expect(200);
      return response.body.status === 'READY' ? response.body : null;
    });
    expect(ready).toMatchObject({ validCount: 3, invalidCount: 2 });
    expect(ready.totalFeeCents).toBeGreaterThan(0);
    expect(ready.routes).toEqual([expect.objectContaining({ stopsCount: 3, status: 'PLANNED' })]);

    const invalid = await ctx.http().get(`/v1/companies/${company.companyId}/delivery-batches/${batchId}/items`).query({ status: 'INVALID' }).set(auth(company.token)).expect(200);
    const errors = Object.fromEntries(invalid.body.data.map((item: { externalRef: string; errors: string[] }) => [item.externalRef, item.errors.join(' ')]));
    expect(errors['PED-4']).toContain('Informe rua');
    expect(errors['PED-5']).toContain('Categoria desconhecida');
    expect(errors['PED-5']).toContain('Centro de custo "NAOEXISTE"');
  });

  it('confirmação cria as entregas em rota; a rota inteira vai para um único entregador', async () => {
    const confirmed = await ctx.http().post(`/v1/companies/${company.companyId}/delivery-batches/${batchId}/confirm`).set(auth(company.token)).send({}).expect(200);
    expect(confirmed.body).toMatchObject({ status: 'CONFIRMED', routesCount: 1, progress: { total: 3 } });
    await ctx.http().post(`/v1/companies/${company.companyId}/delivery-batches/${batchId}/confirm`).set(auth(company.token)).send({}).expect(409);

    const deliveries = await ctx.prisma.delivery.findMany({ where: { batchId }, orderBy: { routeSequence: 'asc' } });
    expect(deliveries.map((delivery) => delivery.routeSequence)).toEqual([1, 2, 3]);
    expect(deliveries.every((delivery) => delivery.contractId === contractId && delivery.paymentMethod === 'INVOICE')).toBe(true);
    expect(deliveries.filter((delivery) => delivery.costCenterId === centers.OPS)).toHaveLength(2);

    const route = await waitFor(() => ctx.prisma.deliveryRoute.findFirst({ where: { batchId, status: 'DISPATCHING', leadDeliveryId: { not: null } } }));
    const offer = await waitFor(() => ctx.prisma.deliveryOffer.findFirst({ where: { deliveryId: route.leadDeliveryId!, status: 'PENDING' } }));
    // Só o líder recebe oferta.
    expect(await ctx.prisma.deliveryOffer.count({ where: { deliveryId: { in: deliveries.filter((delivery) => delivery.id !== route.leadDeliveryId).map((delivery) => delivery.id) } } })).toBe(0);
    const chosen = drivers.find((driver) => driver.driverId === offer.driverId)!;
    const offers = await ctx.http().get('/v1/drivers/me/offers').set(auth(chosen.token)).expect(200);
    expect(offers.body[0]).toMatchObject({ route: { stops: 3 }, payoutCents: deliveries.reduce((sum, delivery) => sum + delivery.payoutCents + delivery.tipCents, 0) });

    await ctx.http().post(`/v1/drivers/me/offers/${offer.id}/accept`).set(auth(chosen.token)).expect(200);
    const assigned = await ctx.prisma.delivery.findMany({ where: { batchId } });
    expect(assigned.every((delivery) => delivery.status === 'DRIVER_ASSIGNED' && delivery.driverId === chosen.driverId)).toBe(true);
    expect(await ctx.prisma.deliveryRoute.findUniqueOrThrow({ where: { id: route.id } })).toMatchObject({ status: 'ASSIGNED', driverId: chosen.driverId });
    const plan = await ctx.http().get('/v1/drivers/me/route').set(auth(chosen.token)).expect(200);
    expect(plan.body.deliveries).toHaveLength(3);

    // Coleta de todas e entrega uma a uma (com o código de recebimento).
    const sms = ctx.app.get(SmsProvider);
    for (const delivery of assigned) await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/picked-up`).set(auth(chosen.token)).expect(204);
    const anaDelivery = assigned.find((delivery) => delivery.externalRef === 'PED-1')!;
    await waitFor(async () => sms.sent.find((message) => message.to === '+5511988887777' && message.body.includes(`/rastreio/${anaDelivery.code}`)));
    for (const delivery of assigned) {
      await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/start-route`).set(auth(chosen.token)).expect(204);
      await ctx.http().post('/v1/drivers/me/location').set(auth(chosen.token)).send({ lat: delivery.dropoffLat, lng: delivery.dropoffLng, speed: 2 }).expect(200);
      expect(delivery.proofMethod).toBe('CODE');
      await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/deliver`).set(auth(chosen.token)).send({ method: 'CODE', code: delivery.dropoffCode }).expect(200);
    }
    await ctx.http().post('/v1/drivers/me/location').set(auth(chosen.token)).send({ ...at(0.1), speed: 2 }).expect(200);

    const done = await waitFor(async () => {
      const response = await ctx.http().get(`/v1/companies/${company.companyId}/delivery-batches/${batchId}`).set(auth(company.token)).expect(200);
      return response.body.completedAt ? response.body : null;
    });
    expect(done.progress).toMatchObject({ delivered: 3, finished: 3 });
    expect(done.routes[0]).toMatchObject({ status: 'COMPLETED' });
    await waitFor(() => ctx.prisma.notification.findFirst({ where: { userId: company.userId, type: 'b2b.batch.completed' } }));

    const exported = await ctx.http().get(`/v1/companies/${company.companyId}/delivery-batches/${batchId}/export.csv`).set(apiKey(key)).expect(200);
    expect(exported.text).toContain(`/rastreio/${anaDelivery.code}`);
    expect(exported.text).toContain('INVALID');
  });

  it('lote pela API (JSON) com chave e cancelamento antes da confirmação', async () => {
    const created = await ctx.http()
      .post(`/v1/companies/${company.companyId}/delivery-batches`)
      .set(apiKey(key))
      .send({
        paymentMethod: 'INVOICE',
        scheduledFor: inThreeDays(),
        items: [
          { externalRef: 'API-1', recipientName: 'Fulano', street: 'Rua API', number: '1', city: CITY, state: 'SP', ...at(2, 0), itemCategory: 'PACKAGE', weightKg: 2, costCenter: 'OPS' },
          { externalRef: 'API-2', recipientName: 'Beltrano', street: 'Rua API', number: '2', city: CITY, state: 'SP', ...at(2.2, 0.1), declaredValueCents: 15000 },
        ],
      })
      .expect(201);
    expect(created.body).toMatchObject({ source: 'API', itemsCount: 2 });
    await waitFor(async () => (await ctx.prisma.deliveryBatch.findUnique({ where: { id: created.body.id } }))?.status === 'READY');
    const canceled = await ctx.http().post(`/v1/companies/${company.companyId}/delivery-batches/${created.body.id}/cancel`).set(apiKey(key)).send({ reason: 'Pedido do ERP' }).expect(200);
    expect(canceled.body.status).toBe('CANCELED');
    await ctx.http().post(`/v1/companies/${company.companyId}/delivery-batches/${created.body.id}/confirm`).set(apiKey(key)).send({}).expect(409);
    await ctx.http().post(`/v1/companies/${company.companyId}/delivery-batches`).set(apiKey(key)).send({ paymentMethod: 'CASH', items: [{ recipientName: 'X', street: 'Y', number: '1', city: CITY, state: 'SP' }] }).expect(400);
  });

  it('rota sem entregador disponível é distribuída entrega a entrega', async () => {
    const settings = ctx.app.get(SettingsService);
    const original = await settings.get(admin.tenantId, 'b2b');
    await settings.set(admin.tenantId, 'b2b', { ...original, routeFallbackMinutes: 1 }, admin.id);
    await ctx.prisma.driver.updateMany({ where: { id: { in: drivers.map((driver) => driver.driverId) } }, data: { availability: 'OFFLINE' } });
    try {
      const created = await ctx.http()
        .post(`/v1/companies/${company.companyId}/delivery-batches`)
        .set(auth(company.token))
        .send({ paymentMethod: 'INVOICE', items: [0, 1].map((index) => ({ recipientName: `Pessoa ${index}`, street: 'Rua Split', number: String(index + 1), city: CITY, state: 'SP', ...at(1 + index * 0.2, -0.5) })) })
        .expect(201);
      await waitFor(async () => (await ctx.prisma.deliveryBatch.findUnique({ where: { id: created.body.id } }))?.status === 'READY');
      await ctx.http().post(`/v1/companies/${company.companyId}/delivery-batches/${created.body.id}/confirm`).set(auth(company.token)).send({}).expect(200);
      const route = await waitFor(() => ctx.prisma.deliveryRoute.findFirst({ where: { batchId: created.body.id, status: 'DISPATCHING', leadDeliveryId: { not: null } } }));
      await ctx.prisma.delivery.update({ where: { id: route.leadDeliveryId! }, data: { searchStartedAt: new Date(Date.now() - 2 * 60_000) } });
      await ctx.app.get(DispatchService).offerNext(route.leadDeliveryId!);
      expect((await ctx.prisma.deliveryRoute.findUniqueOrThrow({ where: { id: route.id } })).status).toBe('SPLIT');
      const split = await ctx.prisma.delivery.findMany({ where: { batchId: created.body.id } });
      expect(split.every((delivery) => delivery.status === 'SEARCHING_DRIVER' && delivery.searchStartedAt!.getTime() > Date.now() - 60_000)).toBe(true);

      const canceled = await ctx.http().post(`/v1/companies/${company.companyId}/delivery-batches/${created.body.id}/cancel`).set(auth(company.token)).send({ reason: 'Sem entregadores' }).expect(200);
      expect(canceled.body.canceledNow).toBe(2);
    } finally {
      await settings.set(admin.tenantId, 'b2b', original, admin.id);
      for (const driver of drivers) await ctx.http().post('/v1/drivers/me/availability').set(auth(driver.token)).send({ online: true, ...at(0.1) }).expect(200);
    }
  });

  // ---------------------------------------------------------------------------
  // Faturamento
  // ---------------------------------------------------------------------------

  it('fatura: fechamento, demonstrativo, quitação avulsa bloqueada e pagamento por PIX', async () => {
    const batchDeliveries = await ctx.prisma.delivery.findMany({ where: { batchId, status: 'DELIVERED' } });
    const expected = batchDeliveries.reduce((sum, delivery) => sum + delivery.feeCents + delivery.tipCents, 0);

    await ctx.http().post(`/v1/admin/b2b/contracts/${contractId}/invoices/close`).set(auth(company.token)).expect(403);
    const closed = await ctx.http().post(`/v1/admin/b2b/contracts/${contractId}/invoices/close`).set(auth(adminToken)).expect(200);
    expect(closed.body).toMatchObject({ status: 'ISSUED', deliveriesCount: 3, deliveriesCents: expected, totalCents: expected, minimumAdjustmentCents: 0 });
    expect(closed.body.byCostCenter).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'OPS', deliveries: 2 }), expect.objectContaining({ name: 'Sem centro de custo', deliveries: 1 })]));
    expect(await ctx.prisma.delivery.count({ where: { batchId, invoiceId: closed.body.id } })).toBe(3);
    // Sem novas entregas: não emite fatura vazia.
    expect((await ctx.http().post(`/v1/admin/b2b/contracts/${contractId}/invoices/close`).set(auth(adminToken)).expect(200)).body.invoice).toBeNull();

    const listed = await ctx.http().get(`/v1/companies/${company.companyId}/b2b/invoices`).set(auth(company.token)).expect(200);
    expect(listed.body.data[0]).toMatchObject({ id: closed.body.id, number: closed.body.number });
    const csv = await ctx.http().get(`/v1/companies/${company.companyId}/b2b/invoices/${closed.body.id}/export.csv`).set(auth(company.token)).expect(200);
    expect(csv.text.split('\r\n').filter(Boolean)).toHaveLength(5);
    expect(csv.text).toContain(`TOTAL;;;;;${(expected / 100).toFixed(2).replace('.', ',')}`);

    const debt = await ctx.http().post(`/v1/companies/${company.companyId}/finance/settle-debt`).set(auth(company.token)).expect(409);
    expect(debt.body.message).toContain('fatura');

    const walletBefore = await ctx.prisma.wallet.findFirstOrThrow({ where: { companyId: company.companyId } });
    const pix = await ctx.http().post(`/v1/companies/${company.companyId}/b2b/invoices/${closed.body.id}/pay`).set(auth(company.token)).expect(200);
    expect(pix.body).toMatchObject({ amountCents: expected, status: 'PENDING', pixCopyPaste: expect.stringMatching(/^000201/) });
    await ctx.http().post(`/v1/payments/sandbox/${pix.body.id}/approve`).set(auth(company.token)).expect(200);
    await waitFor(async () => (await ctx.prisma.invoice.findUnique({ where: { id: closed.body.id } }))?.status === 'PAID');
    const walletAfter = await ctx.prisma.wallet.findFirstOrThrow({ where: { companyId: company.companyId } });
    expect(walletAfter.availableCents + walletAfter.pendingCents - (walletBefore.availableCents + walletBefore.pendingCents)).toBe(expected);
    expect((await ctx.http().get(`/v1/companies/${company.companyId}/b2b`).set(auth(company.token)).expect(200)).body.openInvoices).toBe(0);
  });

  it('franquia mínima, atraso bloqueia faturado, baixa manual libera; cancelamento devolve o período', async () => {
    const invoices = ctx.app.get(InvoicesService);
    await ctx.http().patch(`/v1/admin/b2b/contracts/${contractId}`).set(auth(adminToken)).send({ minimumMonthlyCents: 5000, blockAfterOverdueDays: 0 }).expect(200);
    await ctx.prisma.corporateContract.update({ where: { id: contractId }, data: { invoicedUntil: new Date(Date.now() - 31 * 86_400_000) } });
    const minimum = await ctx.http().post(`/v1/admin/b2b/contracts/${contractId}/invoices/close`).set(auth(adminToken)).expect(200);
    expect(minimum.body).toMatchObject({ deliveriesCount: 0, minimumAdjustmentCents: 5000, totalCents: 5000 });
    expect(await ctx.prisma.walletTransaction.count({ where: { referenceKey: { startsWith: `invoice:${minimum.body.id}:minimum` } } })).toBe(2);

    await ctx.prisma.invoice.update({ where: { id: minimum.body.id }, data: { dueAt: new Date(Date.now() - 86_400_000) } });
    expect(await invoices.markOverdue()).toBeGreaterThanOrEqual(1);
    const blocked = await ctx.http().post(`/v1/companies/${company.companyId}/deliveries`).set(auth(company.token)).send(deliveryBody({ costCenterId: centers.OPS })).expect(403);
    expect(blocked.body.message).toContain('vencida');

    await ctx.http().post(`/v1/admin/b2b/invoices/${minimum.body.id}/mark-paid`).set(auth(adminToken)).send({ reference: 'TED 123' }).expect(200);
    await ctx.http().post(`/v1/admin/b2b/invoices/${minimum.body.id}/mark-paid`).set(auth(adminToken)).send({ reference: 'TED 123' }).expect(409);
    const allowed = await ctx.http().post(`/v1/companies/${company.companyId}/deliveries`).set(auth(company.token)).send(deliveryBody({ costCenterId: centers.OPS })).expect(201);
    await ctx.http().post(`/v1/companies/${company.companyId}/deliveries/${allowed.body.id}/cancel`).set(auth(company.token)).send({ reason: 'Teste' }).expect(201);

    await ctx.prisma.corporateContract.update({ where: { id: contractId }, data: { invoicedUntil: new Date(Date.now() - 30 * 86_400_000) } });
    const toCancel = await ctx.http().post(`/v1/admin/b2b/contracts/${contractId}/invoices/close`).set(auth(adminToken)).expect(200);
    const canceled = await ctx.http().post(`/v1/admin/b2b/invoices/${toCancel.body.id}/cancel`).set(auth(adminToken)).send({ reason: 'Franquia negociada' }).expect(200);
    expect(canceled.body.status).toBe('CANCELED');
    const contract = await ctx.prisma.corporateContract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.invoicedUntil?.getTime()).toBe(new Date(toCancel.body.periodStart).getTime());
    expect(await ctx.prisma.walletTransaction.count({ where: { referenceKey: { startsWith: `invoice:${toCancel.body.id}:minimum-reversal` } } })).toBe(2);
    await ctx.http().patch(`/v1/admin/b2b/contracts/${contractId}`).set(auth(adminToken)).send({ minimumMonthlyCents: 0, blockAfterOverdueDays: 5 }).expect(200);

    const staff = await ctx.http().get('/v1/admin/b2b/invoices').query({ companyId: company.companyId }).set(auth(adminToken)).expect(200);
    expect(staff.body.data.map((invoice: { status: string }) => invoice.status).sort()).toEqual(['CANCELED', 'PAID', 'PAID']);
  });

  it('fechamento mensal automático no dia de fechamento (e recupera dias perdidos)', () => {
    const invoices = ctx.app.get(InvoicesService);
    const tz = 'America/Sao_Paulo';
    expect(invoices.lastClosing(5, tz, new Date('2026-09-24T15:00:00Z')).toISOString()).toBe('2026-09-05T03:00:00.000Z');
    expect(invoices.lastClosing(25, tz, new Date('2026-09-24T15:00:00Z')).toISOString()).toBe('2026-08-25T03:00:00.000Z');
    expect(invoices.lastClosing(1, tz, new Date('2026-01-01T02:59:00Z')).toISOString()).toBe('2025-12-01T03:00:00.000Z');
  });

  // ---------------------------------------------------------------------------
  // Recorrências e relatório corporativo
  // ---------------------------------------------------------------------------

  it('entrega recorrente entre unidades vira entrega agendada uma única vez por data', async () => {
    const target = new Date(Date.now() + 3 * 3_600_000);
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(target);
    const part = (type: string) => local.find((item) => item.type === type)!.value;
    const date = `${part('year')}-${part('month')}-${part('day')}`;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const created = await ctx.http()
      .post(`/v1/companies/${company.companyId}/b2b/recurring-deliveries`)
      .set(auth(company.token))
      .send({ name: 'Malote diário', pickupLocationId: locations.A, dropoffLocationId: locations.B, weekdays: [weekday], time: `${part('hour')}:${part('minute')}`, startsOn: date, itemCategory: 'DOCUMENT', paymentMethod: 'INVOICE', costCenterId: centers.OPS })
      .expect(201);
    const first = await ctx.http().post(`/v1/companies/${company.companyId}/b2b/recurring-deliveries/${created.body.id}/run`).set(auth(company.token)).expect(200);
    expect(first.body.created).toBe(1);
    const run = first.body.runs[0];
    expect(run).toMatchObject({ occursOn: date, error: null });
    const delivery = await ctx.prisma.delivery.findUniqueOrThrow({ where: { id: run.deliveryId } });
    expect(delivery).toMatchObject({ status: 'SCHEDULED', recurrenceId: created.body.id, costCenterId: centers.OPS, contractId });
    expect(Math.abs(delivery.scheduledFor!.getTime() - target.getTime())).toBeLessThan(60_000);
    expect((await ctx.http().post(`/v1/companies/${company.companyId}/b2b/recurring-deliveries/${created.body.id}/run`).set(auth(company.token)).expect(200)).body.created).toBe(0);
    await ctx.http().patch(`/v1/companies/${company.companyId}/b2b/recurring-deliveries/${created.body.id}`).set(auth(company.token)).send({ isActive: false }).expect(200);
  });

  it('relatório corporativo por centro de custo (JSON e CSV)', async () => {
    const report = await ctx.http().get(`/v1/companies/${company.companyId}/b2b/report`).set(auth(company.token)).expect(200);
    const metric = (key: string) => report.body.summary.find((item: { key: string }) => item.key === key)?.value;
    expect(metric('delivered')).toBe(3);
    expect(metric('batched')).toBeGreaterThanOrEqual(3);
    expect(metric('spend')).toBeGreaterThan(0);
    expect(report.body.tables.costCenters.rows).toEqual(expect.arrayContaining([expect.objectContaining({ costCenter: 'OPS — Operações', delivered: 2 })]));
    const csv = await ctx.http().get(`/v1/companies/${company.companyId}/b2b/report`).query({ format: 'csv' }).set(auth(company.token)).expect(200);
    expect(csv.text).toContain('Centro de custo;Entregas;Entregues;No prazo;Gasto;Orçamento mensal');
    const adminReport = await ctx.http().get('/v1/admin/reports/corporate').query({ companyId: company.companyId }).set(auth(adminToken)).expect(200);
    expect(adminReport.body.kind).toBe('corporate');
    await ctx.http().get('/v1/admin/reports/corporate').set(auth(adminToken)).expect(400);
  });
});
