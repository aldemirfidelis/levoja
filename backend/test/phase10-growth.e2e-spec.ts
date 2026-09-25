import { randomBytes } from 'node:crypto';
import { SettingsService } from '../src/modules/settings/settings.service';
import { LoyaltyService } from '../src/modules/growth/loyalty.service';
import { ReferralsService } from '../src/modules/growth/referrals.service';
import { ADMIN, createTestApp, login, TestContext, uniqueIdentity } from './utils';

/**
 * Fase 10 — Complementos: Home do cliente (favoritas, promoções, cupons listados, pedidos recentes e
 * "pedir de novo"), fidelidade (pontos, níveis, cashback, resgate, expiração, cupom de nível),
 * Indique e ganhe (clientes, entregadores e empresas, com antifraude e supervisão) e frota própria.
 */
describe('Fase 10 — Complementos (E2E)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let settings: SettingsService;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const RUN = Date.now().toString().slice(-7);
  const CITY = `Cidade Crescimento ${RUN}`;
  const BASE = { lat: -10 - Math.random() * 15, lng: -40 - Math.random() * 15 };
  const at = (dLatKm: number, dLngKm = 0) => ({ lat: BASE.lat + dLatKm / 111, lng: BASE.lng + dLngKm / 111 });
  const HOME = at(1.1, 0.6);
  const PRICE = 3000;
  const newDevice = () => `dev${randomBytes(16).toString('hex')}`;

  const originals: Record<string, unknown> = {};
  let company: { token: string; companyId: string; userId: string };
  let productId: string;
  let referrer: Customer;
  let referrerCode: string;
  let referrerDevice: string;
  let driverReferrer: { token: string; driverId: string; userId: string };
  let driver: { token: string; driverId: string; userId: string };

  async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 15_000): Promise<T> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = await check();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('Tempo esgotado aguardando condição');
  }

  async function newCustomer(options: { device?: string; referralCode?: string; name?: string } = {}) {
    const id = uniqueIdentity();
    const request = ctx.http().post('/v1/auth/register/customer');
    if (options.device) request.set('X-Device-Id', options.device);
    const response = await request
      .send({ name: options.name ?? 'Cliente Crescimento', email: id.email, phone: id.phone, password: 'SenhaForte123', acceptTerms: true, acceptPrivacy: true, referralCode: options.referralCode })
      .expect(201);
    const address = await ctx.http()
      .post('/v1/me/addresses')
      .set(auth(response.body.accessToken))
      .send({ zipCode: '04571010', street: 'Rua do Crescimento', number: String(100 + Math.floor(Math.random() * 9000)), district: 'Centro', city: CITY, state: 'SP', ...HOME })
      .expect(201);
    const customer = await ctx.prisma.customer.findUniqueOrThrow({ where: { userId: response.body.user.id } });
    return { token: response.body.accessToken as string, userId: response.body.user.id as string, customerId: customer.id, addressId: address.body.id as string, email: id.email };
  }
  type Customer = Awaited<ReturnType<typeof newCustomer>>;

  async function newDriver(name: string, referralCode?: string) {
    const id = uniqueIdentity();
    const response = await ctx.http()
      .post('/v1/auth/register/driver')
      .send({ name, email: id.email, phone: id.phone, password: 'SenhaForte123', cpf: id.cpf, birthDate: '1992-04-04', vehicleType: 'MOTORCYCLE', acceptTerms: true, acceptPrivacy: true, acceptDriverTerms: true, acceptLocationTracking: true, referralCode })
      .expect(201);
    const row = await ctx.prisma.driver.findUniqueOrThrow({ where: { userId: response.body.user.id } });
    await ctx.prisma.driver.update({ where: { id: row.id }, data: { status: 'APPROVED', approvedAt: new Date() } });
    await ctx.prisma.vehicle.update({ where: { id: row.activeVehicleId! }, data: { status: 'APPROVED', plate: `CRS${Math.floor(1000 + Math.random() * 8999)}` } });
    return { token: response.body.accessToken as string, driverId: row.id, userId: response.body.user.id as string, email: id.email, phone: id.phone };
  }

  async function newCompany(name: string, referralCode?: string) {
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
        referralCode,
        company: {
          legalName: `${name} LTDA`,
          tradeName: `${name} ${RUN}`,
          cnpj: identity.cnpj,
          segmentId: segments.body.find((segment: { slug: string }) => segment.slug === 'restaurantes').id,
          email: identity.email,
          phone: '(11) 3000-7000',
          responsibleName: `Dono ${name}`,
          responsibleCpf: owner.cpf,
        },
      })
      .expect(201);
    const result = { token: registered.body.accessToken as string, companyId: registered.body.companyId as string, userId: registered.body.user.id as string };
    await ctx.http()
      .put(`/v1/companies/${result.companyId}/address`)
      .set(auth(result.token))
      .send({ zipCode: '01310100', street: 'Rua da Loja que Cresce', number: '10', district: 'Centro', city: CITY, state: 'SP', ...at(0) })
      .expect(200);
    await ctx.http()
      .put(`/v1/companies/${result.companyId}/opening-hours`)
      .set(auth(result.token))
      .send({ hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: '00:00', closesAt: '23:59' })) })
      .expect(200);
    await ctx.prisma.company.update({ where: { id: result.companyId }, data: { status: 'APPROVED', isOpen: true } });
    return result;
  }

  /** `fromCart`: finaliza o carrinho como está (ex.: montado pelo "pedir de novo"). */
  async function placeOrder(customer: Customer, options: { fromCart?: boolean } = {}) {
    if (!options.fromCart) await ctx.http().post('/v1/cart/items').set(auth(customer.token)).send({ productId, quantity: 2 }).expect(201);
    const order = await ctx.http()
      .post('/v1/orders')
      .set(auth(customer.token))
      .send({ companyId: company.companyId, addressId: customer.addressId, paymentMethod: 'CASH' })
      .expect(201);
    return order.body as { id: string; number: number; deliveryCode: string; subtotalCents: number; discountCents: number };
  }

  /** Fluxo real: loja prepara, entregador aceita, coleta e entrega com o código. */
  async function deliver(orderId: string, code: string) {
    const base = `/v1/companies/${company.companyId}/orders/${orderId}`;
    for (const step of ['confirm', 'prepare', 'ready']) await ctx.http().post(`${base}/${step}`).set(auth(company.token)).expect(201);
    const offer = await waitFor(async () => (await ctx.http().get('/v1/drivers/me/offers').set(auth(driver.token)).expect(200)).body[0] as { id: string } | undefined);
    await ctx.http().post(`/v1/drivers/me/offers/${offer.id}/accept`).set(auth(driver.token)).expect(200);
    const delivery = await ctx.prisma.delivery.findUniqueOrThrow({ where: { orderId } });
    await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/picked-up`).set(auth(driver.token)).expect(204);
    await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/start-route`).set(auth(driver.token)).expect(204);
    await ctx.http().post('/v1/drivers/me/location').set(auth(driver.token)).send({ ...HOME, speed: 3 }).expect(200);
    await ctx.http().post(`/v1/drivers/me/deliveries/${delivery.id}/deliver`).set(auth(driver.token)).send({ method: 'CODE', code }).expect(200);
    await waitFor(async () => (await ctx.prisma.order.findUnique({ where: { id: orderId } }))?.settledAt);
    await ctx.http().post('/v1/drivers/me/location').set(auth(driver.token)).send({ ...at(0.2), speed: 3 }).expect(200);
  }

  const setSetting = (key: string, value: unknown) => ctx.http().put(`/v1/admin/settings/${key}`).set(auth(adminToken)).send({ value }).expect(200);

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await login(ctx, ADMIN, 'ADMIN');
    settings = ctx.app.get(SettingsService);
    const tenantId = (await ctx.prisma.user.findFirstOrThrow({ where: { email: ADMIN.login }, select: { tenantId: true } })).tenantId;
    for (const key of ['loyalty', 'referral'] as const) originals[key] = await settings.get(tenantId, key);

    await setSetting('loyalty', {
      enabled: true,
      pointsPerReal: 1,
      pointValueCents: 1,
      minRedeemPoints: 50,
      expireAfterInactiveDays: 180,
      tiers: [
        { key: 'bronze', name: 'Bronze', minPoints: 0, multiplierBps: 10_000, cashbackBps: 0 },
        { key: 'prata', name: 'Prata', minPoints: 50, multiplierBps: 12_500, cashbackBps: 100 },
        { key: 'ouro', name: 'Ouro', minPoints: 100_000, multiplierBps: 15_000, cashbackBps: 200 },
      ],
    });
    await setSetting('referral', {
      enabled: true,
      windowDays: 30,
      maxPerReferrerPerMonth: 20,
      customer: { enabled: true, referrerRewardCents: 1000, referredRewardCents: 800, minOrderCents: 3000 },
      driver: { enabled: true, referrerRewardCents: 3000, referredRewardCents: 1500, deliveriesRequired: 1 },
      company: { enabled: true, referrerRewardCents: 5000, referredRewardCents: 2500, ordersRequired: 1 },
    });

    // Quem indica: um cliente (código também serve para indicar empresas).
    referrerDevice = newDevice();
    referrer = await newCustomer({ device: referrerDevice, name: 'Maria Indicadora' });
    const mine = await ctx.http().get('/v1/referrals/me?program=CUSTOMER').set(auth(referrer.token)).expect(200);
    referrerCode = mine.body.code;

    company = await newCompany('Loja Crescimento', referrerCode.toLowerCase());
    productId = (await ctx.http().post(`/v1/companies/${company.companyId}/products`).set(auth(company.token)).send({ name: 'Marmita', priceCents: PRICE, weightGrams: 600 }).expect(201)).body.id;

    driverReferrer = await newDriver('Entregador Padrinho');
    const driverCode = (await ctx.http().get('/v1/referrals/me?program=DRIVER').set(auth(driverReferrer.token)).expect(200)).body.code as string;
    driver = await newDriver('Entregador Afilhado', driverCode);
    await ctx.http().post('/v1/drivers/me/availability').set(auth(driver.token)).send({ online: true, ...at(0.2) }).expect(200);

    // Cupom exclusivo do nível Prata (listado no app para todos, usável só a partir do nível).
    await ctx.http().post('/v1/admin/finance/coupons').set(auth(adminToken)).send({ code: `PRATA${RUN}`, type: 'PERCENT', percentBps: 1000, visibility: 'TIER', minTier: 'prata' }).expect(201);
  });

  afterAll(async () => {
    await ctx.prisma.driver.update({ where: { id: driver.driverId }, data: { availability: 'OFFLINE' } });
    for (const [key, value] of Object.entries(originals)) await setSetting(key, value);
    await ctx.app.close();
  });

  // ---------------------------------------------------------------------------
  // Home, favoritos e cupons
  // ---------------------------------------------------------------------------

  it('favoritas, cupons listados (públicos e de nível) e promoções da loja aparecem na Home', async () => {
    const customer = await newCustomer();
    await ctx.http().put(`/v1/me/favorites/${company.companyId}`).set(auth(customer.token)).expect(204);
    await ctx.http().put(`/v1/me/favorites/${company.companyId}`).set(auth(customer.token)).expect(204); // idempotente
    await ctx.http().put(`/v1/me/favorites/00000000-0000-7000-8000-000000000000`).set(auth(customer.token)).expect(404);
    expect((await ctx.http().get('/v1/me/favorites/ids').set(auth(customer.token)).expect(200)).body).toEqual([company.companyId]);

    const suffix = RUN;
    await ctx.http().post(`/v1/companies/${company.companyId}/coupons`).set(auth(company.token)).send({ code: `LOJA${suffix}`, type: 'FIXED', amountCents: 300, visibility: 'PUBLIC' }).expect(201);
    await ctx.http().post('/v1/admin/finance/coupons').set(auth(adminToken)).send({ code: `TODOS${suffix}`, type: 'FREE_DELIVERY', visibility: 'PUBLIC' }).expect(201);
    await ctx.http().post('/v1/admin/finance/coupons').set(auth(adminToken)).send({ code: `SEGREDO${suffix}`, type: 'FIXED', amountCents: 500 }).expect(201);
    await ctx.http().post('/v1/admin/finance/coupons').set(auth(adminToken)).send({ code: `NIVEL${suffix}`, type: 'PERCENT', percentBps: 1000, visibility: 'TIER' }).expect(400);

    const home = await ctx.http().get(`/v1/me/home?addressId=${customer.addressId}`).set(auth(customer.token)).expect(200);
    expect(home.body.favorites.map((store: { id: string }) => store.id)).toEqual([company.companyId]);
    expect(home.body.favorites[0]).toMatchObject({ covered: true, isOpenNow: true });
    const promo = home.body.promotions.find((row: { store: { id: string } }) => row.store.id === company.companyId);
    expect(promo.coupons.map((coupon: { code: string }) => coupon.code)).toContain(`LOJA${suffix}`);
    const codes = home.body.coupons.map((coupon: { code: string }) => coupon.code);
    expect(codes).toContain(`TODOS${suffix}`);
    expect(codes).not.toContain(`SEGREDO${suffix}`);
    const tierCoupon = home.body.coupons.find((coupon: { code: string }) => coupon.code === `PRATA${suffix}`);
    expect(tierCoupon).toMatchObject({ locked: 'Exclusivo do nível Prata', minTierName: 'Prata' });
    expect(home.body.loyalty).toMatchObject({ points: 0, tier: { key: 'bronze' } });
    expect(home.body.referral).toEqual({ referrerRewardCents: 1000, referredRewardCents: 800 });

    // Cupom de nível recusado no checkout para quem está abaixo do nível.
    await ctx.http().post('/v1/cart/items').set(auth(customer.token)).send({ productId, quantity: 2 }).expect(201);
    const quote = await ctx.http().post('/v1/orders/quote').set(auth(customer.token)).send({ companyId: company.companyId, addressId: customer.addressId, couponCode: `PRATA${suffix}` }).expect(201);
    expect(quote.body.issues.join(' ')).toContain('Cupom exclusivo para clientes Prata');
    await ctx.prisma.cart.deleteMany({ where: { customerId: customer.customerId } });

    await ctx.http().delete(`/v1/me/favorites/${company.companyId}`).set(auth(customer.token)).expect(204);
    expect((await ctx.http().get('/v1/me/favorites').set(auth(customer.token)).expect(200)).body).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Pedido entregue: fidelidade + indicação (cliente, entregador e empresa)
  // ---------------------------------------------------------------------------

  it('pedido entregue gera pontos, sobe o nível e paga as três indicações; pedir de novo refaz o carrinho', async () => {
    const buyer = await newCustomer({ referralCode: referrerCode, device: newDevice(), name: 'Joana Indicada' });
    const referrals = await ctx.prisma.referral.findMany({ where: { referrerUserId: { in: [referrer.userId, driverReferrer.userId] } } });
    expect(referrals.map((row) => row.program).sort()).toEqual(['COMPANY', 'CUSTOMER', 'DRIVER']);
    expect(referrals.every((row) => row.status === 'PENDING')).toBe(true);

    const order = await placeOrder(buyer);
    expect(order.subtotalCents).toBe(2 * PRICE);
    await deliver(order.id, order.deliveryCode);

    // Fidelidade: 60 pontos (R$ 60 × 1) → nível Prata.
    const account = await waitFor(() => ctx.prisma.loyaltyAccount.findFirst({ where: { customerId: buyer.customerId, points: { gt: 0 } } }));
    expect(account).toMatchObject({ points: 60, lifetimePoints: 60, tier: 'prata' });
    const summary = await ctx.http().get('/v1/me/loyalty').set(auth(buyer.token)).expect(200);
    expect(summary.body).toMatchObject({ enabled: true, points: 60, redeemableCents: 60, tier: { key: 'prata' }, next: { tier: { key: 'ouro' } } });
    expect(summary.body.recent[0]).toMatchObject({ type: 'EARN', points: 60 });
    await waitFor(() => ctx.prisma.notification.findFirst({ where: { userId: buyer.userId, type: 'loyalty.earned', title: 'Você agora é Prata!' } }));

    // Indicações pagas nas carteiras certas; custo lançado na plataforma.
    await waitFor(async () => (await ctx.prisma.referral.count({ where: { referrerUserId: { in: [referrer.userId, driverReferrer.userId] }, status: 'REWARDED' } })) === 3);
    const credits = await ctx.prisma.walletTransaction.findMany({ where: { referenceKey: { in: referrals.flatMap((row) => [`referral:${row.id}:referrer`, `referral:${row.id}:referred`]) } }, include: { wallet: true } });
    const byOwner = (type: string, id: string) => credits.filter((row) => row.wallet.ownerType === type && [row.wallet.customerId, row.wallet.driverId, row.wallet.companyId].includes(id)).reduce((sum, row) => sum + row.amountCents, 0);
    expect(byOwner('CUSTOMER', referrer.customerId)).toBe(1000 + 5000); // cliente + empresa indicados pela mesma pessoa
    expect(byOwner('CUSTOMER', buyer.customerId)).toBe(800);
    expect(byOwner('DRIVER', driverReferrer.driverId)).toBe(3000);
    expect(byOwner('DRIVER', driver.driverId)).toBe(1500);
    expect(byOwner('COMPANY', company.companyId)).toBe(2500);
    const platform = await ctx.prisma.walletTransaction.findMany({ where: { referenceKey: { in: referrals.map((row) => `referral:${row.id}:platform`) } } });
    expect(platform.reduce((sum, row) => sum + row.amountCents, 0)).toBe(-(1000 + 800 + 3000 + 1500 + 5000 + 2500));

    const mine = await ctx.http().get('/v1/referrals/me?program=CUSTOMER').set(auth(referrer.token)).expect(200);
    expect(mine.body.stats).toMatchObject({ rewarded: 2, earnedCents: 6000 });
    expect(mine.body.referrals.map((row: { name: string }) => row.name)).toContain('Joana'); // só o primeiro nome

    // Pedidos recentes e "pedir de novo".
    const home = await ctx.http().get(`/v1/me/home?addressId=${buyer.addressId}`).set(auth(buyer.token)).expect(200);
    expect(home.body.recentOrders[0]).toMatchObject({ id: order.id, status: 'DELIVERED', summary: '2x Marmita' });
    expect(home.body.coupons.find((coupon: { code: string }) => coupon.code === `PRATA${RUN}`)?.locked).toBeNull();
    const again = await ctx.http().post(`/v1/me/orders/${order.id}/reorder`).set(auth(buyer.token)).expect(200);
    expect(again.body).toMatchObject({ added: 1, skipped: [] });
    expect(again.body.cart.items[0]).toMatchObject({ quantity: 2 });

    // Segundo pedido já no nível Prata: 1,25x pontos e 1% de cashback na carteira (idempotente).
    const second = await placeOrder(buyer, { fromCart: true });
    expect(second.subtotalCents).toBe(2 * PRICE);
    await ctx.prisma.order.update({ where: { id: second.id }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
    const loyalty = ctx.app.get(LoyaltyService);
    expect(await loyalty.earnForOrder(second.id)).toEqual({ points: 75, cashbackCents: 60 });
    expect(await loyalty.earnForOrder(second.id)).toBeNull();
    const cashback = await ctx.prisma.walletTransaction.findUniqueOrThrow({ where: { referenceKey: `order:${second.id}:cashback` }, include: { wallet: true } });
    expect(cashback).toMatchObject({ amountCents: 60, type: 'CREDIT', status: 'AVAILABLE' });
    expect(cashback.wallet.customerId).toBe(buyer.customerId);

    // Resgate: mínimo, saldo insuficiente e crédito na carteira.
    await ctx.http().post('/v1/me/loyalty/redeem').set(auth(buyer.token)).send({ points: 10 }).expect(400);
    await ctx.http().post('/v1/me/loyalty/redeem').set(auth(buyer.token)).send({ points: 1000 }).expect(400);
    const redeemed = await ctx.http().post('/v1/me/loyalty/redeem').set(auth(buyer.token)).send({ points: 100 }).expect(200);
    expect(redeemed.body.creditedCents).toBe(100);
    expect(redeemed.body.summary.points).toBe(35);
    const wallet = await ctx.http().get('/v1/customers/me/wallet').set(auth(buyer.token)).expect(200);
    expect(wallet.body.availableCents).toBeGreaterThanOrEqual(800 + 60 + 100);

    // Painel: ajuste manual auditado e expiração por inatividade.
    await ctx.http().post(`/v1/admin/growth/loyalty/accounts/${buyer.customerId}/adjust`).set(auth(adminToken)).send({ points: -500, reason: 'Teste de débito' }).expect(400);
    await ctx.http().post(`/v1/admin/growth/loyalty/accounts/${buyer.customerId}/adjust`).set(auth(adminToken)).send({ points: 15, reason: 'Compensação por atraso' }).expect(201);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'loyalty.adjust', entityId: buyer.customerId } })).toBe(1);
    const overview = await ctx.http().get('/v1/admin/growth/loyalty').set(auth(adminToken)).expect(200);
    expect(overview.body.tiers.find((tier: { key: string }) => tier.key === 'prata').customers).toBeGreaterThanOrEqual(1);
    await ctx.prisma.loyaltyAccount.update({ where: { customerId: buyer.customerId }, data: { lastEarnedAt: new Date(Date.now() - 200 * 86_400_000) } });
    await loyalty.daily();
    expect((await ctx.prisma.loyaltyAccount.findUniqueOrThrow({ where: { customerId: buyer.customerId } })).points).toBe(0);
    expect(await ctx.prisma.loyaltyTransaction.findFirst({ where: { customerId: buyer.customerId, type: 'EXPIRE' } })).toMatchObject({ points: -50 });
  });

  // ---------------------------------------------------------------------------
  // Indicação: validação, antifraude e supervisão
  // ---------------------------------------------------------------------------

  it('código inválido recusa o cadastro; mesmo aparelho segura a recompensa até a equipe aprovar', async () => {
    const valid = await ctx.http().get(`/v1/referrals/validate?code=${referrerCode}`).expect(200);
    expect(valid.body).toMatchObject({ valid: true, referredRewardCents: 800 });
    expect(JSON.stringify(valid.body)).not.toContain('Maria');
    expect((await ctx.http().get('/v1/referrals/validate?code=NAOEXISTE').expect(200)).body.valid).toBe(false);

    const id = uniqueIdentity();
    await ctx.http()
      .post('/v1/auth/register/customer')
      .send({ name: 'Código Errado', email: id.email, phone: id.phone, password: 'SenhaForte123', acceptTerms: true, acceptPrivacy: true, referralCode: 'NAOEXISTE' })
      .expect(400);
    expect(await ctx.prisma.user.count({ where: { email: id.email } })).toBe(0);

    // Mesmo aparelho de quem indicou.
    const suspicious = await newCustomer({ referralCode: referrerCode, device: referrerDevice, name: 'Conta Suspeita' });
    const referral = await ctx.prisma.referral.findFirstOrThrow({ where: { referredUserId: suspicious.userId } });
    await waitFor(() => ctx.prisma.deviceSighting.findFirst({ where: { userId: suspicious.userId } }));
    const referrals = ctx.app.get(ReferralsService);
    expect(await referrals.qualify(referral)).toBe('HELD');
    expect(await ctx.prisma.referral.findUniqueOrThrow({ where: { id: referral.id } })).toMatchObject({ status: 'REJECTED' });
    const signal = await waitFor(() => ctx.prisma.riskSignal.findFirst({ where: { userId: suspicious.userId, type: 'REFERRAL_ABUSE' } }));
    expect(signal.relatedUserIds).toContain(referrer.userId);
    expect(await ctx.prisma.walletTransaction.count({ where: { referenceKey: { startsWith: `referral:${referral.id}` } } })).toBe(0);

    // A equipe revisa e libera (com registro na auditoria).
    const list = await ctx.http().get('/v1/admin/growth/referrals/list?status=REJECTED').set(auth(adminToken)).expect(200);
    expect(list.body.data.some((row: { id: string }) => row.id === referral.id)).toBe(true);
    await ctx.http().post(`/v1/admin/growth/referrals/${referral.id}/approve`).set(auth(adminToken)).send({ note: 'Irmãos no mesmo celular, conferido por telefone' }).expect(201);
    expect(await ctx.prisma.referral.findUniqueOrThrow({ where: { id: referral.id } })).toMatchObject({ status: 'REWARDED' });
    expect(await ctx.prisma.walletTransaction.count({ where: { referenceKey: { startsWith: `referral:${referral.id}` } } })).toBe(3);
    await ctx.http().post(`/v1/admin/growth/referrals/${referral.id}/approve`).set(auth(adminToken)).send({ note: 'de novo' }).expect(409);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'referral.approve', entityId: referral.id } })).toBe(1);

    // Prazo vencido expira a indicação pendente.
    const late = await newCustomer({ referralCode: referrerCode, device: newDevice() });
    const pending = await ctx.prisma.referral.findFirstOrThrow({ where: { referredUserId: late.userId } });
    await ctx.prisma.referral.update({ where: { id: pending.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await referrals.expire();
    expect((await ctx.prisma.referral.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('EXPIRED');
  });

  // ---------------------------------------------------------------------------
  // Frota própria
  // ---------------------------------------------------------------------------

  it('empresa convida entregador para a frota; ele aceita, sai, recusa; empresa cancela e remove', async () => {
    const member = await newDriver('Entregador da Frota');
    const fleetUrl = `/v1/companies/${company.companyId}/fleet`;

    await ctx.http().post(`${fleetUrl}/invitations`).set(auth(company.token)).send({ login: 'ninguem@levoja.test' }).expect(404);
    const invitation = await ctx.http().post(`${fleetUrl}/invitations`).set(auth(company.token)).send({ login: member.email, message: 'Venha para a nossa equipe' }).expect(201);
    await ctx.http().post(`${fleetUrl}/invitations`).set(auth(company.token)).send({ login: member.phone }).expect(409);
    await waitFor(() => ctx.prisma.notification.findFirst({ where: { userId: member.userId, type: 'fleet.invitation' } }));

    const view = await ctx.http().get('/v1/drivers/me/fleet').set(auth(member.token)).expect(200);
    expect(view.body.company).toBeNull();
    expect(view.body.invitations[0]).toMatchObject({ id: invitation.body.id, message: 'Venha para a nossa equipe', company: { id: company.companyId } });

    await ctx.http().post(`/v1/drivers/me/fleet/invitations/${invitation.body.id}`).set(auth(member.token)).send({ action: 'accept' }).expect(200);
    expect(await ctx.prisma.driver.findUniqueOrThrow({ where: { id: member.driverId } })).toMatchObject({ fleetType: 'COMPANY', fleetCompanyId: company.companyId });
    const companyView = await ctx.http().get(fleetUrl).set(auth(company.token)).expect(200);
    const listed = companyView.body.drivers.find((row: { driverId: string }) => row.driverId === member.driverId);
    expect(listed.name).toBe('Entregador da Frota');
    expect(listed.phone).toContain('•••••');
    expect(JSON.stringify(companyView.body)).not.toContain(member.phone.slice(-8));

    // Outra empresa não consegue convidar quem já está numa frota.
    const other = await newCompany('Outra Loja');
    await ctx.http().post(`/v1/companies/${other.companyId}/fleet/invitations`).set(auth(other.token)).send({ login: member.email }).expect(409);
    await ctx.http().get(fleetUrl).set(auth(other.token)).expect(403);

    // Sai, recusa um novo convite, e a empresa cancela o seguinte.
    await ctx.http().post('/v1/drivers/me/fleet/leave').set(auth(member.token)).expect(200);
    expect((await ctx.prisma.driver.findUniqueOrThrow({ where: { id: member.driverId } })).fleetType).toBe('PLATFORM');
    const second = await ctx.http().post(`${fleetUrl}/invitations`).set(auth(company.token)).send({ login: member.email }).expect(201);
    await ctx.http().post(`/v1/drivers/me/fleet/invitations/${second.body.id}`).set(auth(member.token)).send({ action: 'decline' }).expect(200);
    expect((await ctx.prisma.fleetInvitation.findUniqueOrThrow({ where: { id: second.body.id } })).status).toBe('DECLINED');
    const third = await ctx.http().post(`${fleetUrl}/invitations`).set(auth(company.token)).send({ login: member.email }).expect(201);
    await ctx.http().post(`${fleetUrl}/invitations/${third.body.id}/cancel`).set(auth(company.token)).expect(204);
    await ctx.http().post(`/v1/drivers/me/fleet/invitations/${third.body.id}`).set(auth(member.token)).send({ action: 'accept' }).expect(404);

    // Aceita de novo e a empresa remove.
    const fourth = await ctx.http().post(`${fleetUrl}/invitations`).set(auth(company.token)).send({ login: member.email }).expect(201);
    await ctx.http().post(`/v1/drivers/me/fleet/invitations/${fourth.body.id}`).set(auth(member.token)).send({ action: 'accept' }).expect(200);
    await ctx.http().delete(`${fleetUrl}/drivers/${member.driverId}`).set(auth(company.token)).expect(204);
    expect((await ctx.prisma.driver.findUniqueOrThrow({ where: { id: member.driverId } })).fleetType).toBe('PLATFORM');
    await waitFor(() => ctx.prisma.notification.findFirst({ where: { userId: member.userId, type: 'fleet.removed' } }));
  });
});
