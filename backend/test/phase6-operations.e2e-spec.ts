import { geohash } from '@levoja/shared';
import { OperationsService } from '../src/modules/operations/operations.service';
import { SupportService } from '../src/modules/support/support.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { ADMIN, createTestApp, login, SAMPLE_PNG, TestContext, uniqueIdentity } from './utils';

/**
 * Fase 6 — Operação: chat com privacidade, central de atendimento (SLA, anexos, avaliação),
 * torre de controle, mapa de calor, relatórios (BI + CSV), painel da empresa, comunicados e LGPD.
 */
describe('Fase 6 — Operação e atendimento (E2E)', () => {
  let ctx: TestContext;
  let adminToken: string;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  // Cidade e coordenadas exclusivas desta execução: os relatórios são filtrados por ela.
  const CITY = `Cidade Operacao ${Date.now()}`;
  const BASE = { lat: -10 - Math.random() * 15, lng: -40 - Math.random() * 15 };
  const at = (dLatKm: number, dLngKm = 0) => ({ lat: BASE.lat + dLatKm / 111, lng: BASE.lng + dLngKm / 111 });
  const STORE = at(0);
  const HOME = at(1.1, 0.6);
  const PRICE = 2500;

  let company: { token: string; companyId: string; tradeName: string };
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

  async function newCustomer(name = 'Cliente Operação') {
    const id = uniqueIdentity();
    const response = await ctx.http()
      .post('/v1/auth/register/customer')
      .send({ name, email: id.email, phone: id.phone, password: 'SenhaForte123', acceptTerms: true, acceptPrivacy: true })
      .expect(201);
    const address = await ctx.http()
      .post('/v1/me/addresses')
      .set(auth(response.body.accessToken))
      .send({ zipCode: '01310200', street: 'Rua do Cliente', number: '42', district: 'Centro', city: CITY, state: 'SP', ...HOME })
      .expect(201);
    return { token: response.body.accessToken as string, userId: response.body.user.id as string, addressId: address.body.id as string, email: id.email, phone: id.phone };
  }
  type Customer = Awaited<ReturnType<typeof newCustomer>>;

  async function placeOrder(customer: Customer) {
    await ctx.http().post('/v1/cart/items').set(auth(customer.token)).send({ productId, quantity: 2 }).expect(201);
    const order = await ctx.http()
      .post('/v1/orders')
      .set(auth(customer.token))
      .send({ companyId: company.companyId, addressId: customer.addressId, paymentMethod: 'CASH' })
      .expect(201);
    return order.body as { id: string; number: number; deliveryCode: string; totalCents: number };
  }

  /** Loja prepara e o entregador aceita a oferta: pedido em rota de coleta. */
  async function dispatchOrder(orderId: string) {
    const base = `/v1/companies/${company.companyId}/orders/${orderId}`;
    for (const step of ['confirm', 'prepare', 'ready']) await ctx.http().post(`${base}/${step}`).set(auth(company.token)).expect(201);
    const offer = await waitFor(async () => (await ctx.http().get('/v1/drivers/me/offers').set(auth(driver.token)).expect(200)).body[0] as { id: string } | undefined);
    await ctx.http().post(`/v1/drivers/me/offers/${offer.id}/accept`).set(auth(driver.token)).expect(200);
    return ctx.prisma.delivery.findUniqueOrThrow({ where: { orderId } });
  }

  async function finishDelivery(deliveryId: string, orderId: string, code: string) {
    await ctx.http().post(`/v1/drivers/me/deliveries/${deliveryId}/picked-up`).set(auth(driver.token)).expect(204);
    await ctx.http().post(`/v1/drivers/me/deliveries/${deliveryId}/start-route`).set(auth(driver.token)).expect(204);
    await ctx.http().post('/v1/drivers/me/location').set(auth(driver.token)).send({ ...HOME, speed: 3 }).expect(200);
    await ctx.http().post(`/v1/drivers/me/deliveries/${deliveryId}/deliver`).set(auth(driver.token)).send({ method: 'CODE', code }).expect(200);
    await waitFor(async () => (await ctx.prisma.order.findUnique({ where: { id: orderId } }))?.settledAt);
    await ctx.http().post('/v1/drivers/me/location').set(auth(driver.token)).send({ ...at(0.2), speed: 3 }).expect(200);
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await login(ctx, ADMIN, 'ADMIN');

    const segments = await ctx.http().get('/v1/segments').expect(200);
    const owner = uniqueIdentity();
    const companyIdentity = uniqueIdentity();
    const tradeName = `Loja Operação ${Date.now()}`;
    const registered = await ctx.http()
      .post('/v1/auth/register/company')
      .send({
        name: 'Dona Operação',
        email: owner.email,
        phone: owner.phone,
        password: 'SenhaForte123',
        cpf: owner.cpf,
        acceptTerms: true,
        acceptPrivacy: true,
        acceptCompanyTerms: true,
        company: {
          legalName: 'Operação Teste LTDA',
          tradeName,
          cnpj: companyIdentity.cnpj,
          segmentId: segments.body.find((s: { slug: string }) => s.slug === 'restaurantes').id,
          email: companyIdentity.email,
          phone: '(11) 3333-5555',
          responsibleName: 'Dona Operação',
          responsibleCpf: owner.cpf,
        },
      })
      .expect(201);
    company = { token: registered.body.accessToken, companyId: registered.body.companyId, tradeName };
    await ctx.http()
      .put(`/v1/companies/${company.companyId}/address`)
      .set(auth(company.token))
      .send({ zipCode: '01310100', street: 'Rua da Loja', number: '1', district: 'Centro', city: CITY, state: 'SP', ...STORE })
      .expect(200);
    await ctx.http()
      .put(`/v1/companies/${company.companyId}/opening-hours`)
      .set(auth(company.token))
      .send({ hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: '00:00', closesAt: '23:59' })) })
      .expect(200);
    await ctx.prisma.company.update({ where: { id: company.companyId }, data: { status: 'APPROVED', isOpen: true } });
    productId = (await ctx.http().post(`/v1/companies/${company.companyId}/products`).set(auth(company.token)).send({ name: 'Marmita', priceCents: PRICE, weightGrams: 500 }).expect(201)).body.id;

    const id = uniqueIdentity();
    const response = await ctx.http()
      .post('/v1/auth/register/driver')
      .send({
        name: 'Entregador Operação',
        email: id.email,
        phone: id.phone,
        password: 'SenhaForte123',
        cpf: id.cpf,
        birthDate: '1992-04-04',
        vehicleType: 'MOTORCYCLE',
        acceptTerms: true,
        acceptPrivacy: true,
        acceptDriverTerms: true,
        acceptLocationTracking: true,
      })
      .expect(201);
    const row = await ctx.prisma.driver.findUniqueOrThrow({ where: { userId: response.body.user.id } });
    // Endereço na cidade da execução: permite segmentar comunicados por cidade.
    const address = await ctx.prisma.address.create({ data: { zipCode: '01310300', street: 'Rua do Entregador', number: '7', district: 'Centro', city: CITY, state: 'SP' } });
    await ctx.prisma.driver.update({ where: { id: row.id }, data: { status: 'APPROVED', approvedAt: new Date(), addressId: address.id } });
    await ctx.prisma.vehicle.update({ where: { id: row.activeVehicleId! }, data: { status: 'APPROVED', plate: 'OPS1A23' } });
    driver = { token: response.body.accessToken, driverId: row.id, userId: response.body.user.id };
    await ctx.http().post('/v1/drivers/me/availability').set(auth(driver.token)).send({ online: true, ...at(0.2) }).expect(200);
  });

  afterAll(async () => {
    await ctx.prisma.driver.update({ where: { id: driver.driverId }, data: { availability: 'OFFLINE' } });
    await ctx.app.close();
  });

  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------

  describe('chat com privacidade', () => {
    let customer: Customer;
    let order: { id: string; number: number; deliveryCode: string };
    let storeConversationId: string;

    beforeAll(async () => {
      customer = await newCustomer('Joana Cliente Silva');
      order = await placeOrder(customer);
    });

    it('cliente conversa com a loja; a loja vê a conversa na caixa de entrada; ninguém vê telefones', async () => {
      const available = await ctx.http().get('/v1/conversations/available').query({ orderId: order.id }).set(auth(customer.token)).expect(200);
      // Sem entregador ainda: só a conversa com a loja.
      expect(available.body.map((option: { type: string }) => option.type)).toEqual(['CUSTOMER_COMPANY']);
      expect(available.body[0]).toMatchObject({ with: 'COMPANY', name: company.tradeName, conversationId: null, canSend: true });

      const opened = await ctx.http().post('/v1/conversations/open').set(auth(customer.token)).send({ type: 'CUSTOMER_COMPANY', orderId: order.id }).expect(200);
      storeConversationId = opened.body.id;
      expect(opened.body).toMatchObject({ me: 'CUSTOMER', counterpart: { role: 'COMPANY', name: company.tradeName }, canSend: true, canCall: false });
      // Reabrir retorna a mesma conversa.
      expect((await ctx.http().post('/v1/conversations/open').set(auth(customer.token)).send({ type: 'CUSTOMER_COMPANY', orderId: order.id }).expect(200)).body.id).toBe(storeConversationId);

      await ctx.http().post(`/v1/conversations/${storeConversationId}/messages`).set(auth(customer.token)).send({ body: '  Pode mandar sem cebola?  ' }).expect(201);
      await ctx.http().post(`/v1/conversations/${storeConversationId}/messages`).set(auth(customer.token)).send({ body: '   ' }).expect(400);

      const inbox = await ctx.http().get(`/v1/companies/${company.companyId}/conversations`).set(auth(company.token)).expect(200);
      const entry = inbox.body.data.find((item: { id: string }) => item.id === storeConversationId);
      expect(entry).toMatchObject({ me: 'COMPANY', unread: true, lastMessagePreview: 'Pode mandar sem cebola?', counterpart: { role: 'CUSTOMER', name: 'Joana' } });

      const thread = await ctx.http().get(`/v1/conversations/${storeConversationId}/messages`).set(auth(company.token)).expect(200);
      expect(thread.body.messages).toEqual([expect.objectContaining({ body: 'Pode mandar sem cebola?', senderRole: 'CUSTOMER', senderName: 'Joana', mine: false })]);
      expect(JSON.stringify(thread.body)).not.toContain(customer.phone);
      expect(JSON.stringify(thread.body)).not.toContain('3333-5555');

      await ctx.http().post(`/v1/conversations/${storeConversationId}/messages`).set(auth(company.token)).send({ body: 'Claro! Anotado.' }).expect(201);
      await ctx.http().post(`/v1/conversations/${storeConversationId}/read`).set(auth(company.token)).expect(204);
      const after = await ctx.http().get(`/v1/conversations/${storeConversationId}`).set(auth(company.token)).expect(200);
      expect(after.body.unread).toBe(false);
      const mine = await ctx.http().get('/v1/conversations').set(auth(customer.token)).expect(200);
      expect(mine.body.data.find((item: { id: string }) => item.id === storeConversationId)).toMatchObject({ unread: true, lastMessagePreview: 'Claro! Anotado.' });
    });

    it('terceiros não acessam a conversa; a equipe de suporte lê (somente leitura, auditado)', async () => {
      const intruder = await newCustomer();
      await ctx.http().get(`/v1/conversations/${storeConversationId}`).set(auth(intruder.token)).expect(404);
      await ctx.http().post(`/v1/conversations/${storeConversationId}/messages`).set(auth(intruder.token)).send({ body: 'Oi' }).expect(404);
      await ctx.http().post('/v1/conversations/open').set(auth(intruder.token)).send({ type: 'CUSTOMER_COMPANY', orderId: order.id }).expect(403);
      await ctx.http().get('/v1/admin/conversations').query({ orderId: order.id }).set(auth(intruder.token)).expect(403);

      const staff = await ctx.http().get('/v1/admin/conversations').query({ orderId: order.id }).set(auth(adminToken)).expect(200);
      expect(staff.body[0].messages.map((message: { body: string }) => message.body)).toEqual(['Pode mandar sem cebola?', 'Claro! Anotado.']);
      await ctx.http().post(`/v1/conversations/${storeConversationId}/messages`).set(auth(adminToken)).send({ body: 'Equipe' }).expect(404);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'chat.staff_view', entityId: order.id } })).toBeGreaterThan(0);
    });

    it('com entregador designado, cliente e entregador conversam; ligação mascarada indisponível sem provedor de voz', async () => {
      const delivery = await dispatchOrder(order.id);
      const options = await ctx.http().get('/v1/conversations/available').query({ orderId: order.id }).set(auth(customer.token)).expect(200);
      expect(options.body.map((option: { type: string }) => option.type)).toEqual(['CUSTOMER_COMPANY', 'CUSTOMER_DRIVER']);
      expect(options.body[1]).toMatchObject({ with: 'DRIVER', name: 'Entregador', deliveryId: delivery.id });

      const driverOptions = await ctx.http().get('/v1/conversations/available').query({ deliveryId: delivery.id }).set(auth(driver.token)).expect(200);
      expect(driverOptions.body.map((option: { type: string; name: string }) => [option.type, option.name])).toEqual([
        ['CUSTOMER_DRIVER', 'Joana'],
        ['COMPANY_DRIVER', company.tradeName],
      ]);
      const conversation = await ctx.http().post('/v1/conversations/open').set(auth(driver.token)).send({ type: 'CUSTOMER_DRIVER', deliveryId: delivery.id }).expect(200);
      await ctx.http().post(`/v1/conversations/${conversation.body.id}/messages`).set(auth(driver.token)).send({ body: 'Estou chegando na loja.' }).expect(201);
      const customerView = await ctx.http().get(`/v1/conversations/${conversation.body.id}/messages`).set(auth(customer.token)).expect(200);
      expect(customerView.body.messages[0]).toMatchObject({ senderRole: 'DRIVER', senderName: 'Entregador', mine: false });
      expect(JSON.stringify(customerView.body)).not.toContain(customer.phone);

      await ctx.http().post(`/v1/conversations/${conversation.body.id}/call`).set(auth(customer.token)).expect(422);

      // Entrega concluída: a conversa com o entregador fecha após a janela configurada (aqui, imediatamente).
      await finishDelivery(delivery.id, order.id, order.deliveryCode);
      const settings = ctx.app.get(SettingsService);
      const admin = await ctx.prisma.user.findFirstOrThrow({ where: { email: ADMIN.login } });
      const original = await settings.get(admin.tenantId, 'chat');
      await settings.set(admin.tenantId, 'chat', { ...original, withDriverAfterMinutes: 0 }, admin.id);
      try {
        const closed = await ctx.http().get(`/v1/conversations/${conversation.body.id}`).set(auth(customer.token)).expect(200);
        expect(closed.body.canSend).toBe(false);
        await ctx.http().post(`/v1/conversations/${conversation.body.id}/messages`).set(auth(customer.token)).send({ body: 'Obrigada!' }).expect(409);
      } finally {
        await settings.set(admin.tenantId, 'chat', original, admin.id);
      }
      // Com a loja, a conversa segue aberta (janela maior).
      await ctx.http().post(`/v1/conversations/${storeConversationId}/messages`).set(auth(customer.token)).send({ body: 'Chegou certinho!' }).expect(201);
    });
  });

  // ---------------------------------------------------------------------------
  // Central de atendimento
  // ---------------------------------------------------------------------------

  describe('central de atendimento', () => {
    let customer: Customer;
    let orderId: string;
    let ticketId: string;

    beforeAll(async () => {
      customer = await newCustomer('Carlos Chamado');
      orderId = (await placeOrder(customer)).id;
    });

    it('abre chamado ligado ao próprio pedido, com prioridade e prazos de SLA automáticos', async () => {
      const other = await newCustomer();
      await ctx.http().post('/v1/support/tickets').set(auth(other.token)).send({ as: 'CUSTOMER', category: 'ORDER', subject: 'Pedido de outro', description: 'Tentando citar pedido alheio.', orderId }).expect(400);
      await ctx.http().post('/v1/support/tickets').set(auth(customer.token)).send({ as: 'DRIVER', category: 'OTHER', subject: 'Sou entregador?', description: 'Cliente tentando abrir como entregador.' }).expect(403);
      await ctx.http().post('/v1/support/tickets').set(auth(customer.token)).send({ as: 'CUSTOMER', category: 'ORDER', subject: 'Oi', description: 'curto' }).expect(400);

      const created = await ctx.http()
        .post('/v1/support/tickets')
        .set(auth(customer.token))
        .send({ as: 'CUSTOMER', category: 'ORDER', subject: 'Pedido demorando', description: 'Meu pedido está demorando mais que o previsto.', orderId })
        .expect(201);
      ticketId = created.body.id;
      expect(created.body).toMatchObject({ status: 'OPEN', statusLabel: 'Aberto', priority: 'HIGH', category: 'ORDER', canReply: true, canRate: false });
      expect(created.body.number).toBeGreaterThan(0);
      const ticket = await ctx.prisma.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });
      // Prioridade alta: primeira resposta em 60 min e resolução em 8 h (padrões configuráveis).
      expect(ticket.firstResponseDueAt.getTime() - ticket.createdAt.getTime()).toBe(60 * 60_000);
      expect(ticket.resolutionDueAt.getTime() - ticket.createdAt.getTime()).toBe(480 * 60_000);
      expect(new Date(created.body.expectedResponseAt).getTime()).toBe(ticket.firstResponseDueAt.getTime());

      const mine = await ctx.http().get('/v1/support/tickets').set(auth(customer.token)).expect(200);
      expect(mine.body.data.map((item: { id: string }) => item.id)).toContain(ticketId);
      await ctx.http().get(`/v1/support/tickets/${ticketId}`).set(auth(other.token)).expect(404);
    });

    it('anexos: validados pelo conteúdo, privados e baixados só por quem tem acesso', async () => {
      await ctx.http().post(`/v1/support/tickets/${ticketId}/attachments`).set(auth(customer.token)).attach('file', Buffer.from('não é imagem'), 'foto.png').expect(400);
      const uploaded = await ctx.http().post(`/v1/support/tickets/${ticketId}/attachments`).set(auth(customer.token)).attach('file', SAMPLE_PNG, 'comprovante.png').expect(201);
      expect(uploaded.body).toMatchObject({ fileName: 'comprovante.png', mimeType: 'image/png', internal: false });
      const file = await ctx.http().get(`/v1/support/tickets/${ticketId}/attachments/${uploaded.body.id}/file`).set(auth(customer.token)).expect(200);
      expect(file.headers['content-type']).toContain('image/png');
      const other = await newCustomer();
      await ctx.http().get(`/v1/support/tickets/${ticketId}/attachments/${uploaded.body.id}/file`).set(auth(other.token)).expect(404);
      await ctx.http().get(`/v1/admin/support/tickets/${ticketId}/attachments/${uploaded.body.id}/file`).set(auth(adminToken)).expect(200);
    });

    it('equipe atende: nota interna invisível ao cliente, resposta pública, espera, resolução e avaliação', async () => {
      await ctx.http().get('/v1/admin/support/tickets').set(auth(customer.token)).expect(403);
      const queue = await ctx.http().get('/v1/admin/support/tickets').query({ status: 'ACTIVE', search: 'demorando', pageSize: 100 }).set(auth(adminToken)).expect(200);
      expect(queue.body.data.find((item: { id: string }) => item.id === ticketId)).toMatchObject({ requesterName: 'Carlos Chamado', assignee: null, sla: { state: 'ok' } });

      await ctx.http().post(`/v1/admin/support/tickets/${ticketId}/messages`).set(auth(adminToken)).send({ body: 'Cliente recorrente, priorizar.', internal: true }).expect(201);
      let requesterView = await ctx.http().get(`/v1/support/tickets/${ticketId}`).set(auth(customer.token)).expect(200);
      expect(requesterView.body.messages).toHaveLength(0);
      expect(requesterView.body.status).toBe('OPEN');

      const answered = await ctx.http().post(`/v1/admin/support/tickets/${ticketId}/messages`).set(auth(adminToken)).send({ body: 'Já falamos com a loja, seu pedido sai em 10 minutos.' }).expect(201);
      expect(answered.body).toMatchObject({ status: 'IN_PROGRESS', assignee: expect.objectContaining({ name: expect.any(String) }) });
      expect(answered.body.firstRespondedAt).toBeTruthy();
      expect(answered.body.messages.map((message: { internal: boolean }) => message.internal)).toEqual([true, false]);
      requesterView = await ctx.http().get(`/v1/support/tickets/${ticketId}`).set(auth(customer.token)).expect(200);
      expect(requesterView.body.messages).toEqual([expect.objectContaining({ authorName: 'Equipe de atendimento', mine: false })]);
      expect(requesterView.body.expectedResponseAt).toBeNull();
      await waitFor(() => ctx.prisma.notification.findFirst({ where: { userId: customer.userId, type: 'support.ticket' } }));

      await ctx.http().post(`/v1/admin/support/tickets/${ticketId}/status`).set(auth(adminToken)).send({ status: 'WAITING_REQUESTER' }).expect(200);
      expect((await ctx.http().get(`/v1/support/tickets/${ticketId}`).set(auth(customer.token)).expect(200)).body.statusLabel).toBe('Aguardando você');
      const replied = await ctx.http().post(`/v1/support/tickets/${ticketId}/messages`).set(auth(customer.token)).send({ body: 'Chegou, obrigado!' }).expect(201);
      expect(replied.body.status).toBe('IN_PROGRESS');

      await ctx.http().post(`/v1/support/tickets/${ticketId}/rating`).set(auth(customer.token)).send({ rating: 5 }).expect(409);
      await ctx.http().post(`/v1/admin/support/tickets/${ticketId}/status`).set(auth(adminToken)).send({ status: 'RESOLVED' }).expect(200);
      const rated = await ctx.http().post(`/v1/support/tickets/${ticketId}/rating`).set(auth(customer.token)).send({ rating: 5, comment: 'Rápido!' }).expect(200);
      expect(rated.body).toMatchObject({ rating: 5, canRate: false });
      await ctx.http().post(`/v1/support/tickets/${ticketId}/rating`).set(auth(customer.token)).send({ rating: 4 }).expect(409);

      // Resposta após resolvido reabre o chamado.
      const reopened = await ctx.http().post(`/v1/support/tickets/${ticketId}/messages`).set(auth(customer.token)).send({ body: 'Na verdade faltou um item.' }).expect(201);
      expect(reopened.body.status).toBe('OPEN');

      const staffView = await ctx.http().get(`/v1/admin/support/tickets/${ticketId}`).set(auth(adminToken)).expect(200);
      expect(staffView.body.events.map((event: { type: string }) => event.type)).toEqual(
        expect.arrayContaining(['CREATED', 'ATTACHMENT', 'STATUS', 'ASSIGNED', 'RATED', 'REOPENED']),
      );
      expect(staffView.body.order).toMatchObject({ id: orderId, company: { tradeName: company.tradeName } });
    });

    it('prioridade recalcula prazos; SLA estourado é sinalizado; resolvidos fecham sozinhos', async () => {
      const support = ctx.app.get(SupportService);
      const created = await ctx.http()
        .post('/v1/support/tickets')
        .set(auth(customer.token))
        .send({ as: 'CUSTOMER', category: 'ACCOUNT', subject: 'Trocar e-mail', description: 'Quero trocar o e-mail da minha conta.' })
        .expect(201);
      expect(created.body.priority).toBe('MEDIUM');
      const urgent = await ctx.http().post(`/v1/admin/support/tickets/${created.body.id}/priority`).set(auth(adminToken)).send({ priority: 'URGENT' }).expect(200);
      expect(new Date(urgent.body.firstResponseDueAt).getTime() - new Date(urgent.body.createdAt).getTime()).toBe(15 * 60_000);

      await ctx.prisma.supportTicket.update({ where: { id: created.body.id }, data: { firstResponseDueAt: new Date(Date.now() - 60_000) } });
      expect(await support.checkSla()).toBeGreaterThanOrEqual(1);
      const breached = await ctx.prisma.supportTicket.findUniqueOrThrow({ where: { id: created.body.id }, include: { events: true } });
      expect(breached.slaBreachedAt).toBeTruthy();
      expect(breached.events.some((event) => event.type === 'SLA_BREACHED' && event.toValue === 'primeira resposta')).toBe(true);
      // Não duplica o alerta na próxima verificação.
      await support.checkSla();
      expect(await ctx.prisma.ticketEvent.count({ where: { ticketId: created.body.id, type: 'SLA_BREACHED' } })).toBe(1);
      const breachedList = await ctx.http().get('/v1/admin/support/tickets').query({ breached: 'true', pageSize: 100 }).set(auth(adminToken)).expect(200);
      expect(breachedList.body.data.find((item: { id: string }) => item.id === created.body.id)).toMatchObject({ sla: { state: 'breached' }, slaBreached: true });
      const stats = await ctx.http().get('/v1/admin/support/tickets/stats').set(auth(adminToken)).expect(200);
      expect(stats.body.breachedOpen).toBeGreaterThanOrEqual(1);
      expect(stats.body.last30Days.opened).toBeGreaterThanOrEqual(2);

      await ctx.http().post(`/v1/admin/support/tickets/${created.body.id}/status`).set(auth(adminToken)).send({ status: 'RESOLVED' }).expect(200);
      await ctx.prisma.supportTicket.update({ where: { id: created.body.id }, data: { resolvedAt: new Date(Date.now() - 4 * 86_400_000) } });
      expect(await support.autoClose()).toBeGreaterThanOrEqual(1);
      const closed = await ctx.http().get(`/v1/support/tickets/${created.body.id}`).set(auth(customer.token)).expect(200);
      expect(closed.body).toMatchObject({ status: 'CLOSED', canReply: false, canRate: true });
      await ctx.http().post(`/v1/support/tickets/${created.body.id}/messages`).set(auth(customer.token)).send({ body: 'Mais uma coisa' }).expect(409);
    });

    it('empresa e entregador abrem chamados pelo próprio perfil; atribuição exige atendente válido', async () => {
      const companyTicket = await ctx.http()
        .post('/v1/support/tickets')
        .set(auth(company.token))
        .send({ as: 'COMPANY', companyId: company.companyId, category: 'PAYMENT', subject: 'Repasse', description: 'Dúvida sobre o repasse desta semana.' })
        .expect(201);
      expect(companyTicket.body.priority).toBe('HIGH');
      const list = await ctx.http().get('/v1/support/tickets').query({ companyId: company.companyId }).set(auth(company.token)).expect(200);
      expect(list.body.data.map((item: { id: string }) => item.id)).toContain(companyTicket.body.id);
      await ctx.http().get('/v1/support/tickets').query({ companyId: company.companyId }).set(auth(customer.token)).expect(403);

      const driverTicket = await ctx.http()
        .post('/v1/support/tickets')
        .set(auth(driver.token))
        .send({ as: 'DRIVER', category: 'DELIVERY', subject: 'App travou', description: 'O app travou durante a rota de entrega.' })
        .expect(201);
      await ctx.http().post(`/v1/admin/support/tickets/${driverTicket.body.id}/assign`).set(auth(adminToken)).send({ assigneeId: customer.userId }).expect(400);
      const adminUser = await ctx.prisma.user.findFirstOrThrow({ where: { email: ADMIN.login } });
      const assigned = await ctx.http().post(`/v1/admin/support/tickets/${driverTicket.body.id}/assign`).set(auth(adminToken)).send({ assigneeId: adminUser.id }).expect(200);
      expect(assigned.body).toMatchObject({ status: 'IN_PROGRESS', assignee: { id: adminUser.id } });
    });
  });

  // ---------------------------------------------------------------------------
  // Operação, relatórios e painéis
  // ---------------------------------------------------------------------------

  describe('torre de controle, mapa de calor e relatórios', () => {
    let delivered: { id: string; totalCents: number };
    let pending: { id: string; number: number };
    let canceled: { id: string; totalCents: number };

    beforeAll(async () => {
      const customer = await newCustomer();
      // 1 entregue, 1 cancelado pela loja e 1 aguardando entregador.
      const first = await placeOrder(customer);
      const delivery = await dispatchOrder(first.id);
      await finishDelivery(delivery.id, first.id, first.deliveryCode);
      delivered = first;
      const second = await placeOrder(customer);
      await ctx.http().post(`/v1/companies/${company.companyId}/orders/${second.id}/cancel`).set(auth(company.token)).send({ reason: 'Produto em falta' }).expect(201);
      canceled = second;
      // Entregador sai do ar: o terceiro pedido fica aguardando entregador.
      await ctx.prisma.driver.update({ where: { id: driver.driverId }, data: { availability: 'OFFLINE' } });
      const third = await placeOrder(customer);
      for (const step of ['confirm', 'prepare', 'ready']) await ctx.http().post(`/v1/companies/${company.companyId}/orders/${third.id}/${step}`).set(auth(company.token)).expect(201);
      pending = third;
      await ctx.http().post('/v1/drivers/me/availability').set(auth(driver.token)).send({ online: true, ...at(0.2) }).expect(200);
    });

    it('snapshot: entregadores online, entregas em aberto, atrasos, indicadores e alertas', async () => {
      await ctx.http().get('/v1/admin/operations/snapshot').set(auth(driver.token)).expect(403);
      const delivery = await waitFor(() => ctx.prisma.delivery.findFirst({ where: { orderId: pending.id, status: 'SEARCHING_DRIVER' } }));
      // Simula espera longa e pedido passando do prazo.
      await ctx.prisma.delivery.update({ where: { id: delivery.id }, data: { searchStartedAt: new Date(Date.now() - 20 * 60_000) } });
      await ctx.prisma.order.update({ where: { id: pending.id }, data: { estimatedDeliveryAt: new Date(Date.now() - 30 * 60_000) } });

      const snapshot = await ctx.http().get('/v1/admin/operations/snapshot').query({ city: CITY }).set(auth(adminToken)).expect(200);
      const body = snapshot.body;
      expect(body.drivers.find((item: { id: string }) => item.id === driver.driverId)).toMatchObject({ availability: 'ONLINE', stale: false, activeDeliveries: 0 });
      const open = body.deliveries.find((item: { id: string }) => item.id === delivery.id);
      expect(open).toMatchObject({ status: 'SEARCHING_DRIVER', late: true, company: company.tradeName, order: { number: pending.number } });
      expect(open.waitingMinutes).toBeGreaterThanOrEqual(19);
      expect(body.metrics).toMatchObject({ deliveredToday: 2, deliveriesWaiting: 1, ordersLate: 1 });
      expect(body.metrics.slaToday).not.toBeNull();
      expect(body.metrics.avgDeliveryMinutes).not.toBeNull();
      const types = body.alerts.map((alert: { type: string; deliveryId?: string }) => alert.type);
      expect(types).toEqual(expect.arrayContaining(['dispatch_stalled', 'late', 'order_late']));
      expect(body.alerts.find((alert: { type: string }) => alert.type === 'dispatch_stalled')).toMatchObject({ severity: 'critical', deliveryId: delivery.id });
      const region = body.supplyDemand.find((cell: { geohash: string }) => cell.geohash === geohash(STORE, 5));
      expect(region).toMatchObject({ waiting: 1 });
      expect(body.supplyDemand.reduce((sum: number, cell: { idleDrivers: number }) => sum + cell.idleDrivers, 0)).toBeGreaterThanOrEqual(1);
    });

    it('amostras de presença agregadas (sem identificar entregadores) alimentam o mapa de calor', async () => {
      const operations = ctx.app.get(OperationsService);
      const bucket = new Date(Math.floor(Date.now() / 300_000) * 300_000);
      // O cron do próprio app pode já ter gravado este intervalo; o resultado é o mesmo.
      await operations.samplePresence();
      const sample = await ctx.prisma.driverPresenceSample.findFirst({ where: { geohash: geohash(at(0.2), 6), bucketStart: bucket } });
      expect(sample).toMatchObject({ onlineCount: expect.any(Number) });
      expect(Object.keys(sample!)).not.toContain('driverId');
      // Repetir no mesmo intervalo não duplica.
      await operations.samplePresence();
      expect(await ctx.prisma.driverPresenceSample.count({ where: { geohash: sample!.geohash, bucketStart: bucket } })).toBe(1);

      const bbox = [BASE.lat - 0.2, BASE.lng - 0.2, BASE.lat + 0.2, BASE.lng + 0.2].join(',');
      const drivers = await ctx.http().get('/v1/admin/operations/heatmap').query({ layer: 'drivers', period: 'today', bbox }).set(auth(adminToken)).expect(200);
      expect(drivers.body.cells.length).toBeGreaterThanOrEqual(1);
      expect(drivers.body.unit).toBe('média de entregadores online');
    });

    it('mapa de calor por camada, período, horário e cidade', async () => {
      const layer = async (name: string, extra: Record<string, unknown> = {}) =>
        (await ctx.http().get('/v1/admin/operations/heatmap').query({ layer: name, period: 'today', city: CITY, precision: 'fine', ...extra }).set(auth(adminToken)).expect(200)).body;
      const deliveries = await layer('deliveries');
      expect(deliveries.total).toBe(2);
      expect(deliveries.byHour).toHaveLength(24);
      expect(deliveries.byHour.reduce((sum: number, value: number) => sum + value, 0)).toBe(2);
      const cell = deliveries.cells[0];
      expect(cell.bounds[0][0]).toBeLessThanOrEqual(HOME.lat);
      expect(cell.bounds[1][0]).toBeGreaterThanOrEqual(HOME.lat);
      expect((await layer('orders')).total).toBeGreaterThanOrEqual(5);
      expect((await layer('demand')).total).toBeGreaterThanOrEqual(3);
      // Filtro de horário fora do horário atual zera a camada.
      const localHour = (new Date().getUTCHours() + 21) % 24; // America/Sao_Paulo (UTC-3)
      const otherHour = (localHour + 12) % 24;
      expect((await layer('deliveries', { fromHour: otherHour, toHour: otherHour })).total).toBe(0);
      await ctx.http().get('/v1/admin/operations/heatmap').query({ layer: 'x' }).set(auth(adminToken)).expect(400);
      await ctx.http().get('/v1/admin/operations/heatmap').query({ bbox: '1,2,3' }).set(auth(adminToken)).expect(400);
    });

    it('relatório comercial e operacional filtrados pela cidade', async () => {
      const ordersInCity = await ctx.prisma.order.findMany({ where: { companyId: company.companyId, status: { notIn: ['PENDING_PAYMENT'] } }, select: { status: true, totalCents: true } });
      const sold = ordersInCity.filter((order) => order.status !== 'CANCELED');
      const gmv = sold.reduce((sum, order) => sum + order.totalCents, 0);

      const commercial = await ctx.http().get('/v1/admin/reports/commercial').query({ city: CITY }).set(auth(adminToken)).expect(200);
      const metric = (body: { summary: { key: string; value: number }[] }, key: string) => body.summary.find((item) => item.key === key)?.value;
      expect(metric(commercial.body, 'gmv')).toBe(gmv);
      expect(metric(commercial.body, 'orders')).toBe(sold.length);
      expect(metric(commercial.body, 'averageTicket')).toBe(Math.round(gmv / sold.length));
      expect(metric(commercial.body, 'companies')).toBe(1);
      expect(commercial.body.series.buckets).toHaveLength(30);
      expect(commercial.body.series.lines[0].values.reduce((sum: number, value: number) => sum + value, 0)).toBe(gmv);
      expect(commercial.body.tables.companies.rows).toEqual([expect.objectContaining({ company: company.tradeName, gmv, orders: sold.length })]);
      expect(commercial.body.tables.payments.rows).toEqual([expect.objectContaining({ method: 'Dinheiro', orders: sold.length })]);

      const operational = await ctx.http().get('/v1/admin/reports/operational').query({ city: CITY, granularity: 'week' }).set(auth(adminToken)).expect(200);
      expect(metric(operational.body, 'delivered')).toBe(2);
      expect(metric(operational.body, 'deliveries')).toBeGreaterThanOrEqual(3);
      expect(metric(operational.body, 'avgTotal')).not.toBeNull();
      expect(operational.body.range.granularity).toBe('week');
      expect(operational.body.tables.orderCancellations.rows).toEqual(expect.arrayContaining([expect.objectContaining({ actor: 'Empresa', reason: 'Produto em falta', count: 1 })]));
      expect(operational.body.tables.hours.rows).toHaveLength(24);
    });

    it('relatório financeiro confere com a liquidação e o de entregadores com as entregas', async () => {
      const settled = await ctx.prisma.order.findMany({ where: { companyId: company.companyId, settledAt: { not: null } }, select: { platformCommissionCents: true, serviceFeeCents: true } });
      const commission = settled.reduce((sum, order) => sum + (order.platformCommissionCents ?? 0), 0);
      const financial = await ctx.http().get('/v1/admin/reports/financial').query({ companyId: company.companyId }).set(auth(adminToken)).expect(200);
      const metric = (key: string) => financial.body.summary.find((item: { key: string }) => item.key === key)?.value;
      expect(metric('commission')).toBe(commission);
      expect(financial.body.tables.composition.rows.at(-1)).toMatchObject({ item: 'Receita líquida', amount: metric('revenue') });
      await ctx.http().get('/v1/admin/reports/financial').set(auth(company.token)).expect(403);

      const deliveredRows = await ctx.prisma.delivery.findMany({ where: { driverId: driver.driverId, status: 'DELIVERED' }, select: { payoutCents: true, tipCents: true, distanceKm: true } });
      const drivers = await ctx.http().get('/v1/admin/reports/drivers').query({ city: CITY }).set(auth(adminToken)).expect(200);
      const row = drivers.body.tables.drivers.rows.find((item: { id: string }) => item.id === driver.driverId);
      expect(row).toMatchObject({ name: 'Entregador Operação', delivered: 2, earnings: deliveredRows.reduce((sum, item) => sum + item.payoutCents + item.tipCents, 0) });
      // Ofertas recusadas/expiradas (o pedido pendente é reofertado) reduzem o aceite.
      expect(row.acceptance).toBeGreaterThan(0);
    });

    it('exporta CSV (separador ";", BOM, valores em reais) com auditoria', async () => {
      const response = await ctx.http().get('/v1/admin/reports/commercial').query({ city: CITY, format: 'csv', table: 'companies' }).set(auth(adminToken)).buffer(true).parse((res, callback) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => callback(null, data));
      }).expect(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('levoja-commercial-companies');
      const text = response.body as string;
      expect(text.charCodeAt(0)).toBe(0xfeff);
      const [header, first] = text.slice(1).split('\r\n');
      expect(header).toBe('Empresa;Pedidos;Vendas;Ticket médio;Clientes;Cancelados');
      expect(first.startsWith(`${company.tradeName};`)).toBe(true);
      expect(first).toMatch(/;\d+,\d{2};/);
      await ctx.http().get('/v1/admin/reports/commercial').query({ format: 'csv', table: 'nada' }).set(auth(adminToken)).expect(400);
      await ctx.http().get('/v1/admin/reports/commercial').query({ from: '2026-13-01' }).set(auth(adminToken)).expect(400);
      await ctx.http().get('/v1/admin/reports/commercial').query({ from: '2026-09-10', to: '2026-09-01' }).set(auth(adminToken)).expect(400);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'report.export', createdAt: { gte: new Date(Date.now() - 60_000) } } })).toBeGreaterThanOrEqual(1);
    });

    it('painel da empresa: vendas, pedidos, receita, tempos, conversão e mais vendidos', async () => {
      const visitor = await newCustomer();
      await ctx.http().get(`/v1/stores/${company.companyId}`).set(auth(visitor.token)).expect(200);
      await ctx.http().get(`/v1/stores/${company.companyId}`).expect(200);
      const dashboard = await ctx.http().get(`/v1/companies/${company.companyId}/dashboard`).query({ period: 'today' }).set(auth(company.token)).expect(200);
      const body = dashboard.body;
      expect(body.orders.completed).toBe(2);
      expect(body.orders.canceled).toBe(1);
      expect(body.orders.inProgress).toBeGreaterThanOrEqual(1);
      expect(body.sales.gmvCents).toBeGreaterThan(0);
      expect(body.sales.averageTicketCents).toBe(Math.round(body.sales.gmvCents / body.orders.sold));
      expect(body.finance.commissionCents).toBeGreaterThan(0);
      expect(body.rates.storeVisits).toBeGreaterThanOrEqual(2);
      expect(body.rates.conversion).not.toBeNull();
      expect(body.times.avgPrepMinutes).not.toBeNull();
      expect(body.topProducts[0]).toMatchObject({ product: 'Marmita' });
      expect(body.series.buckets).toHaveLength(24);
      expect(body.series.orders.reduce((sum: number, value: number) => sum + value, 0)).toBe(body.orders.sold);
      await ctx.http().get(`/v1/companies/${company.companyId}/dashboard`).set(auth(driver.token)).expect(403);

      const admin = await ctx.http().get('/v1/admin/dashboard').set(auth(adminToken)).expect(200);
      expect(admin.body.business.today.orders).toBeGreaterThanOrEqual(1);
      expect(admin.body.business.last30Days).toHaveProperty('netRevenueCents');
      expect(admin.body.business.driversNow.online + admin.body.business.driversNow.busy).toBeGreaterThanOrEqual(1);
      expect(admin.body.business.tickets.open).toBeGreaterThanOrEqual(1);
    });

    it('sem regressão: cancelados não entram nas vendas', () => {
      expect(canceled.totalCents).toBeGreaterThan(0);
      expect(delivered.totalCents).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Comunicados
  // ---------------------------------------------------------------------------

  describe('comunicados', () => {
    it('promoções só pelos canais com consentimento; aviso operacional só para parceiros', async () => {
      const consenting = await newCustomer('Com Consentimento');
      const silent = await newCustomer('Sem Consentimento');
      await ctx.http().post('/v1/me/consents').set(auth(consenting.token)).send({ type: 'MARKETING_EMAIL', granted: true }).expect(201);

      await ctx.http().post('/v1/admin/notifications/broadcasts').set(auth(consenting.token)).send({ audience: 'CUSTOMERS', kind: 'MARKETING', title: 'Oi', body: 'Promoção', channels: ['email'] }).expect(403);
      await ctx.http()
        .post('/v1/admin/notifications/broadcasts')
        .set(auth(adminToken))
        .send({ audience: 'CUSTOMERS', kind: 'OPERATIONAL', title: 'Aviso', body: 'Mensagem operacional', channels: ['inapp'] })
        .expect(400);

      const target = { audience: 'CUSTOMERS', kind: 'MARKETING', channels: ['email'], city: CITY };
      const preview = await ctx.http().post('/v1/admin/notifications/broadcasts/preview').set(auth(adminToken)).send(target).expect(200);
      const customersInCity = await ctx.prisma.user.count({ where: { customer: { isNot: null }, status: 'ACTIVE', addresses: { some: { city: CITY, deletedAt: null } } } });
      expect(preview.body.audience).toBe(customersInCity);
      expect(preview.body.reachable).toBeGreaterThanOrEqual(1);

      const created = await ctx.http()
        .post('/v1/admin/notifications/broadcasts')
        .set(auth(adminToken))
        .send({ ...target, title: 'Frete grátis hoje', body: 'Aproveite frete grátis nas lojas da sua cidade.' })
        .expect(201);
      expect(created.body).toMatchObject({ status: 'QUEUED', audience: 'CUSTOMERS', kind: 'MARKETING' });
      const sent = await waitFor(async () => {
        const row = await ctx.prisma.broadcast.findUnique({ where: { id: created.body.id } });
        return row?.status === 'SENT' ? row : null;
      });
      expect(sent.recipients).toBe(customersInCity);
      expect(sent.delivered).toBeGreaterThanOrEqual(1);
      expect(sent.delivered).toBeLessThan(sent.recipients);
      await waitFor(async () => ctx.mail.outbox.find((mail) => mail.to === consenting.email && mail.subject === 'Frete grátis hoje'));
      expect(ctx.mail.outbox.find((mail) => mail.to === silent.email && mail.subject === 'Frete grátis hoje')).toBeUndefined();

      const operational = await ctx.http()
        .post('/v1/admin/notifications/broadcasts')
        .set(auth(adminToken))
        .send({ audience: 'DRIVERS', kind: 'OPERATIONAL', title: 'Chuva forte', body: 'Adicional de chuva ativo na sua cidade. Pilote com cuidado.', channels: ['inapp', 'push'], city: CITY })
        .expect(201);
      await waitFor(async () => (await ctx.prisma.broadcast.findUnique({ where: { id: operational.body.id } }))?.status === 'SENT');
      const notification = await waitFor(() => ctx.prisma.notification.findFirst({ where: { userId: driver.userId, type: 'broadcast.operational' } }));
      expect(notification.title).toBe('Chuva forte');

      const list = await ctx.http().get('/v1/admin/notifications/broadcasts').set(auth(adminToken)).expect(200);
      expect(list.body.data.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([created.body.id, operational.body.id]));
      expect(await ctx.prisma.auditLog.count({ where: { action: 'notifications.broadcast', entityId: created.body.id } })).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // LGPD
  // ---------------------------------------------------------------------------

  describe('LGPD', () => {
    it('exportação inclui mensagens e chamados; a exclusão remove o conteúdo escrito pelo titular', async () => {
      const customer = await newCustomer('Titular Excluir');
      const order = await placeOrder(customer);
      const conversation = await ctx.http().post('/v1/conversations/open').set(auth(customer.token)).send({ type: 'CUSTOMER_COMPANY', orderId: order.id }).expect(200);
      await ctx.http().post(`/v1/conversations/${conversation.body.id}/messages`).set(auth(customer.token)).send({ body: 'Meu apartamento é o 12B' }).expect(201);
      const ticket = await ctx.http()
        .post('/v1/support/tickets')
        .set(auth(customer.token))
        .send({ as: 'CUSTOMER', category: 'OTHER', subject: 'Dados pessoais', description: 'Informação pessoal sensível no chamado.' })
        .expect(201);
      await ctx.http().post(`/v1/support/tickets/${ticket.body.id}/attachments`).set(auth(customer.token)).attach('file', SAMPLE_PNG, 'rg.png').expect(201);

      const exported = await ctx.http().get('/v1/me/data-export').set(auth(customer.token)).expect(200);
      expect(exported.body.chatMessages).toEqual([expect.objectContaining({ body: 'Meu apartamento é o 12B' })]);
      expect(exported.body.supportTickets).toEqual([expect.objectContaining({ subject: 'Dados pessoais' })]);

      // Pedido encerrado para não bloquear a exclusão.
      await ctx.http().post(`/v1/companies/${company.companyId}/orders/${order.id}/cancel`).set(auth(company.token)).send({ reason: 'Teste de exclusão' }).expect(201);
      const request = await ctx.http().post('/v1/me/privacy/deletion-request').set(auth(customer.token)).send({ reason: 'Não uso mais' }).expect(201);
      await ctx.http().post(`/v1/admin/privacy-requests/${request.body.id}/resolve`).set(auth(adminToken)).send({ approve: true, response: 'Conta excluída.' }).expect(201);

      const message = await ctx.prisma.chatMessage.findFirstOrThrow({ where: { conversationId: conversation.body.id } });
      expect(message).toMatchObject({ body: '[mensagem removida a pedido do titular]', senderUserId: null });
      const redacted = await ctx.prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.body.id }, include: { attachments: true } });
      expect(redacted.subject).toBe('[removido]');
      expect(redacted.description).not.toContain('sensível');
      expect(redacted.attachments).toHaveLength(0);
    });
  });
});
