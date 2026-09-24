import { createTestApp, login, ADMIN, SAMPLE_PDF, SAMPLE_PNG, TestContext, uniqueIdentity } from './utils';

/**
 * Fase 2 — Marketplace: catálogo, áreas de atendimento, vitrine, carrinho, checkout e ciclo do pedido.
 */
describe('Fase 2 — Marketplace (E2E)', () => {
  let ctx: TestContext;
  let adminToken: string;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  // Loja em São Paulo (Av. Paulista) e endereços de clientes próximos/distantes.
  const STORE = { lat: -23.5614, lng: -46.6559 };
  const NEAR = { lat: -23.5587, lng: -46.6612 }; // ~0,6 km
  const FAR = { lat: -22.9068, lng: -43.1729 }; // Rio de Janeiro

  let owner: { token: string; companyId: string; slug: string };
  let customer: { token: string; userId: string; addressId: string };
  const products: Record<string, string> = {};

  async function createApprovedCompany(name: string) {
    const segments = await ctx.http().get('/v1/segments').expect(200);
    const person = uniqueIdentity();
    const company = uniqueIdentity();
    const response = await ctx.http()
      .post('/v1/auth/register/company')
      .send({
        name: `Dono ${name}`,
        email: person.email,
        phone: person.phone,
        password: 'SenhaForte123',
        cpf: person.cpf,
        acceptTerms: true,
        acceptPrivacy: true,
        acceptCompanyTerms: true,
        company: {
          legalName: `${name} LTDA`,
          tradeName: name,
          cnpj: company.cnpj,
          segmentId: segments.body.find((s: { slug: string }) => s.slug === 'mercado').id,
          email: company.email,
          phone: '(11) 3333-4444',
          responsibleName: `Dono ${name}`,
          responsibleCpf: person.cpf,
        },
      })
      .expect(201);
    const { accessToken, companyId } = response.body;
    await ctx.http()
      .put(`/v1/companies/${companyId}/address`)
      .set(auth(accessToken))
      .send({ zipCode: '01310100', street: 'Av. Paulista', number: '1000', district: 'Bela Vista', city: 'São Paulo', state: 'SP', ...STORE })
      .expect(200);
    await ctx.http()
      .put(`/v1/companies/${companyId}/opening-hours`)
      .set(auth(accessToken))
      .send({ hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: '00:00', closesAt: '23:59' })) })
      .expect(200);
    // O fluxo de aprovação é coberto na Fase 1; aqui aprovamos diretamente.
    const approved = await ctx.prisma.company.update({ where: { id: companyId }, data: { status: 'APPROVED', approvedAt: new Date(), isOpen: true } });
    return { token: accessToken as string, companyId: companyId as string, slug: approved.slug };
  }

  async function createCustomer(point = NEAR, extra: Record<string, unknown> = {}) {
    const id = uniqueIdentity();
    const response = await ctx.http()
      .post('/v1/auth/register/customer')
      .send({ name: 'Cliente Marketplace', email: id.email, phone: id.phone, password: 'SenhaForte123', acceptTerms: true, acceptPrivacy: true, ...extra })
      .expect(201);
    const token = response.body.accessToken as string;
    const address = await ctx.http()
      .post('/v1/me/addresses')
      .set(auth(token))
      .send({ zipCode: '01310200', street: 'Rua Augusta', number: '500', district: 'Consolação', city: 'São Paulo', state: 'SP', ...point })
      .expect(201);
    return { token, userId: response.body.user.id as string, addressId: address.body.id as string };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await login(ctx, ADMIN, 'ADMIN');
    owner = await createApprovedCompany(`Mercado Teste ${Date.now()}`);
    customer = await createCustomer();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('Catálogo da empresa', () => {
    it('cria categorias, produtos com variações, combo e produtos regulados', async () => {
      const base = `/v1/companies/${owner.companyId}`;
      const bebidas = await ctx.http().post(`${base}/categories`).set(auth(owner.token)).send({ name: 'Bebidas', sortOrder: 1 }).expect(201);
      const lanches = await ctx.http().post(`${base}/categories`).set(auth(owner.token)).send({ name: 'Lanches', sortOrder: 0 }).expect(201);

      const refri = await ctx.http()
        .post(`${base}/products`)
        .set(auth(owner.token))
        .send({ name: 'Refrigerante lata', categoryId: bebidas.body.id, priceCents: 600, trackStock: true, stockQuantity: 10, weightGrams: 350, sku: 'REF-01' })
        .expect(201);
      expect(refri.body).toMatchObject({ effectivePriceCents: 600, available: true, stockQuantity: 10 });
      products.refri = refri.body.id;

      // Promoção vigente
      const promo = await ctx.http()
        .patch(`${base}/products/${products.refri}`)
        .set(auth(owner.token))
        .send({ promoPriceCents: 500, promoStartsAt: new Date(Date.now() - 60_000).toISOString(), promoEndsAt: new Date(Date.now() + 3_600_000).toISOString() })
        .expect(200);
      expect(promo.body).toMatchObject({ effectivePriceCents: 500, onSale: true });
      await ctx.http().patch(`${base}/products/${products.refri}`).set(auth(owner.token)).send({ promoPriceCents: 700 }).expect(400);

      const lanche = await ctx.http()
        .post(`${base}/products`)
        .set(auth(owner.token))
        .send({
          name: 'Sanduíche',
          categoryId: lanches.body.id,
          priceCents: 2500,
          optionGroups: [
            { name: 'Tamanho', minSelect: 1, maxSelect: 1, options: [{ name: 'Normal' }, { name: 'Grande', priceDeltaCents: 800 }] },
            { name: 'Adicionais', minSelect: 0, maxSelect: 2, options: [{ name: 'Queijo', priceDeltaCents: 300 }, { name: 'Bacon', priceDeltaCents: 400 }, { name: 'Ovo', priceDeltaCents: 200 }] },
          ],
        })
        .expect(201);
      products.lanche = lanche.body.id;
      products.grande = lanche.body.optionGroups[0].options[1].id;
      products.normal = lanche.body.optionGroups[0].options[0].id;
      products.queijo = lanche.body.optionGroups[1].options[0].id;
      products.bacon = lanche.body.optionGroups[1].options[1].id;
      products.ovo = lanche.body.optionGroups[1].options[2].id;

      const combo = await ctx.http()
        .post(`${base}/products`)
        .set(auth(owner.token))
        .send({ name: 'Combo lanche + 2 refri', type: 'COMBO', priceCents: 3200, comboItems: [{ productId: products.refri, quantity: 2 }] })
        .expect(201);
      products.combo = combo.body.id;
      await ctx.http()
        .post(`${base}/products`)
        .set(auth(owner.token))
        .send({ name: 'Combo inválido', type: 'COMBO', priceCents: 100, comboItems: [{ productId: products.combo, quantity: 1 }] })
        .expect(400);

      products.cerveja = (
        await ctx.http().post(`${base}/products`).set(auth(owner.token)).send({ name: 'Cerveja', priceCents: 800, minimumAge: 18, isRegulated: true }).expect(201)
      ).body.id;
      products.remedio = (
        await ctx.http().post(`${base}/products`).set(auth(owner.token)).send({ name: 'Antibiótico', priceCents: 3000, isRegulated: true, requiresPrescription: true }).expect(201)
      ).body.id;
      products.inativo = (
        await ctx.http().post(`${base}/products`).set(auth(owner.token)).send({ name: 'Fora de linha', priceCents: 100, status: 'INACTIVE' }).expect(201)
      ).body.id;

      const withImage = await ctx.http().post(`${base}/products/${products.refri}/images`).set(auth(owner.token)).attach('file', SAMPLE_PNG, 'refri.png').expect(201);
      expect(withImage.body.images).toHaveLength(1);

      const stock = await ctx.http().post(`${base}/products/${products.refri}/stock`).set(auth(owner.token)).send({ delta: 5, reason: 'Compra' }).expect(201);
      expect(stock.body.stockQuantity).toBe(15);
      await ctx.http().post(`${base}/products/${products.refri}/stock`).set(auth(owner.token)).send({ delta: -100 }).expect(409);

      const lowStock = await ctx.http().get(`${base}/products?lowStock=true`).set(auth(owner.token)).expect(200);
      expect(lowStock.body.data.every((p: { stockQuantity: number }) => p.stockQuantity <= 5)).toBe(true);

      // Alteração de preço registrada na auditoria (valor anterior e novo)
      const audit = await ctx.http().get(`/v1/admin/audit-logs?entityType=Product&entityId=${products.refri}`).set(auth(adminToken)).expect(200);
      expect(audit.body.data.some((row: { action: string; after: { promoPriceCents?: number } }) => row.action === 'catalog.product.update' && row.after?.promoPriceCents === 500)).toBe(true);
    });

    it('cliente não gerencia catálogo de outra empresa', async () => {
      await ctx.http().post(`/v1/companies/${owner.companyId}/products`).set(auth(customer.token)).send({ name: 'X', priceCents: 1 }).expect(403);
    });
  });

  describe('Vitrine e áreas de atendimento', () => {
    it('lista a loja para endereços dentro da área e oculta para fora', async () => {
      await ctx.http()
        .post(`/v1/companies/${owner.companyId}/service-areas`)
        .set(auth(owner.token))
        .send({ name: 'Raio 5 km', type: 'RADIUS', radiusKm: 5 })
        .expect(201);
      const near = await ctx.http().get(`/v1/stores?lat=${NEAR.lat}&lng=${NEAR.lng}&pageSize=100`).expect(200);
      const found = near.body.data.find((store: { id: string }) => store.id === owner.companyId);
      expect(found).toMatchObject({ isOpenNow: true });
      expect(found.distanceKm).toBeLessThan(1.5);
      const far = await ctx.http().get(`/v1/stores?lat=${FAR.lat}&lng=${FAR.lng}&pageSize=100`).expect(200);
      expect(far.body.data.some((store: { id: string }) => store.id === owner.companyId)).toBe(false);
      const saved = await ctx.http().get(`/v1/stores?addressId=${customer.addressId}&pageSize=100`).set(auth(customer.token)).expect(200);
      expect(saved.body.data.some((store: { id: string }) => store.id === owner.companyId)).toBe(true);
    });

    it('exibe a loja com categorias e somente produtos ativos', async () => {
      const store = await ctx.http().get(`/v1/stores/${owner.slug}`).expect(200);
      const names = [...store.body.categories.flatMap((c: { products: { name: string }[] }) => c.products), ...store.body.uncategorized].map((p: { name: string }) => p.name);
      expect(names).toEqual(expect.arrayContaining(['Refrigerante lata', 'Sanduíche', 'Cerveja']));
      expect(names).not.toContain('Fora de linha');
      expect(store.body.categories[0].name).toBe('Lanches');
    });
  });

  describe('Carrinho e checkout', () => {
    it('valida opções, soma linhas iguais e calcula o preço', async () => {
      await ctx.http().post('/v1/cart/items').set(auth(customer.token)).send({ productId: products.lanche, quantity: 1 }).expect(400);
      await ctx.http()
        .post('/v1/cart/items')
        .set(auth(customer.token))
        .send({ productId: products.lanche, quantity: 1, optionIds: [products.grande, products.queijo, products.bacon, products.ovo] })
        .expect(400);
      await ctx.http().post('/v1/cart/items').set(auth(customer.token)).send({ productId: products.inativo, quantity: 1 }).expect(400);

      await ctx.http().post('/v1/cart/items').set(auth(customer.token)).send({ productId: products.lanche, quantity: 1, optionIds: [products.grande, products.queijo] }).expect(201);
      const cart = await ctx.http().post('/v1/cart/items').set(auth(customer.token)).send({ productId: products.lanche, quantity: 1, optionIds: [products.queijo, products.grande] }).expect(201);
      expect(cart.body.items).toHaveLength(1);
      // (2500 + 800 + 300) x 2
      expect(cart.body.items[0]).toMatchObject({ quantity: 2, unitPriceCents: 3600, totalCents: 7200 });

      const withRefri = await ctx.http().post('/v1/cart/items').set(auth(customer.token)).send({ productId: products.refri, quantity: 2 }).expect(201);
      expect(withRefri.body.subtotalCents).toBe(7200 + 1000);
    });

    it('cota frete, taxas e prazo; recusa pagamento indisponível e troco insuficiente', async () => {
      const quote = await ctx.http()
        .post('/v1/orders/quote')
        .set(auth(customer.token))
        .send({ companyId: owner.companyId, addressId: customer.addressId, tipCents: 300 })
        .expect(201);
      expect(quote.body.canCheckout).toBe(true);
      expect(quote.body.subtotalCents).toBe(8200);
      expect(quote.body.deliveryFeeCents).toBeGreaterThanOrEqual(599);
      expect(quote.body.totalCents).toBe(quote.body.subtotalCents + quote.body.deliveryFeeCents + quote.body.serviceFeeCents + 300);
      expect(new Date(quote.body.estimatedDeliveryAt).getTime()).toBeGreaterThan(Date.now());

      await ctx.http()
        .post('/v1/orders')
        .set(auth(customer.token))
        .send({ companyId: owner.companyId, addressId: customer.addressId, paymentMethod: 'INVOICE' })
        .expect(422); // faturado é exclusivo de entregas de empresas
      await ctx.http()
        .post('/v1/orders')
        .set(auth(customer.token))
        .send({ companyId: owner.companyId, addressId: customer.addressId, paymentMethod: 'CASH', changeForCents: 1000 })
        .expect(400);
    });

    it('finaliza o pedido: número sequencial, baixa de estoque e carrinho limpo', async () => {
      const before = await ctx.prisma.product.findUniqueOrThrow({ where: { id: products.refri } });
      const order = await ctx.http()
        .post('/v1/orders')
        .set(auth(customer.token))
        .send({ companyId: owner.companyId, addressId: customer.addressId, paymentMethod: 'CASH', changeForCents: 20_000, notes: 'Tocar o interfone' })
        .expect(201);
      expect(order.body).toMatchObject({ status: 'NEW', paymentMethod: 'CASH', canCancel: true, notes: 'Tocar o interfone' });
      expect(order.body.number).toBeGreaterThan(0);
      expect(order.body.deliveryCode).toMatch(/^\d{4}$/);
      expect(order.body.deliveryAddress).toMatchObject({ street: 'Rua Augusta', number: '500' });
      const after = await ctx.prisma.product.findUniqueOrThrow({ where: { id: products.refri } });
      expect(after.stockQuantity).toBe(before.stockQuantity - 2);
      const cart = await ctx.http().get(`/v1/cart/${owner.companyId}`).set(auth(customer.token)).expect(200);
      expect(cart.body.items).toHaveLength(0);

      // A loja vê o pedido com dados mínimos do cliente
      const board = await ctx.http().get(`/v1/companies/${owner.companyId}/orders?scope=active`).set(auth(owner.token)).expect(200);
      const seen = board.body.data.find((row: { id: string }) => row.id === order.body.id);
      expect(seen.customer).toEqual({ firstName: 'Cliente', phoneMasked: expect.stringMatching(/\*{5}/) });
      expect(seen).not.toHaveProperty('deliveryCode');

      // Notificação para a loja
      const notifications = await ctx.http().get('/v1/me/notifications').set(auth(owner.token)).expect(200);
      expect(notifications.body.data.some((n: { type: string }) => n.type === 'company.order.new')).toBe(true);

      // Fluxo da loja até "pronto"
      const base = `/v1/companies/${owner.companyId}/orders/${order.body.id}`;
      await ctx.http().post(`${base}/prepare`).set(auth(owner.token)).expect(409);
      await ctx.http().post(`${base}/confirm`).set(auth(owner.token)).expect(201);
      await ctx.http().post(`${base}/prepare`).set(auth(owner.token)).expect(201);
      await ctx.http().post(`/v1/orders/${order.body.id}/cancel`).set(auth(customer.token)).send({ reason: 'Desisti' }).expect(409);
      const ready = await ctx.http().post(`${base}/ready`).set(auth(owner.token)).expect(201);
      expect(ready.body.status).toBe('READY_FOR_PICKUP');
      expect(ready.body.timeline.map((entry: { status: string }) => entry.status)).toEqual(['NEW', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']);

      // Cancelamento pela loja devolve o estoque
      const stockBefore = (await ctx.prisma.product.findUniqueOrThrow({ where: { id: products.refri } })).stockQuantity;
      await ctx.http().post(`${base}/cancel`).set(auth(owner.token)).send({ reason: 'Falta de entregador' }).expect(201);
      const stockAfter = (await ctx.prisma.product.findUniqueOrThrow({ where: { id: products.refri } })).stockQuantity;
      expect(stockAfter).toBe(stockBefore + 2);
      const customerView = await ctx.http().get(`/v1/orders/${order.body.id}`).set(auth(customer.token)).expect(200);
      expect(customerView.body).toMatchObject({ status: 'CANCELED', canceledBy: 'COMPANY', cancelReason: 'Falta de entregador', deliveryCode: null });
    });

    it('cliente cancela pedido novo; números são sequenciais', async () => {
      await ctx.http().post('/v1/cart/items').set(auth(customer.token)).send({ productId: products.lanche, quantity: 1, optionIds: [products.normal] }).expect(201);
      const first = await ctx.http().post('/v1/orders').set(auth(customer.token)).send({ companyId: owner.companyId, fulfillment: 'PICKUP', paymentMethod: 'CASH' }).expect(201);
      await ctx.http().post('/v1/cart/items').set(auth(customer.token)).send({ productId: products.lanche, quantity: 1, optionIds: [products.normal] }).expect(201);
      const second = await ctx.http().post('/v1/orders').set(auth(customer.token)).send({ companyId: owner.companyId, fulfillment: 'PICKUP', paymentMethod: 'CASH' }).expect(201);
      expect(second.body.number).toBe(first.body.number + 1);
      expect(second.body.deliveryFeeCents).toBe(0);

      const canceled = await ctx.http().post(`/v1/orders/${first.body.id}/cancel`).set(auth(customer.token)).send({ reason: 'Pedi errado' }).expect(201);
      expect(canceled.body.status).toBe('CANCELED');

      // Retirada no balcão com código
      const base = `/v1/companies/${owner.companyId}/orders/${second.body.id}`;
      for (const step of ['confirm', 'prepare', 'ready']) await ctx.http().post(`${base}/${step}`).set(auth(owner.token)).expect(201);
      await ctx.http().post(`${base}/handoff`).set(auth(owner.token)).send({ code: second.body.deliveryCode === '0000' ? '1111' : '0000' }).expect(400);
      const done = await ctx.http().post(`${base}/handoff`).set(auth(owner.token)).send({ code: second.body.deliveryCode }).expect(201);
      expect(done.body.status).toBe('DELIVERED');
    });

    it('estoque insuficiente cancela o checkout inteiro (transação)', async () => {
      await ctx.prisma.product.update({ where: { id: products.refri }, data: { stockQuantity: 1 } });
      await ctx.http().post('/v1/cart/items').set(auth(customer.token)).send({ productId: products.refri, quantity: 3 }).expect(201);
      const ordersBefore = await ctx.prisma.order.count({ where: { companyId: owner.companyId } });
      const failed = await ctx.http().post('/v1/orders').set(auth(customer.token)).send({ companyId: owner.companyId, fulfillment: 'PICKUP', paymentMethod: 'CASH' }).expect(409);
      expect(failed.body.message).toContain('Estoque insuficiente');
      expect(await ctx.prisma.order.count({ where: { companyId: owner.companyId } })).toBe(ordersBefore);
      expect((await ctx.prisma.product.findUniqueOrThrow({ where: { id: products.refri } })).stockQuantity).toBe(1);
      await ctx.http().delete(`/v1/cart/${owner.companyId}`).set(auth(customer.token)).expect(204);
      await ctx.prisma.product.update({ where: { id: products.refri }, data: { stockQuantity: 50 } });
    });

    it('produtos com idade mínima exigem data de nascimento de adulto', async () => {
      const buyer = await createCustomer();
      await ctx.http().post('/v1/cart/items').set(auth(buyer.token)).send({ productId: products.cerveja, quantity: 1 }).expect(201);
      const noBirth = await ctx.http().post('/v1/orders/quote').set(auth(buyer.token)).send({ companyId: owner.companyId, fulfillment: 'PICKUP' }).expect(201);
      expect(noBirth.body.canCheckout).toBe(false);
      expect(noBirth.body.issues.join(' ')).toContain('data de nascimento');
      await ctx.http().patch('/v1/me').set(auth(buyer.token)).send({ birthDate: '2012-05-01' }).expect(200);
      const minor = await ctx.http().post('/v1/orders/quote').set(auth(buyer.token)).send({ companyId: owner.companyId, fulfillment: 'PICKUP' }).expect(201);
      expect(minor.body.issues.join(' ')).toContain('menores de 18');
      await ctx.http().patch('/v1/me').set(auth(buyer.token)).send({ birthDate: '1990-05-01' }).expect(200);
      const order = await ctx.http().post('/v1/orders').set(auth(buyer.token)).send({ companyId: owner.companyId, fulfillment: 'PICKUP', paymentMethod: 'CASH' }).expect(201);
      expect(order.body.requiresIdCheck).toBe(true);
    });

    it('produtos que exigem receita só são vendidos com receita anexada', async () => {
      await ctx.http().post('/v1/cart/items').set(auth(customer.token)).send({ productId: products.remedio, quantity: 1 }).expect(201);
      await ctx.http().post('/v1/orders').set(auth(customer.token)).send({ companyId: owner.companyId, fulfillment: 'PICKUP', paymentMethod: 'CASH' }).expect(422);
      const prescription = await ctx.http().post('/v1/me/prescriptions').set(auth(customer.token)).attach('file', SAMPLE_PDF, 'receita.pdf').expect(201);
      const order = await ctx.http()
        .post('/v1/orders')
        .set(auth(customer.token))
        .send({ companyId: owner.companyId, fulfillment: 'PICKUP', paymentMethod: 'CASH', prescriptionId: prescription.body.id })
        .expect(201);
      expect(order.body.hasPrescription).toBe(true);
      const file = await ctx.http().get(`/v1/companies/${owner.companyId}/orders/${order.body.id}/prescription`).set(auth(owner.token)).expect(200);
      expect(file.headers['content-type']).toBe('application/pdf');
    });

    it('bloqueia checkout com loja pausada ou endereço fora da área', async () => {
      const far = await createCustomer(FAR);
      await ctx.http().post('/v1/cart/items').set(auth(far.token)).send({ productId: products.refri, quantity: 1 }).expect(201);
      const outside = await ctx.http().post('/v1/orders/quote').set(auth(far.token)).send({ companyId: owner.companyId, addressId: far.addressId }).expect(201);
      expect(outside.body.issues).toContain('A loja não entrega no seu endereço.');

      await ctx.http().post(`/v1/companies/${owner.companyId}/open`).set(auth(owner.token)).send({ isOpen: false }).expect(201);
      const closed = await ctx.http().post('/v1/orders/quote').set(auth(far.token)).send({ companyId: owner.companyId, fulfillment: 'PICKUP' }).expect(201);
      expect(closed.body.issues).toContain('A loja não está recebendo pedidos no momento.');
      await ctx.http().post('/v1/orders').set(auth(far.token)).send({ companyId: owner.companyId, fulfillment: 'PICKUP', paymentMethod: 'CASH' }).expect(409);
      await ctx.http().post(`/v1/companies/${owner.companyId}/open`).set(auth(owner.token)).send({ isOpen: true }).expect(201);
    });
  });

  describe('Administração', () => {
    it('lista pedidos, cancela pela plataforma e simula preços', async () => {
      const list = await ctx.http().get(`/v1/admin/orders?companyId=${owner.companyId}`).set(auth(adminToken)).expect(200);
      expect(list.body.meta.total).toBeGreaterThan(0);
      const open = list.body.data.find((order: { status: string }) => order.status === 'NEW');
      const canceled = await ctx.http().post(`/v1/admin/orders/${open.id}/cancel`).set(auth(adminToken)).send({ reason: 'Suspeita de fraude' }).expect(201);
      expect(canceled.body).toMatchObject({ status: 'CANCELED', canceledBy: 'PLATFORM' });

      const simulated = await ctx.http()
        .post('/v1/admin/pricing-rules/simulate')
        .set(auth(adminToken))
        .send({ target: 'CUSTOMER_FEE', distanceKm: 6, durationMin: 20, vehicleType: 'MOTORCYCLE', city: 'São Paulo', state: 'SP' })
        .expect(201);
      expect(simulated.body.totalCents).toBeGreaterThanOrEqual(599 + 4 * 150);

      // Regra específica da cidade com prioridade maior passa a valer
      await ctx.http()
        .post('/v1/admin/pricing-rules')
        .set(auth(adminToken))
        .send({ name: `SP moto ${Date.now()}`, target: 'CUSTOMER_FEE', vehicleType: 'MOTORCYCLE', city: 'Campinas', state: 'SP', priority: 50, baseCents: 1000, perKmCents: 0, minimumCents: 1000 })
        .expect(201);
      const campinas = await ctx.http()
        .post('/v1/admin/pricing-rules/simulate')
        .set(auth(adminToken))
        .send({ target: 'CUSTOMER_FEE', distanceKm: 6, durationMin: 20, vehicleType: 'MOTORCYCLE', city: 'Campinas', state: 'SP' })
        .expect(201);
      expect(campinas.body.lines[0]).toEqual({ label: 'Valor base', cents: 1000 });

      const settings = await ctx.http().put('/v1/admin/settings/marketplace.serviceFee').set(auth(adminToken)).send({ value: { bps: 500, minCents: 100, maxCents: 500 } }).expect(200);
      expect(settings.body).toEqual({ bps: 500, minCents: 100, maxCents: 500 });
      await ctx.http().put('/v1/admin/settings/marketplace.serviceFee').set(auth(adminToken)).send({ value: { bps: -1 } }).expect(400);
      await ctx.http().put('/v1/admin/settings/marketplace.serviceFee').set(auth(adminToken)).send({ value: { bps: 0, minCents: 0, maxCents: null } }).expect(200);
    });
  });
});
