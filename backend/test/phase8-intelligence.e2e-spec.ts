import { randomBytes, randomUUID } from 'node:crypto';
import { cityKey } from '@levoja/shared';
import { SettingsService } from '../src/modules/settings/settings.service';
import { AiService } from '../src/modules/intelligence/ai/ai.service';
import type { AiProvider } from '../src/modules/intelligence/ai/ai.provider';
import { EtaService } from '../src/modules/intelligence/eta.service';
import { ADMIN, createTestApp, login, TestContext, uniqueIdentity } from './utils';

/**
 * Fase 8 — Inteligência: antifraude (aparelhos, cupons, pagamentos, GPS, cancelamentos, score
 * configurável e revisão humana), previsão de demanda e de entregadores, sugestões de preço com
 * aprovação, anomalias na torre, tempo de entrega calibrado, análise de avaliações e IA assistiva.
 */
describe('Fase 8 — Inteligência (E2E)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let admin: { id: string; tenantId: string };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const CITY = `Cidade Inteligencia ${Date.now()}`;
  const BASE = { lat: -10 - Math.random() * 15, lng: -40 - Math.random() * 15 };
  const at = (dLatKm: number, dLngKm = 0) => ({ lat: BASE.lat + dLatKm / 111, lng: BASE.lng + dLngKm / 111 });
  const STORE = at(0);
  const HOME = at(1.1, 0.6);
  const PRICE = 3000;
  const HOUR = 3_600_000;
  const WEEK = 7 * 24 * HOUR;
  const floorHour = (date: Date) => new Date(Math.floor(date.getTime() / HOUR) * HOUR);
  const newDevice = () => `dev${randomBytes(16).toString('hex')}`;

  let company: { token: string; companyId: string; userId: string };
  let driver: { token: string; driverId: string; userId: string };
  let productId: string;

  async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 15_000): Promise<T> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = await check();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('Tempo esgotado aguardando condição');
  }

  async function newCustomer(options: { device?: string; name?: string; number?: string } = {}) {
    const id = uniqueIdentity();
    const request = ctx.http().post('/v1/auth/register/customer');
    if (options.device) request.set('X-Device-Id', options.device);
    const response = await request
      .send({ name: options.name ?? 'Cliente Inteligência', email: id.email, phone: id.phone, password: 'SenhaForte123', acceptTerms: true, acceptPrivacy: true })
      .expect(201);
    const address = await ctx.http()
      .post('/v1/me/addresses')
      .set(auth(response.body.accessToken))
      .send({ zipCode: '04571010', street: 'Rua da Previsão', number: options.number ?? String(100 + Math.floor(Math.random() * 9000)), district: 'Centro', city: CITY, state: 'SP', ...HOME })
      .expect(201);
    const customer = await ctx.prisma.customer.findUniqueOrThrow({ where: { userId: response.body.user.id } });
    return { token: response.body.accessToken as string, userId: response.body.user.id as string, customerId: customer.id, addressId: address.body.id as string };
  }
  type Customer = Awaited<ReturnType<typeof newCustomer>>;

  async function order(customer: Customer, body: Record<string, unknown> = {}, status = 201) {
    await ctx.http().post('/v1/cart/items').set(auth(customer.token)).send({ productId, quantity: 2 }).expect(201);
    const response = await ctx.http()
      .post('/v1/orders')
      .set(auth(customer.token))
      .send({ companyId: company.companyId, addressId: customer.addressId, paymentMethod: 'CASH', ...body })
      .expect(status);
    if (status >= 300) await ctx.prisma.cart.deleteMany({ where: { customerId: customer.customerId } });
    return response.body;
  }

  /** Entrega sintética (histórico) para previsão e calibração. */
  function syntheticDelivery(city: string, base: { lat: number; lng: number }, createdAt: Date, extra: Record<string, unknown> = {}) {
    return {
      tenantId: admin.tenantId,
      code: `S${randomBytes(6).toString('hex').toUpperCase()}`,
      kind: 'ON_DEMAND' as const,
      requesterUserId: admin.id,
      status: 'DELIVERED' as const,
      pickup: { street: 'Rua Histórica', number: '1', city, state: 'SP' },
      dropoff: { street: 'Rua Destino', number: '2', city, state: 'SP' },
      pickupLat: base.lat,
      pickupLng: base.lng,
      dropoffLat: base.lat + 0.01,
      dropoffLng: base.lng + 0.01,
      city,
      state: 'SP',
      vehicleType: 'MOTORCYCLE' as const,
      distanceKm: 3,
      durationMin: 10,
      feeCents: 1000,
      payoutCents: 800,
      dropoffCode: '1234',
      createdAt,
      ...extra,
    };
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
        name: 'Dona Inteligência',
        email: owner.email,
        phone: owner.phone,
        password: 'SenhaForte123',
        cpf: owner.cpf,
        acceptTerms: true,
        acceptPrivacy: true,
        acceptCompanyTerms: true,
        company: {
          legalName: 'Inteligência Teste LTDA',
          tradeName: `Loja Inteligência ${Date.now()}`,
          cnpj: identity.cnpj,
          segmentId: segments.body.find((segment: { slug: string }) => segment.slug === 'restaurantes').id,
          email: identity.email,
          phone: '(11) 3000-8000',
          responsibleName: 'Dona Inteligência',
          responsibleCpf: owner.cpf,
        },
      })
      .expect(201);
    company = { token: registered.body.accessToken, companyId: registered.body.companyId, userId: registered.body.user.id };
    await ctx.http()
      .put(`/v1/companies/${company.companyId}/address`)
      .set(auth(company.token))
      .send({ zipCode: '01310100', street: 'Rua da Loja Inteligente', number: '8', district: 'Centro', city: CITY, state: 'SP', ...STORE })
      .expect(200);
    await ctx.http()
      .put(`/v1/companies/${company.companyId}/opening-hours`)
      .set(auth(company.token))
      .send({ hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: '00:00', closesAt: '23:59' })) })
      .expect(200);
    await ctx.prisma.company.update({ where: { id: company.companyId }, data: { status: 'APPROVED', isOpen: true } });
    productId = (await ctx.http().post(`/v1/companies/${company.companyId}/products`).set(auth(company.token)).send({ name: 'Pizza', priceCents: PRICE, weightGrams: 800 }).expect(201)).body.id;

    const id = uniqueIdentity();
    const response = await ctx.http()
      .post('/v1/auth/register/driver')
      .send({ name: 'Entregador Inteligente', email: id.email, phone: id.phone, password: 'SenhaForte123', cpf: id.cpf, birthDate: '1991-02-02', vehicleType: 'MOTORCYCLE', acceptTerms: true, acceptPrivacy: true, acceptDriverTerms: true, acceptLocationTracking: true })
      .expect(201);
    const row = await ctx.prisma.driver.findUniqueOrThrow({ where: { userId: response.body.user.id } });
    await ctx.prisma.driver.update({ where: { id: row.id }, data: { status: 'APPROVED', approvedAt: new Date() } });
    await ctx.prisma.vehicle.update({ where: { id: row.activeVehicleId! }, data: { status: 'APPROVED', plate: 'INT1A23' } });
    driver = { token: response.body.accessToken, driverId: row.id, userId: response.body.user.id };
    await ctx.http().post('/v1/drivers/me/availability').set(auth(driver.token)).send({ online: true, ...at(0.2) }).expect(200);
  });

  afterAll(async () => {
    await ctx.prisma.driver.update({ where: { id: driver.driverId }, data: { availability: 'OFFLINE' } });
    await ctx.app.close();
  });

  // ---------------------------------------------------------------------------
  // Antifraude
  // ---------------------------------------------------------------------------

  it('várias contas no mesmo aparelho geram sinal com as contas relacionadas (aparelho guardado como hash)', async () => {
    const device = newDevice();
    const first = await newCustomer({ device });
    const second = await newCustomer({ device });
    const third = await newCustomer({ device });

    const signal = await waitFor(() => ctx.prisma.riskSignal.findFirst({ where: { userId: third.userId, type: 'SHARED_DEVICE' } }));
    expect(signal.relatedUserIds).toEqual(expect.arrayContaining([first.userId, second.userId]));
    expect(await ctx.prisma.riskSignal.count({ where: { userId: second.userId, type: 'SHARED_DEVICE' } })).toBe(0);
    const sightings = await ctx.prisma.deviceSighting.findMany({ where: { userId: { in: [first.userId, second.userId, third.userId] } } });
    expect(sightings).toHaveLength(3);
    expect(new Set(sightings.map((sighting) => sighting.deviceHash)).size).toBe(1);
    expect(sightings[0].deviceHash).not.toContain(device);

    // Login de novo pelo mesmo aparelho não duplica o sinal.
    await ctx.http().post('/v1/auth/login').set('X-Device-Id', device).send({ login: (await ctx.prisma.user.findUniqueOrThrow({ where: { id: third.userId } })).email, password: 'SenhaForte123' }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await ctx.prisma.riskSignal.count({ where: { userId: third.userId, type: 'SHARED_DEVICE' } })).toBe(1);
  });

  it('cupom de primeira compra não é reaproveitado por outra conta no mesmo aparelho ou endereço', async () => {
    const code = `PRIMEIRA${Date.now().toString().slice(-6)}`;
    await ctx.http().post('/v1/admin/finance/coupons').set(auth(adminToken)).send({ code, type: 'FIXED', amountCents: 500, firstOrderOnly: true, maxPerCustomer: 1 }).expect(201);
    const device = newDevice();
    const number = String(5000 + Math.floor(Math.random() * 4000));
    const original = await newCustomer({ device, number });
    const placed = await order(original, { couponCode: code });
    expect(placed.discountCents).toBe(500);

    // Mesmo aparelho, outro endereço.
    const sameDevice = await newCustomer({ device });
    await ctx.http().post('/v1/cart/items').set(auth(sameDevice.token)).send({ productId, quantity: 2 }).expect(201);
    const quote = await ctx.http().post('/v1/orders/quote').set(auth(sameDevice.token)).send({ companyId: company.companyId, addressId: sameDevice.addressId, couponCode: code }).expect(201);
    expect(quote.body.canCheckout).toBe(false);
    expect(quote.body.issues.join(' ')).toContain('já foi usado em outra conta');
    await ctx.http().post('/v1/orders').set(auth(sameDevice.token)).send({ companyId: company.companyId, addressId: sameDevice.addressId, paymentMethod: 'CASH', couponCode: code }).expect(409);
    await waitFor(() => ctx.prisma.riskSignal.findFirst({ where: { userId: sameDevice.userId, type: 'COUPON_ABUSE' } }));
    // Sem o cupom, a compra segue normalmente (nada é bloqueado além do desconto).
    await ctx.http().post('/v1/orders').set(auth(sameDevice.token)).send({ companyId: company.companyId, addressId: sameDevice.addressId, paymentMethod: 'CASH' }).expect(201);

    // Outro aparelho, mesmo endereço de entrega.
    const sameAddress = await newCustomer({ device: newDevice(), number });
    await ctx.http().post('/v1/cart/items').set(auth(sameAddress.token)).send({ productId, quantity: 2 }).expect(201);
    const byAddress = await ctx.http().post('/v1/orders/quote').set(auth(sameAddress.token)).send({ companyId: company.companyId, addressId: sameAddress.addressId, couponCode: code }).expect(201);
    expect(byAddress.body.issues.join(' ')).toContain('neste aparelho ou endereço');
    const abuse = await waitFor(() => ctx.prisma.riskSignal.findFirst({ where: { userId: sameAddress.userId, type: 'COUPON_ABUSE' } }));
    expect(abuse.relatedUserIds).toContain(original.userId);
    await ctx.prisma.cart.deleteMany({ where: { customerId: sameAddress.customerId } });
  });

  it('score configurável abre caso para revisão; risco alto paga online até a equipe liberar a conta', async () => {
    const customer = await newCustomer();
    await ctx.http().post(`/v1/admin/intelligence/fraud/users/${customer.userId}/signals`).set(auth(company.token)).send({ message: 'Denúncia', points: 40 }).expect(403);
    const first = await ctx.http().post(`/v1/admin/intelligence/fraud/users/${customer.userId}/signals`).set(auth(adminToken)).send({ message: 'Denúncia da loja: endereço falso', points: 40 }).expect(201);
    expect(first.body.profile).toMatchObject({ score: 40, level: 'MEDIUM' });
    expect(first.body.cases).toHaveLength(0);

    // Médio ainda paga em dinheiro.
    await order(customer);
    const second = await ctx.http().post(`/v1/admin/intelligence/fraud/users/${customer.userId}/signals`).set(auth(adminToken)).send({ message: 'Recusou pedido na porta duas vezes', points: 30 }).expect(201);
    expect(second.body.profile).toMatchObject({ score: 70, level: 'HIGH' });
    expect(second.body.cases[0]).toMatchObject({ status: 'OPEN', level: 'HIGH' });

    const denied = await order(customer, {}, 422);
    expect(denied.message).toContain('pago online');

    const list = await ctx.http().get('/v1/admin/intelligence/fraud/cases').set(auth(adminToken)).query({ level: 'HIGH', search: 'Cliente Inteligência' }).expect(200);
    const listed = list.body.data.find((item: { userId: string }) => item.userId === customer.userId);
    expect(listed).toMatchObject({ signals: 2, user: { id: customer.userId } });
    await ctx.http().get('/v1/admin/intelligence/fraud/cases').set(auth(company.token)).expect(403);

    const detail = await ctx.http().get(`/v1/admin/intelligence/fraud/cases/${listed.id}`).set(auth(adminToken)).expect(200);
    expect(detail.body.signals).toHaveLength(2);
    expect(detail.body.activity.orders.NEW).toBeGreaterThanOrEqual(1);

    await ctx.http().post(`/v1/admin/intelligence/fraud/cases/${listed.id}/review`).set(auth(adminToken)).expect(201);
    const dismissed = await ctx.http()
      .post(`/v1/admin/intelligence/fraud/cases/${listed.id}/dismiss`)
      .set(auth(adminToken))
      .send({ reason: 'Cliente confirmado por telefone; denúncia improcedente.', trustDays: 30 })
      .expect(201);
    expect(dismissed.body).toMatchObject({ status: 'DISMISSED', resolvedById: admin.id });
    expect(new Date(dismissed.body.profile.trustedUntil).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    await ctx.http().post(`/v1/admin/intelligence/fraud/cases/${listed.id}/confirm`).set(auth(adminToken)).send({ reason: 'Tentando confirmar de novo' }).expect(409);

    // Liberada pela equipe: dinheiro volta a ser aceito; sem a liberação, volta a exigir pagamento online.
    await order(customer);
    await ctx.http().post(`/v1/admin/intelligence/fraud/users/${customer.userId}/revoke-trust`).set(auth(adminToken)).expect(201);
    await order(customer, {}, 422);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'fraud.case.dismiss', entityId: listed.id } })).toBe(1);
  });

  it('pagamentos recusados em sequência viram sinal de risco', async () => {
    const customer = await newCustomer();
    for (let attempt = 0; attempt < 3; attempt++) {
      const declined = await order(customer, { paymentMethod: 'CREDIT_CARD', cardToken: 'tok_declined' });
      expect(declined.status).toBe('CANCELED');
      await ctx.prisma.cart.deleteMany({ where: { customerId: customer.customerId } });
    }
    const signal = await waitFor(() => ctx.prisma.riskSignal.findFirst({ where: { userId: customer.userId, type: 'PAYMENT_FAILURES' } }));
    expect(signal.message).toContain('3 pagamentos recusados');
  });

  it('GPS simulado e salto impossível viram sinais; entrega com localização simulada é recusada', async () => {
    await ctx.http().post('/v1/drivers/me/locations').set(auth(driver.token)).send({ points: [{ ...at(0.25), mocked: true }] }).expect(200);
    await waitFor(() => ctx.prisma.riskSignal.findFirst({ where: { userId: driver.userId, type: 'MOCK_LOCATION' } }));
    expect((await ctx.prisma.driver.findUniqueOrThrow({ where: { id: driver.driverId } })).lastLocationMocked).toBe(true);
    expect(await ctx.prisma.deliveryTrackingPoint.count({ where: { driverId: driver.driverId, mocked: true } })).toBe(0); // sem entrega ativa, pontos não são gravados

    // ~110 km em segundos.
    await ctx.http().post('/v1/drivers/me/location').set(auth(driver.token)).send({ lat: BASE.lat + 1, lng: BASE.lng }).expect(200);
    const jump = await waitFor(() => ctx.prisma.riskSignal.findFirst({ where: { userId: driver.userId, type: 'IMPOSSIBLE_SPEED' } }));
    expect((jump.details as { kmh: number }).kmh).toBeGreaterThan(1000);

    // Volta para perto da loja e faz uma entrega.
    await ctx.http().post('/v1/drivers/me/location').set(auth(driver.token)).send({ ...at(0.2) }).expect(200);
    const customer = await newCustomer();
    const placed = await order(customer);
    const base = `/v1/companies/${company.companyId}/orders/${placed.id}`;
    for (const step of ['confirm', 'prepare', 'ready']) await ctx.http().post(`${base}/${step}`).set(auth(company.token)).expect(201);
    const offer = await waitFor(async () => (await ctx.http().get('/v1/drivers/me/offers').set(auth(driver.token)).expect(200)).body[0] as { id: string } | undefined);
    await ctx.http().post(`/v1/drivers/me/offers/${offer.id}/accept`).set(auth(driver.token)).expect(200);
    const delivery = await ctx.prisma.delivery.findUniqueOrThrow({ where: { orderId: placed.id } });
    await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/picked-up`).set(auth(driver.token)).expect(204);
    await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/start-route`).set(auth(driver.token)).expect(204);

    await ctx.http().post('/v1/drivers/me/location').set(auth(driver.token)).send({ ...HOME, mocked: true }).expect(200);
    expect(await ctx.prisma.deliveryTrackingPoint.count({ where: { deliveryId: delivery.id, mocked: true } })).toBe(1);
    const rejected = await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/deliver`).set(auth(driver.token)).send({ method: 'CODE', code: placed.deliveryCode }).expect(409);
    expect(rejected.body.message).toContain('localização simulada');
    await waitFor(() => ctx.prisma.riskSignal.findFirst({ where: { userId: driver.userId, dedupeKey: `mock-proof:${delivery.id}` } }));

    await ctx.http().post('/v1/drivers/me/location').set(auth(driver.token)).send({ ...HOME }).expect(200);
    await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/deliver`).set(auth(driver.token)).send({ method: 'CODE', code: placed.deliveryCode }).expect(200);

    await waitFor(async () => (await ctx.prisma.order.findUnique({ where: { id: placed.id } }))?.status === 'DELIVERED');

    // O cliente avalia: sentimento e temas analisados na hora (léxico).
    await ctx.http()
      .post(`/v1/orders/${placed.id}/review`)
      .set(auth(customer.token))
      .send({ company: { rating: 2, comment: 'A pizza chegou fria e atrasou muito, embalagem amassada.' } })
      .expect(201);
    const review = await waitFor(() => ctx.prisma.review.findFirst({ where: { orderId: placed.id, subjectType: 'COMPANY', sentiment: { not: null } } }));
    expect(review).toMatchObject({ sentiment: 'NEGATIVE', analysisSource: 'lexicon' });
    expect(review.themes).toEqual(expect.arrayContaining(['temperature', 'delay', 'packaging']));

    const negative = await ctx.http().get('/v1/admin/reviews').set(auth(adminToken)).query({ sentiment: 'NEGATIVE', theme: 'temperature', pageSize: 100 }).expect(200);
    expect(negative.body.data.some((item: { id: string }) => item.id === review.id)).toBe(true);
    const summary = await ctx.http().get('/v1/admin/intelligence/reviews/summary').set(auth(adminToken)).query({ subjectType: 'COMPANY', subjectId: company.companyId }).expect(200);
    expect(summary.body).toMatchObject({ total: 1, negative: 1 });
    expect(summary.body.themes.find((theme: { theme: string }) => theme.theme === 'temperature')).toMatchObject({ total: 1, negative: 1 });
  });

  it('cancelamentos muito acima da média são apontados na varredura', async () => {
    const customer = await newCustomer();
    for (let index = 0; index < 5; index++) {
      const placed = await order(customer);
      await ctx.http().post(`/v1/orders/${placed.id}/cancel`).set(auth(customer.token)).send({ reason: 'Desisti do pedido' }).expect((response) => expect(response.status).toBeLessThan(300));
    }
    await ctx.http().post('/v1/admin/intelligence/fraud/scan').set(auth(adminToken)).expect(201);
    const signal = await waitFor(() => ctx.prisma.riskSignal.findFirst({ where: { userId: customer.userId, type: 'ABNORMAL_CANCELLATIONS' } }));
    expect(signal.message).toContain('Cancelou 5 de 5 pedidos');
  });

  // ---------------------------------------------------------------------------
  // Previsão, sugestões de preço e anomalias
  // ---------------------------------------------------------------------------

  it('prevê demanda e entregadores por cidade; a falta prevista vira sugestão que só vale com aprovação', async () => {
    const forecastCity = `Previsao ${Date.now()}`;
    const key = cityKey(forecastCity, 'SP');
    const base = { lat: -5 - Math.random() * 3, lng: -60 - Math.random() * 3 };
    const target = new Date(floorHour(new Date()).getTime() + 3 * HOUR);
    const history = [];
    const presence = [];
    for (let week = 1; week <= 6; week++) {
      const hour = new Date(target.getTime() - week * WEEK);
      for (let index = 0; index < 12; index++) history.push(syntheticDelivery(forecastCity, base, new Date(hour.getTime() + index * 60_000)));
      for (let bucket = 0; bucket < 12; bucket++) {
        presence.push({ tenantId: admin.tenantId, geohash: `t${randomBytes(4).toString('hex')}`, lat: base.lat, lng: base.lng, bucketStart: new Date(hour.getTime() + bucket * 5 * 60_000), onlineCount: 2, busyCount: 1 });
      }
    }
    await ctx.prisma.delivery.createMany({ data: history });
    await ctx.prisma.driverPresenceSample.createMany({ data: presence });

    await ctx.http().post('/v1/admin/intelligence/forecast/run').set(auth(adminToken)).expect(201);
    const view = await ctx.http().get('/v1/admin/intelligence/forecast').set(auth(adminToken)).query({ city: key }).expect(200);
    expect(view.body.city).toBe(key);
    const point = view.body.series.find((row: { hourStart: string }) => new Date(row.hourStart).getTime() === target.getTime());
    expect(point).toMatchObject({ predicted: 12, driversNeeded: 6, driversExpected: 2 });
    expect(point.low).toBeLessThan(12);
    await ctx.http().get('/v1/admin/intelligence/forecast').set(auth(company.token)).expect(403);

    const suggestions = await ctx.http().get('/v1/admin/intelligence/pricing/suggestions').set(auth(adminToken)).expect(200);
    const suggestion = suggestions.body.find((item: { city: string }) => item.city === key);
    expect(suggestion).toMatchObject({ status: 'PENDING', driversNeeded: 6, driversExpected: 2, surchargeBps: 3000 });
    expect(new Date(suggestion.windowStart).getTime()).toBe(target.getTime());

    await ctx.http().post(`/v1/admin/intelligence/pricing/suggestions/${suggestion.id}/apply`).set(auth(company.token)).send({}).expect(403);
    const applied = await ctx.http().post(`/v1/admin/intelligence/pricing/suggestions/${suggestion.id}/apply`).set(auth(adminToken)).send({ surchargeBps: 1500 }).expect(201);
    expect(applied.body).toMatchObject({ city: key, surchargeBps: 1500 });
    expect(await ctx.prisma.pricingSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } })).toMatchObject({ status: 'APPLIED', surchargeId: applied.body.id, decidedById: admin.id });
    await ctx.http().post(`/v1/admin/intelligence/pricing/suggestions/${suggestion.id}/apply`).set(auth(adminToken)).send({}).expect(409);

    // Rodar de novo não recria a sugestão já decidida (o período já tem adicional).
    await ctx.http().post('/v1/admin/intelligence/forecast/run').set(auth(adminToken)).expect(201);
    expect(await ctx.prisma.pricingSuggestion.count({ where: { tenantId: admin.tenantId, city: key, status: 'PENDING' } })).toBe(0);
  });

  it('adicional programado entra na cotação da cidade e sai ao ser cancelado', async () => {
    const customer = await newCustomer();
    const body = { pickup: { addressId: customer.addressId }, dropoff: { street: 'Rua Destino', number: '9', city: CITY, state: 'SP', ...at(2) }, itemCategory: 'DOCUMENT', weightKg: 0.2 };
    const before = await ctx.http().post('/v1/deliveries/quote').set(auth(customer.token)).send(body).expect(201);
    const created = await ctx.http()
      .post('/v1/admin/intelligence/pricing/surcharges')
      .set(auth(adminToken))
      .send({ city: CITY, state: 'SP', startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + HOUR).toISOString(), surchargeBps: 2000, reason: 'Show no estádio' })
      .expect(201);
    const during = await ctx.http().post('/v1/deliveries/quote').set(auth(customer.token)).send(body).expect(201);
    expect(during.body.breakdown.map((line: { label: string }) => line.label)).toContain('Adicional de alta demanda');
    expect(during.body.feeCents).toBeGreaterThan(before.body.feeCents);

    await ctx.http().post(`/v1/admin/intelligence/pricing/surcharges/${created.body.id}/cancel`).set(auth(adminToken)).expect(204);
    const after = await ctx.http().post('/v1/deliveries/quote').set(auth(customer.token)).send(body).expect(201);
    expect(after.body.feeCents).toBe(before.body.feeCents);
    await ctx.http().post('/v1/admin/intelligence/pricing/surcharges').set(auth(adminToken)).send({ startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + HOUR).toISOString(), surchargeBps: 99_000, reason: 'Acima do teto' }).expect(400);
  });

  it('queda brusca de volume vira anomalia crítica na torre e pode ser acompanhada e encerrada', async () => {
    const anomalyCity = cityKey(`Anomalia ${Date.now()}`, 'SP');
    const lastHour = new Date(floorHour(new Date()).getTime() - HOUR);
    await ctx.prisma.demandForecast.create({ data: { tenantId: admin.tenantId, city: anomalyCity, hourStart: lastHour, predicted: 30, low: 22, high: 38, driversNeeded: 15 } });

    await ctx.http().post('/v1/admin/intelligence/anomalies/scan').set(auth(adminToken)).expect(201);
    const list = await ctx.http().get('/v1/admin/intelligence/anomalies').set(auth(adminToken)).expect(200);
    const anomaly = list.body.find((item: { city: string | null }) => item.city === anomalyCity);
    expect(anomaly).toMatchObject({ kind: 'DEMAND_DROP', severity: 'CRITICAL', status: 'OPEN', observed: 0, expected: 30 });

    const snapshot = await ctx.http().get('/v1/admin/operations/snapshot').set(auth(adminToken)).expect(200);
    expect(snapshot.body.alerts.some((alert: { type: string; anomalyId?: string }) => alert.type === 'anomaly' && alert.anomalyId === anomaly.id)).toBe(true);

    // Rodar de novo não duplica.
    await ctx.http().post('/v1/admin/intelligence/anomalies/scan').set(auth(adminToken)).expect(201);
    expect(await ctx.prisma.opsAnomaly.count({ where: { tenantId: admin.tenantId, city: anomalyCity } })).toBe(1);

    await ctx.http().post(`/v1/admin/intelligence/anomalies/${anomaly.id}/acknowledge`).set(auth(adminToken)).expect(204);
    await ctx.http().post(`/v1/admin/intelligence/anomalies/${anomaly.id}/acknowledge`).set(auth(adminToken)).expect(409);
    await ctx.http().post(`/v1/admin/intelligence/anomalies/${anomaly.id}/resolve`).set(auth(adminToken)).expect(204);
    expect(await ctx.prisma.opsAnomaly.findUniqueOrThrow({ where: { id: anomaly.id } })).toMatchObject({ status: 'RESOLVED', acknowledgedById: admin.id });
  });

  it('tempo de entrega calibrado pelo histórico da cidade (fator de trajeto, esperas e erro médio)', async () => {
    const etaCity = `Calibracao ${Date.now()}`;
    const key = cityKey(etaCity, 'SP');
    const pickedUp = new Date(Date.now() - 2 * 86_400_000);
    const rows = Array.from({ length: 25 }, (_, index) => {
      const start = new Date(pickedUp.getTime() + index * 60_000);
      return syntheticDelivery(etaCity, { lat: -3, lng: -50 }, new Date(start.getTime() - 15 * 60_000), {
        searchStartedAt: new Date(start.getTime() - 12 * 60_000),
        assignedAt: new Date(start.getTime() - 8 * 60_000),
        pickedUpAt: start,
        deliveredAt: new Date(start.getTime() + 20 * 60_000),
      });
    });
    await ctx.prisma.delivery.createMany({ data: rows });

    const result = await ctx.http().post('/v1/admin/intelligence/eta/calibrate').set(auth(adminToken)).expect(201);
    expect(result.body.groups).toBeGreaterThan(0);
    const view = await ctx.http().get('/v1/admin/intelligence/eta').set(auth(adminToken)).expect(200);
    const group = view.body.groups.find((row: { city: string; vehicle: string }) => row.city === key && row.vehicle === 'MOTORCYCLE');
    expect(group).toMatchObject({ transitFactor: 2, pickupMinutes: 8, dispatchMinutes: 4, samples: 25, maeBeforeMin: 10, maeAfterMin: 0 });

    const calibration = ctx.app.get(EtaService).calibration({ tenantId: admin.tenantId, city: etaCity, state: 'SP', vehicleType: 'MOTORCYCLE', at: pickedUp });
    expect(calibration).toMatchObject({ transitFactor: 2, pickupMinutes: 8, dispatchMinutes: 4 });
  });

  // ---------------------------------------------------------------------------
  // IA assistiva (sempre com revisão humana)
  // ---------------------------------------------------------------------------

  it('rascunho de resposta do atendimento: modelo de texto sem IA; com IA registra uso, respeita limite e nunca envia', async () => {
    const customer = await newCustomer({ name: 'Joana Teste' });
    const ticket = await ctx.http()
      .post('/v1/support/tickets')
      .set(auth(customer.token))
      .send({ as: 'CUSTOMER', category: 'DELIVERY', subject: 'Entrega atrasada', description: 'Minha entrega está atrasada. Meu telefone é (11) 98888-7777.' })
      .expect(201);
    const messagesBefore = await ctx.prisma.ticketMessage.count({ where: { ticketId: ticket.body.id } });

    const template = await ctx.http().post(`/v1/admin/intelligence/support/${ticket.body.id}/draft`).set(auth(adminToken)).expect(201);
    expect(template.body).toMatchObject({ source: 'template' });
    expect(template.body.reply).toContain('Joana');
    await ctx.http().post(`/v1/admin/intelligence/support/${ticket.body.id}/draft`).set(auth(customer.token)).expect(403);

    const ai = ctx.app.get(AiService);
    const settings = ctx.app.get(SettingsService);
    const original = ai.provider;
    const originalConfig = await settings.get(admin.tenantId, 'ai');
    let prompt = '';
    const stub = {
      name: 'anthropic',
      model: 'claude-opus-5',
      available: true,
      structured: async (request: { prompt: string }) => {
        prompt = request.prompt;
        return {
          status: 'OK',
          value: { reply: 'Olá, Joana! Já acionamos a operação.', summary: 'Entrega atrasada.', suggestedCategory: null, suggestedPriority: 'HIGH', staffActions: ['Verificar a entrega'], confidence: 'medium' },
          usage: { model: 'claude-opus-5', inputTokens: 900, outputTokens: 120 },
        };
      },
      converse: async () => ({ status: 'OK', value: { text: 'Seu dia mais movimentado é sexta.', tools: ['resumo_vendas'] }, usage: { model: 'claude-opus-5', inputTokens: 1500, outputTokens: 80 } }),
    } as unknown as AiProvider;
    Object.assign(ai, { provider: stub });
    try {
      const drafted = await ctx.http().post(`/v1/admin/intelligence/support/${ticket.body.id}/draft`).set(auth(adminToken)).expect(201);
      expect(drafted.body).toMatchObject({ source: 'ai', reply: 'Olá, Joana! Já acionamos a operação.', suggestedPriority: 'HIGH' });
      // Dados pessoais não vão para o modelo.
      expect(prompt).not.toContain('98888');
      expect(prompt).toContain('[telefone]');
      const interaction = await ctx.prisma.aiInteraction.findFirstOrThrow({ where: { userId: admin.id, feature: 'SUPPORT_DRAFT' }, orderBy: { createdAt: 'desc' } });
      expect(interaction).toMatchObject({ status: 'OK', inputTokens: 900, outputTokens: 120, model: 'claude-opus-5' });
      expect(await ctx.prisma.ticketMessage.count({ where: { ticketId: ticket.body.id } })).toBe(messagesBefore);

      // Recusa do modelo: volta para o modelo de texto.
      Object.assign(stub, { structured: async () => ({ status: 'REFUSED' }) });
      const refused = await ctx.http().post(`/v1/admin/intelligence/support/${ticket.body.id}/draft`).set(auth(adminToken)).expect(201);
      expect(refused.body.source).toBe('template');

      // Limite diário por pessoa.
      const used = await ctx.prisma.aiInteraction.count({ where: { userId: admin.id, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
      await settings.set(admin.tenantId, 'ai', { ...originalConfig, dailyLimitPerUser: used }, admin.id);
      await ctx.http().post(`/v1/admin/intelligence/support/${ticket.body.id}/draft`).set(auth(adminToken)).expect(429);
      // Recurso desligado: modelo de texto, sem consumir o limite.
      await settings.set(admin.tenantId, 'ai', { ...originalConfig, supportDrafts: false, dailyLimitPerUser: used }, admin.id);
      expect((await ctx.http().post(`/v1/admin/intelligence/support/${ticket.body.id}/draft`).set(auth(adminToken)).expect(201)).body.source).toBe('template');

      // Assistente da loja com IA (ferramentas somente leitura da própria loja).
      await settings.set(admin.tenantId, 'ai', originalConfig, admin.id);
      const answer = await ctx.http()
        .post(`/v1/companies/${company.companyId}/assistant/ask`)
        .set(auth(company.token))
        .send({ messages: [{ role: 'user', content: 'Qual o meu dia mais movimentado?' }] })
        .expect(200);
      expect(answer.body).toMatchObject({ available: true, answer: 'Seu dia mais movimentado é sexta.', sources: ['resumo_vendas'] });
      expect(await ctx.prisma.aiInteraction.count({ where: { companyId: company.companyId, feature: 'COMPANY_ASSISTANT', status: 'OK' } })).toBe(1);
    } finally {
      Object.assign(ai, { provider: original });
      await settings.set(admin.tenantId, 'ai', originalConfig, admin.id);
    }

    const status = await ctx.http().get('/v1/admin/intelligence/ai').set(auth(adminToken)).expect(200);
    expect(status.body).toMatchObject({ provider: 'none', available: false });
    expect(status.body.usage.some((row: { feature: string; calls: number }) => row.feature === 'SUPPORT_DRAFT' && row.calls >= 1)).toBe(true);
  });

  it('assistente da empresa: indicadores, previsão de 7 dias e recomendações; perguntas exigem IA', async () => {
    // Mais duas reclamações de temperatura: o tema passa a gerar recomendação.
    for (const comment of ['Veio frio de novo', 'Comida gelada, decepcionante']) {
      await ctx.prisma.review.create({
        data: { tenantId: admin.tenantId, authorUserId: randomUUID(), authorType: 'CUSTOMER', subjectType: 'COMPANY', subjectId: company.companyId, rating: 2, comment, sentiment: 'NEGATIVE', themes: ['temperature'], analyzedAt: new Date(), analysisSource: 'lexicon' },
      });
    }
    const insights = await ctx.http().get(`/v1/companies/${company.companyId}/assistant`).set(auth(company.token)).expect(200);
    expect(insights.body.sales.orders).toBeGreaterThanOrEqual(5);
    expect(insights.body.forecast.series).toHaveLength(7);
    expect(insights.body.topProducts[0]).toMatchObject({ name: 'Pizza' });
    expect(insights.body.reviews).toMatchObject({ negative: 3 });
    expect(insights.body.recommendations.find((item: { id: string }) => item.id === 'review-theme')).toMatchObject({ tone: 'warning', title: expect.stringContaining('temperatura') });
    expect(insights.body.assistant.available).toBe(false);

    const outsider = await newCustomer();
    await ctx.http().get(`/v1/companies/${company.companyId}/assistant`).set(auth(outsider.token)).expect(403);
    const ask = await ctx.http().post(`/v1/companies/${company.companyId}/assistant/ask`).set(auth(company.token)).send({ messages: [{ role: 'user', content: 'Como vendi esta semana?' }] }).expect(200);
    expect(ask.body).toMatchObject({ available: false, answer: null });
    await ctx.http().post(`/v1/companies/${company.companyId}/assistant/ask`).set(auth(company.token)).send({ messages: [] }).expect(400);
  });
});
