import { generateTotp } from '../src/infra/crypto/totp';
import { PushProvider } from '../src/modules/notifications/providers';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { createTestApp, TestContext, uniqueIdentity } from './utils';

/**
 * Fase 5 — Contratos da API usados pelos aplicativos: push segmentado por app, login com MFA no app,
 * detalhe da entrega do entregador, avaliações já feitas, tokenização de cartão e avisos ao entregador.
 */
describe('Fase 5 — API dos aplicativos (E2E)', () => {
  let ctx: TestContext;
  let push: PushProvider;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const BASE = { lat: -10 - Math.random() * 15, lng: -40 - Math.random() * 15 };
  const at = (dLatKm: number, dLngKm = 0) => ({ lat: BASE.lat + dLatKm / 111, lng: BASE.lng + dLngKm / 111 });

  async function waitFor<T>(check: () => Promise<T | null | undefined | false> | T | null | undefined | false, timeoutMs = 15_000): Promise<T> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = await check();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('Tempo esgotado aguardando condição');
  }

  async function newDriver(position: { lat: number; lng: number }) {
    const id = uniqueIdentity();
    const response = await ctx.http()
      .post('/v1/auth/register/driver')
      .send({ name: 'Entregador App', email: id.email, phone: id.phone, password: 'SenhaForte123', cpf: id.cpf, birthDate: '1991-02-03', vehicleType: 'MOTORCYCLE', acceptTerms: true, acceptPrivacy: true, acceptDriverTerms: true, acceptLocationTracking: true })
      .expect(201);
    const driver = await ctx.prisma.driver.findUniqueOrThrow({ where: { userId: response.body.user.id } });
    await ctx.prisma.driver.update({ where: { id: driver.id }, data: { status: 'APPROVED', approvedAt: new Date() } });
    await ctx.prisma.vehicle.update({ where: { id: driver.activeVehicleId! }, data: { status: 'APPROVED', plate: 'APP1A23' } });
    const token = response.body.accessToken as string;
    await ctx.http().post('/v1/drivers/me/availability').set(auth(token)).send({ online: true, ...position }).expect(200);
    return { token, driverId: driver.id, userId: response.body.user.id as string };
  }

  async function newCustomer() {
    const id = uniqueIdentity();
    const response = await ctx.http()
      .post('/v1/auth/register/customer')
      .send({ name: 'Cliente App', email: id.email, phone: id.phone, password: 'SenhaForte123', acceptTerms: true, acceptPrivacy: true })
      .expect(201);
    const address = await ctx.http()
      .post('/v1/me/addresses')
      .set(auth(response.body.accessToken))
      .send({ zipCode: '01310200', street: 'Rua do App', number: '10', district: 'Centro', city: 'Cidade App', state: 'SP', ...at(0.5) })
      .expect(201);
    return { token: response.body.accessToken as string, userId: response.body.user.id as string, addressId: address.body.id as string, email: id.email };
  }

  const sentTo = (token: string) => push.sent.filter((message) => message.tokens.includes(token));

  beforeAll(async () => {
    ctx = await createTestApp();
    push = ctx.app.get(PushProvider);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('expõe a tokenização de cartão para os apps (sandbox)', async () => {
    const methods = await ctx.http().get('/v1/payments/methods').expect(200);
    expect(methods.body.cardTokenization).toEqual({ provider: 'sandbox' });
    expect(methods.body.orders).toEqual(expect.arrayContaining(['CREDIT_CARD', 'PIX']));
  });

  it('push segmentado por app: o mesmo usuário recebe cada aviso só no app certo', async () => {
    const driver = await newDriver(at(0.1));
    const driverDevice = `ExponentPushToken[drv-${Date.now()}]`;
    const customerDevice = `ExponentPushToken[cli-${Date.now()}]`;
    await ctx.http().post('/v1/me/devices').set(auth(driver.token)).send({ token: driverDevice, platform: 'ANDROID', app: 'DRIVER' }).expect(204);
    await ctx.http().post('/v1/me/devices').set(auth(driver.token)).send({ token: customerDevice, platform: 'ANDROID', app: 'CUSTOMER' }).expect(204);

    const notifications = ctx.app.get(NotificationsService);
    await notifications.notify({ userId: driver.userId, type: 'test.driver', title: 'Só no app do entregador', body: 'x', channels: ['push'], app: 'DRIVER' });
    await notifications.notify({ userId: driver.userId, type: 'test.all', title: 'Para todos os aparelhos', body: 'y', channels: ['push'] });
    await waitFor(() => sentTo(customerDevice).some((message) => message.title === 'Para todos os aparelhos'));
    expect(sentTo(driverDevice).map((message) => message.title)).toEqual(expect.arrayContaining(['Só no app do entregador', 'Para todos os aparelhos']));
    expect(sentTo(customerDevice).map((message) => message.title)).not.toContain('Só no app do entregador');

    // Oferta real: canal "offers" (alta prioridade) e validade igual ao tempo da oferta.
    const customer = await newCustomer();
    const delivery = await ctx.http()
      .post('/v1/deliveries')
      .set(auth(customer.token))
      .send({ pickup: { addressId: customer.addressId }, dropoff: { street: 'Rua Destino', number: '1', city: 'Cidade App', state: 'SP', ...at(0.9) }, itemCategory: 'PACKAGE', weightKg: 1, paymentMethod: 'CASH' })
      .expect(201);
    const offerPush = await waitFor(() => sentTo(driverDevice).find((message) => message.title === 'Nova entrega disponível'));
    expect(offerPush.tokens).toEqual([driverDevice]);
    expect(offerPush.channelId).toBe('offers');
    expect(offerPush.ttlSeconds).toBeGreaterThan(0);

    // Entregador aceita; o cliente cancela → o entregador é avisado no app dele.
    const offers = await waitFor(async () => {
      const response = await ctx.http().get('/v1/drivers/me/offers').set(auth(driver.token)).expect(200);
      return response.body.length ? (response.body as { id: string }[]) : null;
    });
    const accepted = await ctx.http().post(`/v1/drivers/me/offers/${offers[0].id}/accept`).set(auth(driver.token)).expect(200);
    expect(accepted.body.id).toBe(delivery.body.id);

    // Detalhe da entrega para o app do entregador (endereço completo, telefone mascarado).
    const detail = await ctx.http().get(`/v1/drivers/me/deliveries/${delivery.body.id}`).set(auth(driver.token)).expect(200);
    expect(detail.body).toMatchObject({ id: delivery.body.id, status: 'DRIVER_ASSIGNED', dropoff: { street: 'Rua Destino' } });
    expect(detail.body.payoutCents).toBeGreaterThan(0);
    const intruder = await newDriver(at(40));
    await ctx.http().get(`/v1/drivers/me/deliveries/${delivery.body.id}`).set(auth(intruder.token)).expect(404);

    await ctx.http().post(`/v1/deliveries/${delivery.body.id}/cancel`).set(auth(customer.token)).send({ reason: 'Não preciso mais' }).expect(201);
    const canceledPush = await waitFor(() => sentTo(driverDevice).find((message) => message.title === `Entrega ${delivery.body.code} cancelada`));
    expect(canceledPush.body).toContain('Não preciso mais');
    expect(sentTo(customerDevice).some((message) => message.title.includes('cancelada'))).toBe(false);

    await ctx.prisma.driver.updateMany({ where: { id: { in: [driver.driverId, intruder.driverId] } }, data: { availability: 'OFFLINE' } });
  });

  it('login com verificação em duas etapas pelo app do cliente cria o perfil de cliente', async () => {
    const driver = await newDriver(at(60));
    await ctx.prisma.driver.update({ where: { id: driver.driverId }, data: { availability: 'OFFLINE' } });
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: driver.userId } });
    const setup = await ctx.http().post('/v1/auth/mfa/setup').set(auth(driver.token)).expect(201);
    await ctx.http().post('/v1/auth/mfa/enable').set(auth(driver.token)).send({ code: generateTotp(setup.body.secret) }).expect(204);
    expect(await ctx.prisma.customer.count({ where: { userId: driver.userId } })).toBe(0);

    const step1 = await ctx.http().post('/v1/auth/login').send({ login: user.email, password: 'SenhaForte123', app: 'CUSTOMER' }).expect(200);
    expect(step1.body.mfaRequired).toBe(true);
    const step2 = await ctx.http().post('/v1/auth/mfa/login').send({ mfaToken: step1.body.mfaToken, code: generateTotp(setup.body.secret), app: 'CUSTOMER' }).expect(200);
    const me = await ctx.http().get('/v1/auth/me').set(auth(step2.body.accessToken)).expect(200);
    expect(me.body.customerId).toEqual(expect.any(String));
    expect(me.body.driver).toMatchObject({ status: 'APPROVED' });
  });

  it('pedidos e entregas informam se o cliente já avaliou', async () => {
    const customer = await newCustomer();
    const delivery = await ctx.http()
      .post('/v1/deliveries')
      .set(auth(customer.token))
      .send({ pickup: { addressId: customer.addressId }, dropoff: { street: 'Rua B', number: '2', city: 'Cidade App', state: 'SP', ...at(0.8) }, itemCategory: 'DOCUMENT', paymentMethod: 'CASH' })
      .expect(201);
    const view = await ctx.http().get(`/v1/deliveries/${delivery.body.id}`).set(auth(customer.token)).expect(200);
    expect(view.body.reviewed).toBe(false);
    await ctx.http().post(`/v1/deliveries/${delivery.body.id}/cancel`).set(auth(customer.token)).send({ reason: 'Teste' }).expect(201);
  });

  it('checkout aceita bandeira e emissor retornados pela tokenização', async () => {
    // A validação do DTO aceita os campos (a cobrança real depende do provedor configurado).
    const customer = await newCustomer();
    const response = await ctx.http()
      .post('/v1/orders')
      .set(auth(customer.token))
      .send({ companyId: '00000000-0000-7000-8000-000000000000', addressId: customer.addressId, paymentMethod: 'CREDIT_CARD', cardToken: 'tok_approved', cardPaymentMethodId: 'visa', cardIssuerId: '25', installments: 1 });
    expect(response.status).not.toBe(400);
  });
});
