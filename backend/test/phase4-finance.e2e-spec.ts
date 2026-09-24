import { crc16 } from '../src/modules/finance/gateways';
import { DispatchService } from '../src/modules/logistics/dispatch.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { ADMIN, createTestApp, login, TestContext, uniqueIdentity } from './utils';

/**
 * Fase 4 — Financeiro: PIX, cartão, carteira, cupons, cancelamentos com estorno, liquidação
 * (comissão, repasses, dinheiro em mãos), saques, quitação de dívida, ajustes e conciliação.
 */
describe('Fase 4 — Financeiro (E2E)', () => {
  let ctx: TestContext;
  let adminToken: string;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const BASE = { lat: -10 - Math.random() * 15, lng: -40 - Math.random() * 15 };
  const at = (dLatKm: number, dLngKm = 0) => ({ lat: BASE.lat + dLatKm / 111, lng: BASE.lng + dLngKm / 111 });
  const STORE = at(0);
  const HOME = at(1.2, 0.8);

  let company: { token: string; companyId: string };
  let driver: { token: string; driverId: string; userId: string };
  let productId: string;
  const PRICE = 3000;

  async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 15_000): Promise<T> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = await check();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('Tempo esgotado aguardando condição');
  }

  async function newCustomer() {
    const id = uniqueIdentity();
    const response = await ctx.http()
      .post('/v1/auth/register/customer')
      .send({ name: 'Cliente Financeiro', email: id.email, phone: id.phone, password: 'SenhaForte123', acceptTerms: true, acceptPrivacy: true })
      .expect(201);
    const address = await ctx.http()
      .post('/v1/me/addresses')
      .set(auth(response.body.accessToken))
      .send({ zipCode: '01310200', street: 'Rua do Cliente', number: '99', district: 'Jardim', city: 'Cidade Fin', state: 'SP', ...HOME })
      .expect(201);
    const customer = await ctx.prisma.customer.findUniqueOrThrow({ where: { userId: response.body.user.id } });
    return { token: response.body.accessToken as string, userId: response.body.user.id as string, customerId: customer.id, addressId: address.body.id as string };
  }
  type Customer = Awaited<ReturnType<typeof newCustomer>>;

  async function checkout(customer: Customer, body: Record<string, unknown>, expected = 201) {
    await ctx.http().post('/v1/cart/items').set(auth(customer.token)).send({ productId, quantity: 2 }).expect(201);
    return ctx.http().post('/v1/orders').set(auth(customer.token)).send({ companyId: company.companyId, addressId: customer.addressId, ...body }).expect(expected);
  }

  /** Loja prepara, entregador aceita, coleta e entrega com código no destino. */
  async function deliverOrder(orderId: string, deliveryCode: string) {
    const base = `/v1/companies/${company.companyId}/orders/${orderId}`;
    for (const step of ['confirm', 'prepare', 'ready']) await ctx.http().post(`${base}/${step}`).set(auth(company.token)).expect(201);
    const offer = await waitFor(async () => (await ctx.http().get('/v1/drivers/me/offers').set(auth(driver.token)).expect(200)).body[0] as { id: string } | undefined);
    await ctx.http().post(`/v1/drivers/me/offers/${offer.id}/accept`).set(auth(driver.token)).expect(200);
    const delivery = await ctx.prisma.delivery.findUniqueOrThrow({ where: { orderId } });
    await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/picked-up`).set(auth(driver.token)).expect(204);
    await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/start-route`).set(auth(driver.token)).expect(204);
    await ctx.http().post('/v1/drivers/me/location').set(auth(driver.token)).send({ ...HOME, speed: 3 }).expect(200);
    await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/deliver`).set(auth(driver.token)).send({ method: 'CODE', code: deliveryCode }).expect(200);
    await waitFor(async () => (await ctx.prisma.order.findUnique({ where: { id: orderId } }))?.settledAt);
    // Volta o entregador para perto da loja para as próximas ofertas.
    await ctx.http().post('/v1/drivers/me/location').set(auth(driver.token)).send({ ...at(0.2), speed: 3 }).expect(200);
    return delivery;
  }

  const walletOf = (where: { driverId?: string; companyId?: string; customerId?: string }) => ctx.prisma.wallet.findFirst({ where });
  const entriesOf = (orderId: string) => ctx.prisma.walletTransaction.findMany({ where: { orderId, status: { not: 'CANCELED' } }, include: { wallet: { select: { ownerType: true } } } });

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await login(ctx, ADMIN, 'ADMIN');

    const segments = await ctx.http().get('/v1/segments').expect(200);
    const owner = uniqueIdentity();
    const companyIdentity = uniqueIdentity();
    const registered = await ctx.http()
      .post('/v1/auth/register/company')
      .send({
        name: 'Dono Financeiro',
        email: owner.email,
        phone: owner.phone,
        password: 'SenhaForte123',
        cpf: owner.cpf,
        acceptTerms: true,
        acceptPrivacy: true,
        acceptCompanyTerms: true,
        company: {
          legalName: 'Financeiro Teste LTDA',
          tradeName: `Loja Financeiro ${Date.now()}`,
          cnpj: companyIdentity.cnpj,
          segmentId: segments.body.find((s: { slug: string }) => s.slug === 'restaurantes').id,
          email: companyIdentity.email,
          phone: '(11) 3333-4444',
          responsibleName: 'Dono Financeiro',
          responsibleCpf: owner.cpf,
        },
      })
      .expect(201);
    company = { token: registered.body.accessToken, companyId: registered.body.companyId };
    await ctx.http()
      .put(`/v1/companies/${company.companyId}/address`)
      .set(auth(company.token))
      .send({ zipCode: '01310100', street: 'Rua da Loja', number: '10', district: 'Centro', city: 'Cidade Fin', state: 'SP', ...STORE })
      .expect(200);
    await ctx.http()
      .put(`/v1/companies/${company.companyId}/opening-hours`)
      .set(auth(company.token))
      .send({ hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: '00:00', closesAt: '23:59' })) })
      .expect(200);
    await ctx.prisma.company.update({ where: { id: company.companyId }, data: { status: 'APPROVED', isOpen: true } });
    productId = (await ctx.http().post(`/v1/companies/${company.companyId}/products`).set(auth(company.token)).send({ name: 'Prato', priceCents: PRICE, weightGrams: 500 }).expect(201)).body.id;

    const id = uniqueIdentity();
    const response = await ctx.http()
      .post('/v1/auth/register/driver')
      .send({
        name: 'Entregador Financeiro',
        email: id.email,
        phone: id.phone,
        password: 'SenhaForte123',
        cpf: id.cpf,
        birthDate: '1990-05-05',
        vehicleType: 'MOTORCYCLE',
        acceptTerms: true,
        acceptPrivacy: true,
        acceptDriverTerms: true,
        acceptLocationTracking: true,
      })
      .expect(201);
    const row = await ctx.prisma.driver.findUniqueOrThrow({ where: { userId: response.body.user.id } });
    await ctx.prisma.driver.update({ where: { id: row.id }, data: { status: 'APPROVED', approvedAt: new Date() } });
    await ctx.prisma.vehicle.update({ where: { id: row.activeVehicleId! }, data: { status: 'APPROVED', plate: 'FIN1A23' } });
    driver = { token: response.body.accessToken, driverId: row.id, userId: response.body.user.id };
    await ctx.http().post('/v1/drivers/me/availability').set(auth(driver.token)).send({ online: true, ...at(0.2) }).expect(200);

    // Comissão específica da loja: 10% + R$ 1,00
    await ctx.http()
      .post('/v1/admin/finance/commission-rules')
      .set(auth(adminToken))
      .send({ name: 'Loja parceira', companyId: company.companyId, percentBps: 1000, fixedCents: 100 })
      .expect(201);
  });

  afterAll(async () => {
    await ctx.prisma.driver.update({ where: { id: driver.driverId }, data: { availability: 'OFFLINE' } });
    await ctx.app.close();
  });

  it('expõe as formas de pagamento habilitadas (sandbox)', async () => {
    const methods = await ctx.http().get('/v1/payments/methods').expect(200);
    expect(methods.body.orders).toEqual(expect.arrayContaining(['CASH', 'PIX', 'CREDIT_CARD', 'WALLET']));
    expect(methods.body.sandbox.cardTokens).toHaveProperty('tok_approved');
    expect(methods.body.deliveries.company).toEqual(expect.arrayContaining(['INVOICE', 'WALLET']));
  });

  it('PIX: pedido aguarda pagamento, gera copia e cola válido e segue para a loja após a confirmação', async () => {
    const customer = await newCustomer();
    const created = await checkout(customer, { paymentMethod: 'PIX' });
    expect(created.body.status).toBe('PENDING_PAYMENT');
    const payment = created.body.payment;
    expect(payment).toMatchObject({ method: 'PIX', status: 'PENDING', amountCents: created.body.totalCents });
    // BR Code: começa com o formato EMV e termina com CRC16 válido
    const brCode: string = payment.pixCopyPaste;
    expect(brCode.startsWith('000201')).toBe(true);
    expect(brCode.slice(-4)).toBe(crc16(brCode.slice(0, -4)));
    expect(brCode).toContain(`54${(created.body.totalCents / 100).toFixed(2).length.toString().padStart(2, '0')}${(created.body.totalCents / 100).toFixed(2)}`);

    // Sacola preservada até a confirmação; loja não consegue aceitar pedido não pago
    expect(await ctx.prisma.cart.count({ where: { customerId: customer.customerId, companyId: company.companyId } })).toBe(1);
    await ctx.http().post(`/v1/companies/${company.companyId}/orders/${created.body.id}/confirm`).set(auth(company.token)).expect(409);

    // Outro usuário não confirma o pagamento de terceiros
    const intruder = await newCustomer();
    await ctx.http().post(`/v1/payments/sandbox/${payment.id}/approve`).set(auth(intruder.token)).expect(404);

    await ctx.http().post(`/v1/payments/sandbox/${payment.id}/approve`).set(auth(customer.token)).expect(200);
    const paid = await ctx.http().get(`/v1/orders/${created.body.id}`).set(auth(customer.token)).expect(200);
    expect(paid.body.status).toBe('NEW');
    expect(paid.body.payment).toMatchObject({ status: 'PAID', pixCopyPaste: null });
    expect(await ctx.prisma.cart.count({ where: { customerId: customer.customerId, companyId: company.companyId } })).toBe(0);
    await ctx.http().post(`/v1/payments/sandbox/${payment.id}/approve`).set(auth(customer.token)).expect(409);

    // Webhook de provedor não configurado é recusado; webhooks sandbox são ignorados
    await ctx.http().post('/v1/payments/webhooks/mercadopago').send({ data: { id: '1' } }).expect(404);
    expect((await ctx.http().post('/v1/payments/webhooks/sandbox').send({}).expect(200)).body).toEqual({ ignored: true });

    // Loja cancela → estorno automático no meio original
    await ctx.http().post(`/v1/companies/${company.companyId}/orders/${created.body.id}/cancel`).set(auth(company.token)).send({ reason: 'Sem entregador na região' }).expect(201);
    const refunded = await waitFor(async () => {
      const row = await ctx.prisma.payment.findUnique({ where: { id: payment.id }, include: { refunds: true } });
      return row?.status === 'REFUNDED' ? row : null;
    });
    expect(refunded.refundedCents).toBe(refunded.amountCents);
    expect(refunded.refunds[0]).toMatchObject({ status: 'SUCCEEDED', toWallet: false });
    expect((await ctx.prisma.order.findUniqueOrThrow({ where: { id: created.body.id } })).paymentStatus).toBe('REFUNDED');
  });

  it('cartão recusado cancela o pedido, preserva a sacola e devolve o cupom', async () => {
    const code = `FIN${Date.now().toString().slice(-6)}`;
    await ctx.http()
      .post('/v1/admin/finance/coupons')
      .set(auth(adminToken))
      .send({ code, type: 'PERCENT', percentBps: 1000, maxDiscountCents: 1000, maxRedemptions: 5 })
      .expect(201);
    const customer = await newCustomer();

    // Cartão sem token é recusado antes de criar o pedido
    await checkout(customer, { paymentMethod: 'CREDIT_CARD' }, 422);

    const quote = await ctx.http().post('/v1/orders/quote').set(auth(customer.token)).send({ companyId: company.companyId, addressId: customer.addressId, couponCode: code }).expect(201);
    expect(quote.body.discountCents).toBe(600); // 10% de R$ 60,00
    expect(quote.body.coupon).toMatchObject({ code });

    const declined = await ctx.http()
      .post('/v1/orders')
      .set(auth(customer.token))
      .send({ companyId: company.companyId, addressId: customer.addressId, paymentMethod: 'CREDIT_CARD', cardToken: 'tok_declined', couponCode: code })
      .expect(201);
    expect(declined.body.status).toBe('CANCELED');
    expect(declined.body.payment).toMatchObject({ status: 'FAILED', failureReason: 'Cartão recusado pelo emissor.' });
    expect(await ctx.prisma.cart.count({ where: { customerId: customer.customerId, companyId: company.companyId } })).toBe(1);
    await waitFor(async () => (await ctx.prisma.couponRedemption.count({ where: { orderId: declined.body.id } })) === 0);
    expect((await ctx.prisma.coupon.findFirstOrThrow({ where: { code } })).redemptions).toBe(0);

    // Nova tentativa com cartão aprovado usa o mesmo cupom
    const approved = await ctx.http()
      .post('/v1/orders')
      .set(auth(customer.token))
      .send({ companyId: company.companyId, addressId: customer.addressId, paymentMethod: 'CREDIT_CARD', cardToken: 'tok_approved', couponCode: code })
      .expect(201);
    expect(approved.body.status).toBe('NEW');
    expect(approved.body.payment).toMatchObject({ status: 'PAID', cardBrand: 'visa', cardLast4: '4242' });
    expect((await ctx.prisma.coupon.findFirstOrThrow({ where: { code } })).redemptions).toBe(1);

    // Cliente cancela: estorno + cupom devolvido
    await ctx.http().post(`/v1/orders/${approved.body.id}/cancel`).set(auth(customer.token)).send({ reason: 'Mudei de ideia' }).expect(201);
    await waitFor(async () => (await ctx.prisma.payment.findFirst({ where: { orderId: approved.body.id, status: 'REFUNDED' } })) ?? null);
    expect((await ctx.prisma.coupon.findFirstOrThrow({ where: { code } })).redemptions).toBe(0);
  });

  it('liquidação de pedido em dinheiro: comissão, cupom da loja, repasse, gorjeta e dívida do entregador', async () => {
    const code = `LJ${Date.now().toString().slice(-7)}`;
    await ctx.http()
      .post(`/v1/companies/${company.companyId}/coupons`)
      .set(auth(company.token))
      .send({ code, type: 'FIXED', amountCents: 500, minOrderCents: 1000 })
      .expect(201);
    const customer = await newCustomer();
    const order = (await checkout(customer, { paymentMethod: 'CASH', tipCents: 300, couponCode: code })).body;
    expect(order.discountCents).toBe(500);
    const delivery = await deliverOrder(order.id, order.deliveryCode);

    const settled = await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    const subtotal = PRICE * 2;
    const commission = Math.round((subtotal - 500) * 0.1) + 100;
    expect(settled.platformCommissionCents).toBe(commission);
    expect(settled.paymentStatus).toBe('PAID');

    const entries = await entriesOf(order.id);
    const sum = (ownerType: string, type?: string) =>
      entries.filter((e) => e.wallet.ownerType === ownerType && (!type || e.type === type)).reduce((total, e) => total + e.amountCents, 0);
    // O razão fecha: em dinheiro a soma é zero (o valor fica como dívida de quem recebeu)
    expect(entries.reduce((total, e) => total + e.amountCents, 0)).toBe(0);
    expect(sum('COMPANY', 'SALE')).toBe(subtotal);
    expect(sum('COMPANY', 'DISCOUNT')).toBe(-500);
    expect(sum('COMPANY', 'COMMISSION')).toBe(-commission);
    expect(entries.filter((e) => e.wallet.ownerType === 'COMPANY').every((e) => e.status === 'PENDING')).toBe(true);
    expect(sum('DRIVER', 'EARNING')).toBe(delivery.payoutCents);
    expect(sum('DRIVER', 'TIP')).toBe(300);
    expect(sum('DRIVER', 'CASH_COLLECTED')).toBe(-settled.totalCents);
    expect(sum('PLATFORM')).toBe(commission + settled.serviceFeeCents + settled.deliveryFeeCents - delivery.payoutCents);
    expect(await ctx.prisma.payment.count({ where: { orderId: order.id, method: 'CASH', status: 'PAID' } })).toBe(1);

    // Liquidação é idempotente
    const { SettlementService } = await import('../src/modules/finance/settlement.service');
    expect(await ctx.app.get(SettlementService).settleOrder(order.id)).toBe(false);

    // Carteira do entregador: saldo devedor (dinheiro em mãos) e quitação via PIX
    const wallet = await ctx.http().get('/v1/drivers/me/wallet').set(auth(driver.token)).expect(200);
    const expectedBalance = delivery.payoutCents + 300 - settled.totalCents;
    expect(wallet.body.availableCents).toBe(expectedBalance);
    expect(wallet.body.debtCents).toBe(-expectedBalance);
    expect(wallet.body.cashLimitReached).toBe(false);
    const statement = await ctx.http().get('/v1/drivers/me/wallet/transactions').set(auth(driver.token)).expect(200);
    expect(statement.body.data.map((row: { type: string }) => row.type)).toEqual(expect.arrayContaining(['EARNING', 'TIP', 'CASH_COLLECTED']));

    const debt = await ctx.http().post('/v1/drivers/me/wallet/settle-debt').set(auth(driver.token)).expect(201);
    expect(debt.body.amountCents).toBe(-expectedBalance);
    expect(debt.body.pixCopyPaste).toMatch(/^000201/);
    await ctx.http().post(`/v1/payments/sandbox/${debt.body.id}/approve`).set(auth(driver.token)).expect(200);
    expect((await walletOf({ driverId: driver.driverId }))!.availableCents).toBe(0);
    await ctx.http().post('/v1/drivers/me/wallet/settle-debt').set(auth(driver.token)).expect(409);

    // Loja: saldo a liberar; liberação após o prazo
    const companyWallet = await ctx.http().get(`/v1/companies/${company.companyId}/finance/wallet`).set(auth(company.token)).expect(200);
    expect(companyWallet.body.pendingCents).toBe(subtotal - 500 - commission);
    expect(companyWallet.body.commission).toMatchObject({ percentBps: 1000, fixedCents: 100 });
    await ctx.prisma.walletTransaction.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { availableAt: new Date(Date.now() - 1000) } });
    await ctx.http().post('/v1/admin/finance/settlements/release').set(auth(adminToken)).expect(200);
    const released = (await walletOf({ companyId: company.companyId }))!;
    expect(released).toMatchObject({ pendingCents: 0, availableCents: subtotal - 500 - commission });
  });

  it('saques: validações, aprovação com repasse automático, recusa e cancelamento devolvem o saldo', async () => {
    // Pedido pago online gera saldo positivo para o entregador
    const customer = await newCustomer();
    const order = (await checkout(customer, { paymentMethod: 'CREDIT_CARD', cardToken: 'tok_approved', tipCents: 800 })).body;
    expect(order.status).toBe('NEW');
    const delivery = await deliverOrder(order.id, order.deliveryCode);
    const entries = await entriesOf(order.id);
    expect(entries.some((e) => e.type === 'CASH_COLLECTED')).toBe(false);
    // Online: a soma dos lançamentos é exatamente o valor recebido pelo gateway
    expect(entries.reduce((total, e) => total + e.amountCents, 0)).toBe(order.totalCents);
    const balance = delivery.payoutCents + 800;
    expect((await walletOf({ driverId: driver.driverId }))!.availableCents).toBe(balance);

    // Sem chave PIX não há saque
    await ctx.http().post('/v1/drivers/me/withdrawals').set(auth(driver.token)).send({ amountCents: 1000 }).expect(422);
    await ctx.http()
      .put('/v1/drivers/me/bank-account')
      .set(auth(driver.token))
      .send({ holderName: 'Entregador Financeiro', holderDocument: '52998224725', bankCode: '260', branch: '0001', accountNumber: '123456789', accountType: 'PAYMENT', pixKeyType: 'EMAIL', pixKey: 'entregador@levoja.test' })
      .expect(200);

    await ctx.http().post('/v1/drivers/me/withdrawals').set(auth(driver.token)).send({ amountCents: 500 }).expect(400); // abaixo do mínimo
    await ctx.http().post('/v1/drivers/me/withdrawals').set(auth(driver.token)).send({ amountCents: balance + 1 }).expect(422);

    const first = await ctx.http().post('/v1/drivers/me/withdrawals').set(auth(driver.token)).send({ amountCents: 1000 }).expect(201);
    expect(first.body).toMatchObject({ status: 'REQUESTED', amountCents: 1000 });
    expect(first.body.destination).toContain('PIX');
    expect(first.body.destination).not.toContain('entregador@levoja.test');
    expect((await walletOf({ driverId: driver.driverId }))!.availableCents).toBe(balance - 1000);
    await ctx.http().post('/v1/drivers/me/withdrawals').set(auth(driver.token)).send({ amountCents: 1000 }).expect(409);

    // Entregador cancela; saldo volta
    await ctx.http().post(`/v1/drivers/me/withdrawals/${first.body.id}/cancel`).set(auth(driver.token)).expect(200);
    expect((await walletOf({ driverId: driver.driverId }))!.availableCents).toBe(balance);

    // Admin recusa com motivo; saldo volta
    const second = await ctx.http().post('/v1/drivers/me/withdrawals').set(auth(driver.token)).send({ amountCents: 1000 }).expect(201);
    const queue = await ctx.http().get('/v1/admin/finance/withdrawals?status=REQUESTED&pageSize=100').set(auth(adminToken)).expect(200);
    expect(queue.body.data.find((row: { id: string }) => row.id === second.body.id)).toMatchObject({ owner: { type: 'DRIVER', name: 'Entregador Financeiro' } });
    await ctx.http().post(`/v1/admin/finance/withdrawals/${second.body.id}/reject`).set(auth(adminToken)).send({ reason: 'Dados divergentes' }).expect(200);
    expect((await walletOf({ driverId: driver.driverId }))!.availableCents).toBe(balance);

    // Aprovação: repasse sandbox conclui na hora
    const third = await ctx.http().post('/v1/drivers/me/withdrawals').set(auth(driver.token)).send({ amountCents: 1000 }).expect(201);
    const approved = await ctx.http().post(`/v1/admin/finance/withdrawals/${third.body.id}/approve`).set(auth(adminToken)).expect(200);
    expect(approved.body).toMatchObject({ status: 'PAID' });
    expect(approved.body.providerTransferId).toBeTruthy();
    await ctx.http().post(`/v1/admin/finance/withdrawals/${third.body.id}/reject`).set(auth(adminToken)).send({ reason: 'Tarde demais' }).expect(409);
    expect((await walletOf({ driverId: driver.driverId }))!.availableCents).toBe(balance - 1000);

    // Antifraude: troca da chave PIX retém novos saques por um período
    await ctx.prisma.bankAccount.update({ where: { driverId: driver.driverId }, data: { createdAt: new Date(Date.now() - 86_400_000) } });
    await ctx.http()
      .put('/v1/drivers/me/bank-account')
      .set(auth(driver.token))
      .send({ holderName: 'Entregador Financeiro', holderDocument: '52998224725', bankCode: '260', branch: '0001', accountNumber: '123456789', accountType: 'PAYMENT', pixKeyType: 'EMAIL', pixKey: 'outra.chave@levoja.test' })
      .expect(200);
    const held = await ctx.http().post('/v1/drivers/me/withdrawals').set(auth(driver.token)).send({ amountCents: 1000 }).expect(422);
    expect(held.body.message).toContain('Por segurança');

    // Estorno parcial de pedido já liquidado: custo da plataforma, limitado ao valor pago
    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    await ctx.http().post(`/v1/admin/finance/payments/${payment.id}/refund`).set(auth(adminToken)).send({ amountCents: payment.amountCents + 1, reason: 'Teste' }).expect(400);
    const partial = await ctx.http().post(`/v1/admin/finance/payments/${payment.id}/refund`).set(auth(adminToken)).send({ amountCents: 1000, reason: 'Item faltando' }).expect(200);
    expect(partial.body).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedCents: 1000 });
    expect(await ctx.prisma.walletTransaction.count({ where: { paymentId: payment.id, type: 'REFUND', amountCents: -1000 } })).toBe(1);

    // Estorno em crédito na carteira do cliente, usado depois numa entrega avulsa
    await ctx.http().post(`/v1/admin/finance/payments/${payment.id}/refund`).set(auth(adminToken)).send({ amountCents: 2500, reason: 'Compensação', toWallet: true }).expect(200);
    const credits = await ctx.http().get('/v1/customers/me/wallet').set(auth(customer.token)).expect(200);
    expect(credits.body.availableCents).toBe(2500);

    const deliveryBody = {
      pickup: { addressId: customer.addressId },
      dropoff: { street: 'Rua Destino', number: '5', city: 'Cidade Fin', state: 'SP', ...at(0.5) },
      itemCategory: 'PACKAGE',
      weightKg: 1,
      paymentMethod: 'WALLET',
    };
    const onDemand = await ctx.http().post('/v1/deliveries').set(auth(customer.token)).send(deliveryBody).expect(201);
    const charged = onDemand.body.feeCents as number;
    expect((await walletOf({ customerId: customer.customerId }))!.availableCents).toBe(2500 - charged);
    expect((await ctx.prisma.delivery.findUniqueOrThrow({ where: { id: onDemand.body.id } })).paymentStatus).toBe('PAID');
    await ctx.http().post(`/v1/deliveries/${onDemand.body.id}/cancel`).set(auth(customer.token)).send({ reason: 'Não preciso mais' }).expect(201);
    await waitFor(async () => (await walletOf({ customerId: customer.customerId }))?.availableCents === 2500);
    // Cancelamento durante a busca não deixa oferta "fantasma" para o entregador
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await ctx.prisma.deliveryOffer.count({ where: { deliveryId: onDemand.body.id, status: 'PENDING' } })).toBe(0);
    // Saldo insuficiente (taxa + gorjeta acima do crédito): nada é criado
    const before = await ctx.prisma.delivery.count({ where: { requesterUserId: customer.userId } });
    const insufficient = await ctx.http().post('/v1/deliveries').set(auth(customer.token)).send({ ...deliveryBody, tipCents: 2500 }).expect(422);
    expect(insufficient.body.message).toContain('Saldo insuficiente');
    expect(await ctx.prisma.delivery.count({ where: { requesterUserId: customer.userId } })).toBe(before);
  });

  it('limite de dinheiro em mãos tira o entregador das entregas em dinheiro; ajustes são auditados', async () => {
    const wallet = (await walletOf({ driverId: driver.driverId }))!;
    const customer = await newCustomer();
    await ctx.http().post(`/v1/admin/finance/wallets/${wallet.id}/adjustments`).set(auth(customer.token)).send({ amountCents: -1, reason: 'Tentativa indevida' }).expect(403);
    const adjusted = await ctx.http()
      .post(`/v1/admin/finance/wallets/${wallet.id}/adjustments`)
      .set(auth(adminToken))
      .send({ amountCents: -(wallet.availableCents + 40_000), reason: 'Dinheiro não repassado (teste)' })
      .expect(201);
    expect(adjusted.body.availableCents).toBe(-40_000);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'wallet.adjust', entityId: wallet.id } })).toBe(1);

    const tenantId = (await ctx.prisma.driver.findUniqueOrThrow({ where: { id: driver.driverId } })).tenantId;
    const config = await ctx.app.get(SettingsService).get(tenantId, 'dispatch');
    const dispatch = ctx.app.get(DispatchService);
    const probe = { id: '00000000-0000-7000-8000-000000000000', tenantId, companyId: null, pickupLat: STORE.lat, pickupLng: STORE.lng, vehicleType: 'MOTORCYCLE', weightKg: 1, distanceKm: 2 };
    const forCash = await dispatch.findCandidates({ ...probe, paymentMethod: 'CASH' } as never, 3, config);
    const forPix = await dispatch.findCandidates({ ...probe, paymentMethod: 'PIX' } as never, 3, config);
    expect(forCash.some((candidate) => candidate.driverId === driver.driverId)).toBe(false);
    expect(forPix.some((candidate) => candidate.driverId === driver.driverId)).toBe(true);

    const overview = await ctx.http().get('/v1/drivers/me/wallet').set(auth(driver.token)).expect(200);
    expect(overview.body.cashLimitReached).toBe(true);

    // Restaura para não afetar outros testes
    await ctx.http().post(`/v1/admin/finance/wallets/${wallet.id}/adjustments`).set(auth(adminToken)).send({ amountCents: 40_000, reason: 'Estorno do ajuste de teste' }).expect(201);
  });

  it('conciliação: relatório, carteiras consistentes e permissões', async () => {
    const report = await ctx.http().get('/v1/admin/finance/reconciliation').set(auth(adminToken)).expect(200);
    expect(report.body.orders.delivered).toBeGreaterThanOrEqual(2);
    expect(report.body.platform.byType.map((row: { type: string }) => row.type)).toEqual(expect.arrayContaining(['COMMISSION', 'FEE', 'EARNING']));
    expect(report.body.anomalies).toHaveProperty('unsettledOrders');
    expect(report.body.payments.some((row: { method: string; status: string }) => row.method === 'PIX')).toBe(true);

    const verify = await ctx.http().post('/v1/admin/finance/reconciliation/verify-wallets').set(auth(adminToken)).send({ limit: 50 }).expect(200);
    expect(verify.body.drift).toEqual([]);

    const wallets = await ctx.http().get('/v1/admin/finance/wallets?ownerType=DRIVER&pageSize=5').set(auth(adminToken)).expect(200);
    expect(wallets.body.data[0]).toHaveProperty('ownerName');
    const platform = await ctx.http().get('/v1/admin/finance/wallets/platform').set(auth(adminToken)).expect(200);
    expect(platform.body.ownerType).toBe('PLATFORM');
    const payments = await ctx.http().get('/v1/admin/finance/payments?method=PIX&pageSize=5').set(auth(adminToken)).expect(200);
    expect(payments.body.data[0]).not.toHaveProperty('pixCopyPaste');

    const customer = await newCustomer();
    await ctx.http().get('/v1/admin/finance/reconciliation').set(auth(customer.token)).expect(403);
    await ctx.http().get(`/v1/companies/${company.companyId}/finance/wallet`).set(auth(customer.token)).expect(403);
    await ctx.http().get('/v1/drivers/me/wallet').set(auth(customer.token)).expect(403);
    await ctx.http().get('/v1/admin/finance/reconciliation?from=2026-01-01&to=2025-01-01').set(auth(adminToken)).expect(400);
  });
});
