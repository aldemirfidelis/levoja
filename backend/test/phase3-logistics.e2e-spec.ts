import { ADMIN, createTestApp, login, SAMPLE_PNG, TestContext, uniqueIdentity } from './utils';
import { DispatchService } from '../src/modules/logistics/dispatch.service';

/**
 * Fase 3 — Logística: despacho com ofertas, aceite/recusa, rastreamento, geofence,
 * prova de entrega, entregas avulsas e agendadas, falhas, avaliações e operação.
 */
describe('Fase 3 — Logística (E2E)', () => {
  let ctx: TestContext;
  let adminToken: string;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  // Área geográfica exclusiva desta execução (evita interferência de entregadores de outras execuções).
  const BASE = { lat: -10 - Math.random() * 15, lng: -40 - Math.random() * 15 };
  const at = (dLatKm: number, dLngKm = 0) => ({ lat: BASE.lat + dLatKm / 111, lng: BASE.lng + dLngKm / 111 });
  const STORE = at(0);
  const CUSTOMER_HOME = at(1.5, 1.0); // ~1,8 km da loja
  const FAR_AWAY = at(40);

  let company: { token: string; companyId: string };
  let customer: { token: string; userId: string; addressId: string };
  let productId: string;
  const drivers: Record<string, { token: string; driverId: string; userId: string }> = {};

  async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 15_000): Promise<T> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = await check();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('Tempo esgotado aguardando condição');
  }

  async function createDriver(name: string, vehicleType: 'MOTORCYCLE' | 'CAR', position: { lat: number; lng: number }) {
    const id = uniqueIdentity();
    const response = await ctx.http()
      .post('/v1/auth/register/driver')
      .send({
        name,
        email: id.email,
        phone: id.phone,
        password: 'SenhaForte123',
        cpf: id.cpf,
        birthDate: '1992-04-10',
        vehicleType,
        acceptTerms: true,
        acceptPrivacy: true,
        acceptDriverTerms: true,
        acceptLocationTracking: true,
      })
      .expect(201);
    const driver = await ctx.prisma.driver.findUniqueOrThrow({ where: { userId: response.body.user.id } });
    // Aprovação coberta na Fase 1: aqui aprovamos diretamente.
    await ctx.prisma.driver.update({ where: { id: driver.id }, data: { status: 'APPROVED', approvedAt: new Date() } });
    await ctx.prisma.vehicle.update({ where: { id: driver.activeVehicleId! }, data: { status: 'APPROVED', plate: 'ABC1D23' } });
    const token = response.body.accessToken as string;
    await ctx.http().post('/v1/drivers/me/availability').set(auth(token)).send({ online: true, ...position }).expect(200);
    return { token, driverId: driver.id, userId: response.body.user.id as string };
  }

  async function placeOrder() {
    await ctx.http().post('/v1/cart/items').set(auth(customer.token)).send({ productId, quantity: 2 }).expect(201);
    const order = await ctx.http()
      .post('/v1/orders')
      .set(auth(customer.token))
      .send({ companyId: company.companyId, addressId: customer.addressId, paymentMethod: 'CASH', tipCents: 500 })
      .expect(201);
    return order.body as { id: string; number: number; deliveryCode: string };
  }

  async function advanceToReady(orderId: string) {
    const base = `/v1/companies/${company.companyId}/orders/${orderId}`;
    for (const step of ['confirm', 'prepare', 'ready']) await ctx.http().post(`${base}/${step}`).set(auth(company.token)).expect(201);
  }

  const pendingOffers = async (driver: { token: string }) => (await ctx.http().get('/v1/drivers/me/offers').set(auth(driver.token)).expect(200)).body as { id: string; secondsLeft: number; pickupArea: string; payoutCents: number }[];
  const deliveryOf = (orderId: string) => ctx.prisma.delivery.findUnique({ where: { orderId } });

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await login(ctx, ADMIN, 'ADMIN');

    // Empresa aprovada, aberta, com endereço e produto
    const segments = await ctx.http().get('/v1/segments').expect(200);
    const owner = uniqueIdentity();
    const companyIdentity = uniqueIdentity();
    const registered = await ctx.http()
      .post('/v1/auth/register/company')
      .send({
        name: 'Dono Logística',
        email: owner.email,
        phone: owner.phone,
        password: 'SenhaForte123',
        cpf: owner.cpf,
        acceptTerms: true,
        acceptPrivacy: true,
        acceptCompanyTerms: true,
        company: {
          legalName: 'Logística Teste LTDA',
          tradeName: `Loja Logística ${Date.now()}`,
          cnpj: companyIdentity.cnpj,
          segmentId: segments.body.find((s: { slug: string }) => s.slug === 'restaurantes').id,
          email: companyIdentity.email,
          phone: '(11) 3333-4444',
          responsibleName: 'Dono Logística',
          responsibleCpf: owner.cpf,
        },
      })
      .expect(201);
    company = { token: registered.body.accessToken, companyId: registered.body.companyId };
    await ctx.http()
      .put(`/v1/companies/${company.companyId}/address`)
      .set(auth(company.token))
      .send({ zipCode: '01310100', street: 'Rua da Loja', number: '10', district: 'Centro', city: 'Cidade Teste', state: 'SP', ...STORE })
      .expect(200);
    await ctx.http()
      .put(`/v1/companies/${company.companyId}/opening-hours`)
      .set(auth(company.token))
      .send({ hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: '00:00', closesAt: '23:59' })) })
      .expect(200);
    await ctx.prisma.company.update({ where: { id: company.companyId }, data: { status: 'APPROVED', isOpen: true } });
    productId = (await ctx.http().post(`/v1/companies/${company.companyId}/products`).set(auth(company.token)).send({ name: 'Marmita', priceCents: 2500, weightGrams: 600 }).expect(201)).body.id;

    const id = uniqueIdentity();
    const cust = await ctx.http()
      .post('/v1/auth/register/customer')
      .send({ name: 'Cliente Logística', email: id.email, phone: id.phone, password: 'SenhaForte123', acceptTerms: true, acceptPrivacy: true })
      .expect(201);
    const address = await ctx.http()
      .post('/v1/me/addresses')
      .set(auth(cust.body.accessToken))
      .send({ zipCode: '01310200', street: 'Rua do Cliente', number: '99', district: 'Jardim', city: 'Cidade Teste', state: 'SP', ...CUSTOMER_HOME })
      .expect(201);
    customer = { token: cust.body.accessToken, userId: cust.body.user.id, addressId: address.body.id };

    drivers.near = await createDriver('Entregador Perto', 'MOTORCYCLE', at(0.3));
    drivers.mid = await createDriver('Entregador Médio', 'MOTORCYCLE', at(0.8));
  });

  afterAll(async () => {
    // Deixa os entregadores desta execução offline.
    await ctx.prisma.driver.updateMany({ where: { id: { in: Object.values(drivers).map((d) => d.driverId) } }, data: { availability: 'OFFLINE' } });
    await ctx.app.close();
  });

  it('entregador não aprovado não fica online', async () => {
    const id = uniqueIdentity();
    const response = await ctx.http()
      .post('/v1/auth/register/driver')
      .send({ name: 'Pendente', email: id.email, phone: id.phone, password: 'SenhaForte123', cpf: id.cpf, birthDate: '1990-01-01', vehicleType: 'MOTORCYCLE', acceptTerms: true, acceptPrivacy: true, acceptDriverTerms: true, acceptLocationTracking: true })
      .expect(201);
    const denied = await ctx.http().post('/v1/drivers/me/availability').set(auth(response.body.accessToken)).send({ online: true, ...at(0.1) }).expect(403);
    expect(denied.body.message).toContain('aprovado');
  });

  it('fluxo completo do pedido: despacho, recusa, aceite, geofence, prova de entrega e avaliação', async () => {
    const order = await placeOrder();
    await advanceToReady(order.id);

    // Oferta vai primeiro para o entregador mais próximo, com contador e local aproximado
    const first = await waitFor(async () => (await pendingOffers(drivers.near))[0]);
    expect(first.secondsLeft).toBeGreaterThan(0);
    expect(first.pickupArea).toBe('Centro, Cidade Teste');
    expect(first.payoutCents).toBeGreaterThan(500); // repasse + gorjeta
    expect(await pendingOffers(drivers.mid)).toHaveLength(0);

    // Recusa → próximo candidato
    await ctx.http().post(`/v1/drivers/me/offers/${first.id}/decline`).set(auth(drivers.near.token)).send({ reason: 'Longe' }).expect(204);
    const second = await waitFor(async () => (await pendingOffers(drivers.mid))[0]);

    // Aceite: pedido passa para "entregador a caminho"
    const accepted = await ctx.http().post(`/v1/drivers/me/offers/${second.id}/accept`).set(auth(drivers.mid.token)).expect(200);
    expect(accepted.body.status).toBe('DRIVER_ASSIGNED');
    expect(accepted.body.dropoff.phone).toMatch(/\*{5}/);
    await ctx.http().post(`/v1/drivers/me/offers/${first.id}/accept`).set(auth(drivers.near.token)).expect(409);
    await waitFor(async () => (await ctx.prisma.order.findUnique({ where: { id: order.id } }))?.status === 'DRIVER_ASSIGNED');

    // Não pode ficar offline com entrega ativa
    await ctx.http().post('/v1/drivers/me/availability').set(auth(drivers.mid.token)).send({ online: false }).expect(409);

    // Geofence: posição próxima da coleta marca "no local de coleta"
    const delivery = (await deliveryOf(order.id))!;
    await ctx.http().post('/v1/drivers/me/location').set(auth(drivers.mid.token)).send({ ...at(0.05), speed: 5 }).expect(200);
    await waitFor(async () => (await ctx.prisma.delivery.findUnique({ where: { id: delivery.id } }))?.status === 'AT_PICKUP');

    const route = await ctx.http().get('/v1/drivers/me/route').set(auth(drivers.mid.token)).expect(200);
    expect(route.body.stops.map((stop: { type: string }) => stop.type)).toEqual(['PICKUP', 'DROPOFF']);

    await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/picked-up`).set(auth(drivers.mid.token)).expect(204);
    await waitFor(async () => (await ctx.prisma.order.findUnique({ where: { id: order.id } }))?.status === 'PICKED_UP');
    await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/start-route`).set(auth(drivers.mid.token)).expect(204);

    // Longe do destino a entrega não pode ser concluída (antifraude)
    const tooFar = await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/deliver`).set(auth(drivers.mid.token)).send({ method: 'CODE', code: order.deliveryCode }).expect(409);
    expect(tooFar.body.message).toContain('do destino');

    // Sincronização offline: vários pontos de uma vez, até o destino
    const points = [at(0.5, 0.3), at(1.0, 0.7), { ...CUSTOMER_HOME }].map((point, index) => ({ ...point, recordedAt: new Date(Date.now() - (3 - index) * 5_000).toISOString() }));
    const synced = await ctx.http().post('/v1/drivers/me/locations').set(auth(drivers.mid.token)).send({ points }).expect(200);
    expect(synced.body).toEqual({ accepted: 3, tracking: true });
    await waitFor(async () => (await ctx.prisma.delivery.findUnique({ where: { id: delivery.id } }))?.status === 'AT_DROPOFF');

    // Cliente acompanha: posição do entregador e código visíveis para ele
    const tracked = await ctx.http().get(`/v1/orders/${order.id}`).set(auth(customer.token)).expect(200);
    expect(tracked.body.status).toBe('IN_TRANSIT');

    const wrong = order.deliveryCode === '0000' ? '1111' : '0000';
    await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/deliver`).set(auth(drivers.mid.token)).send({ method: 'CODE', code: wrong }).expect(400);
    const done = await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/deliver`).set(auth(drivers.mid.token)).send({ method: 'CODE', code: order.deliveryCode }).expect(200);
    expect(done.body.status).toBe('DELIVERED');
    await waitFor(async () => (await ctx.prisma.order.findUnique({ where: { id: order.id } }))?.status === 'DELIVERED');

    // Histórico da rota e proporção de dados gravados
    const trackingPoints = await ctx.prisma.deliveryTrackingPoint.count({ where: { deliveryId: delivery.id } });
    expect(trackingPoints).toBeGreaterThanOrEqual(4);
    const proof = await ctx.prisma.deliveryProof.findFirstOrThrow({ where: { deliveryId: delivery.id } });
    expect(proof).toMatchObject({ method: 'CODE', codeVerified: true });

    // Painel do entregador
    const dashboard = await waitFor(async () => {
      const response = await ctx.http().get('/v1/drivers/me/dashboard').set(auth(drivers.mid.token)).expect(200);
      return response.body.completedDeliveries === 1 && response.body.availability === 'ONLINE' ? response.body : null;
    });
    expect(dashboard.earnings.today.cents).toBeGreaterThan(0);
    expect(dashboard.acceptanceRate).toBe(100);

    // Avaliações: cliente avalia loja e entregador; entregador avalia cliente
    await ctx.http()
      .post(`/v1/orders/${order.id}/review`)
      .set(auth(customer.token))
      .send({ company: { rating: 5, comment: 'Muito bom' }, driver: { rating: 4, tags: ['rápido'] } })
      .expect(201);
    await ctx.http().post(`/v1/orders/${order.id}/review`).set(auth(customer.token)).send({ company: { rating: 1 } }).expect(409);
    await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/review`).set(auth(drivers.mid.token)).send({ customer: { rating: 5 } }).expect(201);
    const companyRow = await ctx.prisma.company.findUniqueOrThrow({ where: { id: company.companyId } });
    expect(companyRow).toMatchObject({ ratingAvg: 5, ratingCount: 1 });
    const driverRow = await ctx.prisma.driver.findUniqueOrThrow({ where: { id: drivers.mid.driverId } });
    expect(driverRow).toMatchObject({ ratingAvg: 4, ratingCount: 1 });
    const publicReviews = await ctx.http().get(`/v1/stores/${company.companyId}/reviews`).expect(200);
    expect(publicReviews.body.data[0]).toMatchObject({ rating: 5, comment: 'Muito bom' });
  });

  it('oferta expirada passa para o próximo entregador', async () => {
    const order = await placeOrder();
    await advanceToReady(order.id);
    const offer = await waitFor(async () => (await pendingOffers(drivers.near))[0] ?? (await pendingOffers(drivers.mid))[0]);
    const owner = (await pendingOffers(drivers.near)).some((o) => o.id === offer.id) ? drivers.near : drivers.mid;
    const other = owner === drivers.near ? drivers.mid : drivers.near;
    await ctx.prisma.deliveryOffer.update({ where: { id: offer.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await ctx.app.get(DispatchService).expireOffer(offer.id);
    expect((await ctx.prisma.deliveryOffer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe('EXPIRED');
    const next = await waitFor(async () => (await pendingOffers(other))[0]);
    await ctx.http().post(`/v1/drivers/me/offers/${next.id}/accept`).set(auth(other.token)).expect(200);

    // Desistência antes da coleta: volta para a fila e o pedido volta a "pronto"
    const delivery = (await deliveryOf(order.id))!;
    await waitFor(async () => (await ctx.prisma.order.findUnique({ where: { id: order.id } }))?.status === 'DRIVER_ASSIGNED');
    await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/release`).set(auth(other.token)).send({ reason: 'Pneu furado' }).expect(204);
    await waitFor(async () => (await ctx.prisma.order.findUnique({ where: { id: order.id } }))?.status === 'READY_FOR_PICKUP');
    expect((await ctx.prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe('SEARCHING_DRIVER');

    // Loja cancela o pedido: entrega e ofertas pendentes são canceladas
    await ctx.http().post(`/v1/companies/${company.companyId}/orders/${order.id}/cancel`).set(auth(company.token)).send({ reason: 'Cliente desistiu' }).expect(201);
    await waitFor(async () => (await ctx.prisma.delivery.findUnique({ where: { id: delivery.id } }))?.status === 'CANCELED');
    expect(await ctx.prisma.deliveryOffer.count({ where: { deliveryId: delivery.id, status: 'PENDING' } })).toBe(0);
  });

  it('falha na entrega após a coleta cancela o pedido com o motivo', async () => {
    const order = await placeOrder();
    await advanceToReady(order.id);
    const [offer, driver] = await waitFor(async () => {
      const near = (await pendingOffers(drivers.near))[0];
      if (near) return [near, drivers.near] as const;
      const mid = (await pendingOffers(drivers.mid))[0];
      return mid ? ([mid, drivers.mid] as const) : null;
    });
    await ctx.http().post(`/v1/drivers/me/offers/${offer.id}/accept`).set(auth(driver.token)).expect(200);
    const delivery = (await deliveryOf(order.id))!;
    await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/picked-up`).set(auth(driver.token)).expect(204);
    await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/fail`).set(auth(driver.token)).send({ reasonCode: 'RECIPIENT_ABSENT', details: '3 tentativas' }).expect(204);
    const canceled = await waitFor(async () => {
      const row = await ctx.prisma.order.findUnique({ where: { id: order.id } });
      return row?.status === 'CANCELED' ? row : null;
    });
    expect(canceled.cancelReason).toContain('Destinatário ausente');
  });

  it('entrega avulsa de documento com assinatura, rastreio público e carga que exige carro', async () => {
    const quote = await ctx.http()
      .post('/v1/deliveries/quote')
      .set(auth(customer.token))
      .send({ pickup: { addressId: customer.addressId }, dropoff: { street: 'Rua Destino', number: '5', city: 'Cidade Teste', state: 'SP', ...at(0.4) }, itemCategory: 'DOCUMENT', weightKg: 0.2 })
      .expect(201);
    expect(quote.body).toMatchObject({ vehicleType: 'MOTORCYCLE' });
    expect(quote.body.feeCents).toBeGreaterThanOrEqual(599);

    // Carga pesada exige carro e não pode ser rebaixada para moto
    const heavy = await ctx.http()
      .post('/v1/deliveries/quote')
      .set(auth(customer.token))
      .send({ pickup: { addressId: customer.addressId }, dropoff: { street: 'Rua X', number: '1', city: 'Cidade Teste', state: 'SP', ...at(0.4) }, itemCategory: 'PACKAGE', weightKg: 60 })
      .expect(201);
    expect(heavy.body.vehicleType).toBe('CAR');
    await ctx.http()
      .post('/v1/deliveries/quote')
      .set(auth(customer.token))
      .send({ pickup: { addressId: customer.addressId }, dropoff: { street: 'Rua X', number: '1', city: 'Cidade Teste', state: 'SP', ...at(0.4) }, itemCategory: 'PACKAGE', weightKg: 60, vehicleType: 'MOTORCYCLE' })
      .expect(400);

    const created = await ctx.http()
      .post('/v1/deliveries')
      .set(auth(customer.token))
      .send({
        pickup: { addressId: customer.addressId, contactName: 'Eu mesmo' },
        dropoff: { street: 'Rua Destino', number: '5', city: 'Cidade Teste', state: 'SP', contactName: 'Maria', ...at(0.4) },
        itemCategory: 'DOCUMENT',
        itemDescription: 'Contrato assinado',
        weightKg: 0.2,
        paymentMethod: 'CASH',
      })
      .expect(201);
    expect(created.body).toMatchObject({ kind: 'ON_DEMAND', proofMethod: 'SIGNATURE' });
    expect(created.body.qrCodePayload).toContain(created.body.code);

    // Rastreio público não expõe dados pessoais
    const publicView = await ctx.http().get(`/v1/track/${created.body.code}`).expect(200);
    expect(publicView.body).not.toHaveProperty('dropoffCode');
    expect(JSON.stringify(publicView.body)).not.toContain('Maria');

    const [offer, driver] = await waitFor(async () => {
      const near = (await pendingOffers(drivers.near))[0];
      if (near) return [near, drivers.near] as const;
      const mid = (await pendingOffers(drivers.mid))[0];
      return mid ? ([mid, drivers.mid] as const) : null;
    });
    await ctx.http().post(`/v1/drivers/me/offers/${offer.id}/accept`).set(auth(driver.token)).expect(200);
    const id = created.body.id;
    await ctx.http().post(`/v1/drivers/me/deliveries/${id}/picked-up`).set(auth(driver.token)).expect(204);
    await ctx.http().post('/v1/drivers/me/location').set(auth(driver.token)).send(at(0.4)).expect(200);
    await ctx.http().post(`/v1/drivers/me/deliveries/${id}/deliver`).set(auth(driver.token)).field('method', 'SIGNATURE').expect(400);
    const done = await ctx.http()
      .post(`/v1/drivers/me/deliveries/${id}/deliver`)
      .set(auth(driver.token))
      .field('method', 'SIGNATURE')
      .field('recipientName', 'Maria Souza')
      .attach('file', SAMPLE_PNG, 'assinatura.png')
      .expect(200);
    expect(done.body.status).toBe('DELIVERED');
    const requesterView = await ctx.http().get(`/v1/deliveries/${id}`).set(auth(customer.token)).expect(200);
    expect(requesterView.body.proofs[0]).toMatchObject({ method: 'SIGNATURE', recipientName: 'Maria Souza', hasFile: true });
    await ctx.http().post(`/v1/deliveries/${id}/review`).set(auth(customer.token)).send({ rating: 5 }).expect(201);
  });

  it('entregas agendadas respeitam a capacidade por janela', async () => {
    await ctx.http().put('/v1/admin/settings/dispatch.scheduling').set(auth(adminToken)).send({ value: { leadMinutes: 20, slotCapacity: 1 } }).expect(200);
    // Janela distante e única para esta execução
    const slot = new Date(Math.ceil((Date.now() + (3 + Math.floor(Math.random() * 48)) * 3_600_000) / 1_800_000) * 1_800_000 + 60_000);
    const body = {
      pickup: { addressId: customer.addressId },
      dropoff: { street: 'Rua Agendada', number: '1', city: 'Cidade Teste', state: 'SP', ...at(0.6) },
      itemCategory: 'PACKAGE',
      paymentMethod: 'CASH',
      scheduledFor: slot.toISOString(),
    };
    const first = await ctx.http().post('/v1/deliveries').set(auth(customer.token)).send(body).expect(201);
    expect(first.body.status).toBe('SCHEDULED');
    const full = await ctx.http().post('/v1/deliveries').set(auth(customer.token)).send(body).expect(409);
    expect(full.body.message).toContain('Horário esgotado');
    await ctx.http().post(`/v1/deliveries/${first.body.id}/cancel`).set(auth(customer.token)).send({ reason: 'Mudança de planos' }).expect(201);
    await ctx.http().put('/v1/admin/settings/dispatch.scheduling').set(auth(adminToken)).send({ value: { leadMinutes: 20, slotCapacity: 30 } }).expect(200);
  });

  it('operação: lista, atribuição manual e entregadores online', async () => {
    const created = await ctx.http()
      .post(`/v1/companies/${company.companyId}/deliveries`)
      .set(auth(company.token))
      .send({ dropoff: { street: 'Rua Cliente B2B', number: '7', city: 'Cidade Teste', state: 'SP', ...at(1) }, itemCategory: 'PACKAGE', paymentMethod: 'INVOICE' })
      .expect(201);
    expect(created.body.pickup.street).toBe('Rua da Loja');

    const online = await ctx.http().get('/v1/admin/drivers-online').set(auth(adminToken)).expect(200);
    expect(online.body.some((driver: { id: string }) => driver.id === drivers.near.driverId)).toBe(true);

    await waitFor(async () => (await ctx.prisma.delivery.findUnique({ where: { id: created.body.id } }))?.status === 'SEARCHING_DRIVER');
    const assigned = await ctx.http().post(`/v1/admin/deliveries/${created.body.id}/assign`).set(auth(adminToken)).send({ driverId: drivers.near.driverId }).expect(201);
    expect(assigned.body).toMatchObject({ status: 'DRIVER_ASSIGNED' });
    expect(assigned.body.timeline.at(-1)).toMatchObject({ status: 'DRIVER_ASSIGNED', actorType: 'PLATFORM' });

    const list = await ctx.http().get(`/v1/admin/deliveries?companyId=${company.companyId}`).set(auth(adminToken)).expect(200);
    expect(list.body.meta.total).toBeGreaterThanOrEqual(4);
    const detail = await ctx.http().get(`/v1/admin/deliveries/${created.body.id}`).set(auth(adminToken)).expect(200);
    expect(detail.body).toHaveProperty('offers');

    await ctx.http().post(`/v1/admin/deliveries/${created.body.id}/cancel`).set(auth(adminToken)).send({ reason: 'Teste de operação' }).expect(201);
  });

  it('não oferece entregas fora do raio máximo', async () => {
    const created = await ctx.http()
      .post('/v1/deliveries')
      .set(auth(customer.token))
      .send({ pickup: { street: 'Longe', number: '1', city: 'Outra', state: 'SP', ...FAR_AWAY }, dropoff: { street: 'Longe 2', number: '2', city: 'Outra', state: 'SP', ...at(41) }, itemCategory: 'PACKAGE', paymentMethod: 'CASH' })
      .expect(201);
    await waitFor(async () => (await ctx.prisma.delivery.findUnique({ where: { id: created.body.id } }))?.dispatchAttempts);
    expect(await ctx.prisma.deliveryOffer.count({ where: { deliveryId: created.body.id } })).toBe(0);
    await ctx.http().post(`/v1/deliveries/${created.body.id}/cancel`).set(auth(customer.token)).send({ reason: 'Teste' }).expect(201);
  });
});
