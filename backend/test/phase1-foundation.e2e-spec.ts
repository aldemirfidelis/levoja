import { ADMIN, createTestApp, login, SAMPLE_PDF, SAMPLE_PNG, TestContext, uniqueIdentity } from './utils';
import { generateTotp } from '../src/infra/crypto/totp';

/**
 * Fase 1 — Fundação: autenticação, RBAC, cadastros de cliente/empresa/entregador,
 * fluxos de aprovação, auditoria, LGPD e isolamento multi-tenant.
 */
describe('Fase 1 — Fundação (E2E)', () => {
  let ctx: TestContext;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    adminToken = await login(ctx, ADMIN, 'ADMIN');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const registerCustomer = async (overrides: Record<string, unknown> = {}) => {
    const id = uniqueIdentity();
    const body = {
      name: 'Cliente Teste',
      email: id.email,
      phone: id.phone,
      password: 'SenhaForte123',
      cpf: id.cpf,
      acceptTerms: true,
      acceptPrivacy: true,
      ...overrides,
    };
    const response = await ctx.http().post('/v1/auth/register/customer').send(body);
    return { response, body, id };
  };

  describe('Infraestrutura', () => {
    it('expõe health, readiness, métricas e documentação OpenAPI', async () => {
      await ctx.http().get('/health').expect(200);
      const ready = await ctx.http().get('/health/ready').expect(200);
      expect(ready.body.checks.database).toBe('up');
      const metrics = await ctx.http().get('/metrics').expect(200);
      expect(metrics.text).toContain('http_request_duration_seconds');
      const docs = await ctx.http().get('/docs/openapi.json').expect(200);
      expect(docs.body.paths['/v1/auth/login']).toBeDefined();
    });

    it('retorna erros no formato padrão com requestId', async () => {
      const response = await ctx.http().get('/v1/admin/users').expect(401);
      expect(response.body).toMatchObject({ statusCode: 401, message: expect.any(String) });
      expect(response.body.requestId).toBeDefined();
      expect(response.headers['x-request-id']).toBe(response.body.requestId);
    });

    it('lista segmentos e documentos legais publicamente', async () => {
      const segments = await ctx.http().get('/v1/segments').expect(200);
      expect(segments.body.map((s: { slug: string }) => s.slug)).toEqual(expect.arrayContaining(['restaurantes', 'farmacias', 'documentos']));
      const terms = await ctx.http().get('/v1/legal/TERMS_OF_USE').expect(200);
      expect(terms.body.version).toBe('1.0');
    });
  });

  describe('Cliente: cadastro, login e perfil', () => {
    it('cadastra cliente, registra consentimentos e retorna tokens', async () => {
      const { response, body } = await registerCustomer({ marketingOptIn: true });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String), tokenType: 'Bearer' });
      expect(response.body.user.cpfMasked).toMatch(/^\*+\d{4}$/);
      expect(response.body.user).not.toHaveProperty('passwordHash');

      const me = await ctx.http().get('/v1/auth/me').set(auth(response.body.accessToken)).expect(200);
      expect(me.body.roles).toEqual(['customer']);
      expect(me.body.permissions).toContain('customer.orders.create');
      expect(me.body.customerId).toBeTruthy();

      const consents = await ctx.http().get('/v1/me/consents').set(auth(response.body.accessToken)).expect(200);
      expect(consents.body.pendingAcceptance).toEqual([]);
      expect(consents.body.consents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'TERMS_OF_USE', granted: true, version: '1.0' }),
          expect.objectContaining({ type: 'MARKETING_EMAIL', granted: true }),
        ]),
      );
      expect(ctx.mail.outbox.some((mail) => mail.to === body.email && mail.subject.includes('Bem-vindo'))).toBe(true);
    });

    it('valida dados: CPF inválido, senha fraca, termos não aceitos', async () => {
      expect((await registerCustomer({ cpf: '111.111.111-11' })).response.status).toBe(400);
      expect((await registerCustomer({ password: 'fraca' })).response.status).toBe(400);
      const noTerms = await registerCustomer({ acceptTerms: false });
      expect(noTerms.response.status).toBe(400);
      expect(noTerms.response.body.details.join(' ')).toContain('Termos de Uso');
      const extra = await registerCustomer({ isAdmin: true });
      expect(extra.response.status).toBe(400);
    });

    it('impede e-mail e telefone duplicados (409)', async () => {
      const first = await registerCustomer();
      const dupEmail = await registerCustomer({ email: first.body.email.toUpperCase() });
      expect(dupEmail.response.status).toBe(409);
      const dupPhone = await registerCustomer({ phone: first.body.phone });
      expect(dupPhone.response.status).toBe(409);
    });

    it('login por e-mail ou telefone; credenciais erradas não revelam a conta', async () => {
      const { body } = await registerCustomer();
      await ctx.http().post('/v1/auth/login').send({ login: body.email, password: body.password }).expect(200);
      await ctx.http().post('/v1/auth/login').send({ login: `(11) ${body.phone.slice(2)}`, password: body.password }).expect(200);
      const wrong = await ctx.http().post('/v1/auth/login').send({ login: body.email, password: 'Errada123' }).expect(401);
      const unknown = await ctx.http().post('/v1/auth/login').send({ login: 'ninguem@levoja.test', password: 'Errada123' }).expect(401);
      expect(wrong.body.message).toBe(unknown.body.message);
    });

    it('bloqueia temporariamente após tentativas excessivas', async () => {
      const { body } = await registerCustomer();
      for (let i = 0; i < 5; i++) {
        await ctx.http().post('/v1/auth/login').send({ login: body.email, password: 'Errada123' }).expect(401);
      }
      const locked = await ctx.http().post('/v1/auth/login').send({ login: body.email, password: body.password });
      expect(locked.status).toBe(429);
      expect(locked.body.message).toContain('Tente novamente');
    });

    it('rotaciona refresh token e revoga a sessão ao detectar reutilização', async () => {
      const { response } = await registerCustomer();
      const first = response.body.refreshToken;
      const rotated = await ctx.http().post('/v1/auth/refresh').send({ refreshToken: first }).expect(200);
      expect(rotated.body.refreshToken).not.toBe(first);
      // Reuso do token antigo => toda a família é revogada
      await ctx.http().post('/v1/auth/refresh').send({ refreshToken: first }).expect(401);
      await ctx.http().post('/v1/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401);
    });

    it('gerencia endereços com endereço padrão único', async () => {
      const { response } = await registerCustomer();
      const token = response.body.accessToken;
      const address = { zipCode: '01310-100', street: 'Avenida Paulista', number: '1000', district: 'Bela Vista', city: 'São Paulo', state: 'sp', lat: -23.5614, lng: -46.6559 };
      const a = await ctx.http().post('/v1/me/addresses').set(auth(token)).send({ ...address, label: 'Casa' }).expect(201);
      expect(a.body).toMatchObject({ isDefault: true, zipCode: '01310100', state: 'SP' });
      const b = await ctx.http().post('/v1/me/addresses').set(auth(token)).send({ ...address, label: 'Trabalho', isDefault: true }).expect(201);
      const list = await ctx.http().get('/v1/me/addresses').set(auth(token)).expect(200);
      expect(list.body.filter((item: { isDefault: boolean }) => item.isDefault)).toHaveLength(1);
      expect(list.body[0].id).toBe(b.body.id);
      await ctx.http().delete(`/v1/me/addresses/${b.body.id}`).set(auth(token)).expect(204);
      const after = await ctx.http().get('/v1/me/addresses').set(auth(token)).expect(200);
      expect(after.body).toHaveLength(1);
      expect(after.body[0]).toMatchObject({ id: a.body.id, isDefault: true });
    });

    it('redefine senha por link de e-mail e encerra sessões antigas', async () => {
      const { response, body } = await registerCustomer();
      await ctx.http().post('/v1/auth/password/forgot').send({ email: body.email }).expect(202);
      const mail = [...ctx.mail.outbox].reverse().find((item) => item.to === body.email && item.subject === 'Redefinição de senha');
      const token = new URL(mail!.action!.url).searchParams.get('token')!;
      await ctx.http().post('/v1/auth/password/reset').send({ token, password: 'NovaSenha456' }).expect(204);
      await ctx.http().post('/v1/auth/password/reset').send({ token, password: 'OutraSenha789' }).expect(400);
      await ctx.http().post('/v1/auth/refresh').send({ refreshToken: response.body.refreshToken }).expect(401);
      await ctx.http().post('/v1/auth/login').send({ login: body.email, password: 'NovaSenha456' }).expect(200);
    });

    it('verifica e-mail por código', async () => {
      const { response, body } = await registerCustomer();
      const token = response.body.accessToken;
      await ctx.http().post('/v1/auth/verification/send').set(auth(token)).send({ channel: 'email' }).expect(204);
      const mail = [...ctx.mail.outbox].reverse().find((item) => item.to === body.email && item.subject === 'Código de verificação');
      const code = mail!.paragraphs[0].match(/\d{6}/)![0];
      await ctx.http().post('/v1/auth/verification/confirm').set(auth(token)).send({ channel: 'email', code: '000000' === code ? '111111' : '000000' }).expect(400);
      await ctx.http().post('/v1/auth/verification/confirm').set(auth(token)).send({ channel: 'email', code }).expect(204);
      const me = await ctx.http().get('/v1/auth/me').set(auth(token)).expect(200);
      expect(me.body.user.emailVerified).toBe(true);
    });

    it('ativa verificação em duas etapas (TOTP) e exige o código no login', async () => {
      const { response, body } = await registerCustomer();
      const token = response.body.accessToken;
      const setup = await ctx.http().post('/v1/auth/mfa/setup').set(auth(token)).expect(201);
      await ctx.http().post('/v1/auth/mfa/enable').set(auth(token)).send({ code: generateTotp(setup.body.secret) }).expect(204);

      const step1 = await ctx.http().post('/v1/auth/login').send({ login: body.email, password: body.password }).expect(200);
      expect(step1.body).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });
      await ctx.http().post('/v1/auth/mfa/login').send({ mfaToken: step1.body.mfaToken, code: '000000' }).expect(401);
      const step2 = await ctx.http()
        .post('/v1/auth/mfa/login')
        .send({ mfaToken: step1.body.mfaToken, code: generateTotp(setup.body.secret) })
        .expect(200);
      expect(step2.body.accessToken).toBeDefined();
    });
  });

  describe('RBAC e administração de usuários', () => {
    it('cliente não acessa rotas administrativas nem o painel', async () => {
      const { response, body } = await registerCustomer();
      await ctx.http().get('/v1/admin/users').set(auth(response.body.accessToken)).expect(403);
      await ctx.http().get('/v1/admin/dashboard').set(auth(response.body.accessToken)).expect(403);
      await ctx.http().post('/v1/auth/login').send({ login: body.email, password: body.password, app: 'ADMIN' }).expect(403);
    });

    it('admin convida usuário de suporte, que ativa o acesso com permissões restritas', async () => {
      const id = uniqueIdentity();
      const created = await ctx.http()
        .post('/v1/admin/users')
        .set(auth(adminToken))
        .send({ name: 'Atendente Suporte', email: id.email, roleKeys: ['support'] })
        .expect(201);
      expect(created.body.roles).toEqual([expect.objectContaining({ key: 'support' })]);

      const invite = [...ctx.mail.outbox].reverse().find((mail) => mail.to === id.email);
      expect(invite!.action!.url).toContain('/definir-senha?token=');
      const token = new URL(invite!.action!.url).searchParams.get('token')!;
      await ctx.http().post('/v1/auth/password/reset').send({ token, password: 'Suporte12345' }).expect(204);

      const supportToken = await login(ctx, { login: id.email, password: 'Suporte12345' }, 'ADMIN');
      await ctx.http().get('/v1/admin/users').set(auth(supportToken)).expect(200);
      await ctx.http()
        .post(`/v1/admin/users/${created.body.id}/status`)
        .set(auth(supportToken))
        .send({ action: 'BLOCK', reason: 'teste' })
        .expect(403);
      await ctx.http().get('/v1/admin/audit-logs').set(auth(supportToken)).expect(403);
    });

    it('bloqueio tem efeito imediato: token atual e refresh deixam de valer', async () => {
      const { response } = await registerCustomer();
      const userId = response.body.user.id;
      await ctx.http().get('/v1/auth/me').set(auth(response.body.accessToken)).expect(200);
      await ctx.http().post(`/v1/admin/users/${userId}/status`).set(auth(adminToken)).send({ action: 'BLOCK' }).expect(400);
      await ctx.http()
        .post(`/v1/admin/users/${userId}/status`)
        .set(auth(adminToken))
        .send({ action: 'BLOCK', reason: 'Fraude em cupons' })
        .expect(201);
      const denied = await ctx.http().get('/v1/auth/me').set(auth(response.body.accessToken)).expect(403);
      expect(denied.body.message).toContain('bloqueada');
      await ctx.http().post('/v1/auth/refresh').send({ refreshToken: response.body.refreshToken }).expect(401);

      await ctx.http()
        .post(`/v1/admin/users/${userId}/status`)
        .set(auth(adminToken))
        .send({ action: 'REACTIVATE' })
        .expect(201);
    });

    it('admin não altera o próprio status e papéis personalizados funcionam', async () => {
      const me = await ctx.http().get('/v1/auth/me').set(auth(adminToken)).expect(200);
      await ctx.http()
        .post(`/v1/admin/users/${me.body.user.id}/status`)
        .set(auth(adminToken))
        .send({ action: 'SUSPEND', reason: 'x' })
        .expect(403);

      const role = await ctx.http()
        .post('/v1/admin/roles')
        .set(auth(adminToken))
        .send({ key: `auditor_${Date.now()}`, name: 'Auditor', permissionKeys: ['audit.read', 'users.read'] })
        .expect(201);
      const roles = await ctx.http().get('/v1/admin/roles').set(auth(adminToken)).expect(200);
      expect(roles.body.find((item: { id: string }) => item.id === role.body.id).permissionKeys.sort()).toEqual(['audit.read', 'users.read']);
      await ctx.http()
        .post('/v1/admin/roles')
        .set(auth(adminToken))
        .send({ key: `escalada_${Date.now()}`, name: 'Escalada', permissionKeys: ['tenants.manage'] })
        .expect(403);
    });
  });

  describe('Empresa: cadastro, documentos e aprovação', () => {
    it('percorre o fluxo completo até a loja aberta', async () => {
      const segments = await ctx.http().get('/v1/segments').expect(200);
      const restaurant = segments.body.find((s: { slug: string }) => s.slug === 'restaurantes');
      const owner = uniqueIdentity();
      const companyIdentity = uniqueIdentity();

      const registered = await ctx.http()
        .post('/v1/auth/register/company')
        .send({
          name: 'Dona do Restaurante',
          email: owner.email,
          phone: owner.phone,
          password: 'SenhaForte123',
          cpf: owner.cpf,
          acceptTerms: true,
          acceptPrivacy: true,
          acceptCompanyTerms: true,
          company: {
            legalName: 'Sabor Caseiro Alimentos LTDA',
            tradeName: 'Sabor Caseiro',
            cnpj: companyIdentity.cnpj,
            segmentId: restaurant.id,
            email: companyIdentity.email,
            phone: '(11) 3333-4444',
            responsibleName: 'Dona do Restaurante',
            responsibleCpf: owner.cpf,
          },
        })
        .expect(201);
      const token = registered.body.accessToken;
      const companyId = registered.body.companyId;

      const company = await ctx.http().get(`/v1/companies/${companyId}`).set(auth(token)).expect(200);
      expect(company.body.status).toBe('DRAFT');
      expect(company.body.ownerActions).toEqual(['SUBMIT']);

      // Envio incompleto é recusado com a lista de pendências
      const incomplete = await ctx.http().post(`/v1/companies/${companyId}/submit`).set(auth(token)).expect(400);
      expect(incomplete.body.details).toEqual(expect.arrayContaining(['Endereço do estabelecimento', 'Documento: Licença sanitária']));

      await ctx.http()
        .put(`/v1/companies/${companyId}/address`)
        .set(auth(token))
        .send({ zipCode: '01310100', street: 'Av. Paulista', number: '900', district: 'Bela Vista', city: 'São Paulo', state: 'SP', lat: -23.563, lng: -46.654 })
        .expect(200);
      await ctx.http()
        .put(`/v1/companies/${companyId}/opening-hours`)
        .set(auth(token))
        .send({ hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: '00:00', closesAt: '23:59' })) })
        .expect(200);
      await ctx.http()
        .put(`/v1/companies/${companyId}/bank-account`)
        .set(auth(token))
        .send({ holderName: 'Sabor Caseiro', holderDocument: companyIdentity.cnpj, bankCode: '260', branch: '0001', accountNumber: '12345678', accountType: 'CHECKING', pixKeyType: 'CNPJ', pixKey: companyIdentity.cnpj })
        .expect(200);

      // Upload valida o conteúdo real do arquivo
      await ctx.http()
        .post(`/v1/companies/${companyId}/documents`)
        .set(auth(token))
        .field('type', 'CNPJ_CARD')
        .attach('file', Buffer.from('não sou um pdf'), 'falso.pdf')
        .expect(400);
      for (const type of ['CNPJ_CARD', 'RESPONSIBLE_ID', 'ADDRESS_PROOF', 'SANITARY_LICENSE']) {
        await ctx.http().post(`/v1/companies/${companyId}/documents`).set(auth(token)).field('type', type).attach('file', SAMPLE_PDF, `${type}.pdf`).expect(201);
      }
      await ctx.http().put(`/v1/companies/${companyId}/logo`).set(auth(token)).attach('file', SAMPLE_PNG, 'logo.png').expect(200);

      const submitted = await ctx.http().post(`/v1/companies/${companyId}/submit`).set(auth(token)).expect(201);
      expect(submitted.body.status).toBe('UNDER_REVIEW');

      // Loja não abre antes da aprovação
      await ctx.http().post(`/v1/companies/${companyId}/open`).set(auth(token)).send({ isOpen: true }).expect(409);

      // Admin: fila, documentos e aprovação
      const queue = await ctx.http().get('/v1/admin/companies?status=UNDER_REVIEW').set(auth(adminToken)).expect(200);
      expect(queue.body.data.some((row: { id: string }) => row.id === companyId)).toBe(true);
      const detail = await ctx.http().get(`/v1/admin/companies/${companyId}`).set(auth(adminToken)).expect(200);
      expect(detail.body.adminActions).toEqual(expect.arrayContaining(['APPROVE', 'REJECT', 'REQUEST_CHANGES']));

      await ctx.http().post(`/v1/admin/companies/${companyId}/actions`).set(auth(adminToken)).send({ action: 'APPROVE' }).expect(409);

      const file = await ctx.http().get(`/v1/admin/companies/${companyId}/documents/${detail.body.documents[0].id}/file`).set(auth(adminToken)).expect(200);
      expect(file.headers['content-type']).toBe('application/pdf');

      for (const doc of detail.body.documents) {
        await ctx.http()
          .post(`/v1/admin/companies/${companyId}/documents/${doc.id}/review`)
          .set(auth(adminToken))
          .send({ status: 'APPROVED' })
          .expect(201);
      }
      const approved = await ctx.http().post(`/v1/admin/companies/${companyId}/actions`).set(auth(adminToken)).send({ action: 'APPROVE' }).expect(201);
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.history[0]).toMatchObject({ fromStatus: 'UNDER_REVIEW', toStatus: 'APPROVED', action: 'APPROVE' });

      const opened = await ctx.http().post(`/v1/companies/${companyId}/open`).set(auth(token)).send({ isOpen: true }).expect(201);
      expect(opened.body).toMatchObject({ isOpen: true, isOpenNow: true });

      // Proprietário foi notificado
      const notifications = await ctx.http().get('/v1/me/notifications').set(auth(token)).expect(200);
      expect(notifications.body.data.some((n: { type: string }) => n.type === 'company.status.approved')).toBe(true);

      // Dados jurídicos ficam bloqueados após a aprovação
      await ctx.http().patch(`/v1/companies/${companyId}`).set(auth(token)).send({ legalName: 'Outro Nome LTDA' }).expect(409);
      await ctx.http().patch(`/v1/companies/${companyId}`).set(auth(token)).send({ description: 'Comida caseira' }).expect(200);

      // Suspensão fecha a loja
      const suspended = await ctx.http()
        .post(`/v1/admin/companies/${companyId}/actions`)
        .set(auth(adminToken))
        .send({ action: 'SUSPEND', reason: 'Reclamações recorrentes' })
        .expect(201);
      expect(suspended.body).toMatchObject({ status: 'SUSPENDED', isOpen: false });

      // Auditoria registrou a trilha
      const audit = await ctx.http().get(`/v1/admin/audit-logs?entityType=Company&entityId=${companyId}`).set(auth(adminToken)).expect(200);
      const actions = audit.body.data.map((row: { action: string }) => row.action);
      expect(actions).toEqual(expect.arrayContaining(['company.create', 'company.submit', 'company.approve', 'company.suspend']));
    });

    it('gerencia equipe: convida atendente com permissões limitadas', async () => {
      const segments = await ctx.http().get('/v1/segments').expect(200);
      const owner = uniqueIdentity();
      const companyIdentity = uniqueIdentity();
      const registered = await ctx.http()
        .post('/v1/auth/register/company')
        .send({
          name: 'Dono Loja',
          email: owner.email,
          phone: owner.phone,
          password: 'SenhaForte123',
          cpf: owner.cpf,
          acceptTerms: true,
          acceptPrivacy: true,
          acceptCompanyTerms: true,
          company: {
            legalName: 'Loja Teste LTDA',
            tradeName: 'Loja Teste',
            cnpj: companyIdentity.cnpj,
            segmentId: segments.body.find((s: { slug: string }) => s.slug === 'lojas').id,
            email: companyIdentity.email,
            phone: '(11) 3333-5555',
            responsibleName: 'Dono Loja',
            responsibleCpf: owner.cpf,
          },
        })
        .expect(201);
      const { accessToken, companyId } = registered.body;
      const staff = uniqueIdentity();
      const added = await ctx.http()
        .post(`/v1/companies/${companyId}/members`)
        .set(auth(accessToken))
        .send({ email: staff.email, name: 'Atendente', roleKey: 'company_attendant' })
        .expect(201);
      expect(added.body.invited).toBe(true);

      const invite = [...ctx.mail.outbox].reverse().find((mail) => mail.to === staff.email)!;
      await ctx.http()
        .post('/v1/auth/password/reset')
        .send({ token: new URL(invite.action!.url).searchParams.get('token'), password: 'Atendente123' })
        .expect(204);
      const staffToken = await login(ctx, { login: staff.email, password: 'Atendente123' });
      await ctx.http().get(`/v1/companies/${companyId}`).set(auth(staffToken)).expect(200);
      await ctx.http().patch(`/v1/companies/${companyId}`).set(auth(staffToken)).send({ description: 'x' }).expect(403);
      await ctx.http().get(`/v1/companies/${companyId}/members`).set(auth(staffToken)).expect(403);

      // Não é possível remover o último proprietário
      const members = await ctx.http().get(`/v1/companies/${companyId}/members`).set(auth(accessToken)).expect(200);
      const ownerMember = members.body.find((m: { role: { key: string } }) => m.role.key === 'company_owner');
      await ctx.http()
        .patch(`/v1/companies/${companyId}/members/${ownerMember.id}`)
        .set(auth(accessToken))
        .send({ roleKey: 'company_manager' })
        .expect(409);
    });
  });

  describe('Entregador: cadastro, correção e aprovação', () => {
    it('percorre o fluxo com solicitação de correção', async () => {
      const id = uniqueIdentity();
      const registered = await ctx.http()
        .post('/v1/auth/register/driver')
        .send({
          name: 'Entregador Teste',
          email: id.email,
          phone: id.phone,
          password: 'SenhaForte123',
          cpf: id.cpf,
          birthDate: '1995-03-10',
          vehicleType: 'MOTORCYCLE',
          acceptTerms: true,
          acceptPrivacy: true,
          acceptDriverTerms: true,
          acceptLocationTracking: true,
        })
        .expect(201);
      const token = registered.body.accessToken;

      const profile = await ctx.http().get('/v1/drivers/me').set(auth(token)).expect(200);
      expect(profile.body.status).toBe('DRAFT');
      const pendingKeys = profile.body.requirements.filter((r: { done: boolean }) => !r.done).map((r: { key: string }) => r.key);
      expect(pendingKeys).toEqual(expect.arrayContaining(['address', 'bank_account', 'cnh', 'vehicle_details', 'document:CNH', 'document:VEHICLE_REGISTRATION']));

      const vehicleId = profile.body.activeVehicleId;
      await ctx.http().patch(`/v1/drivers/me/vehicles/${vehicleId}`).set(auth(token)).send({ plate: 'abc-1d23', brand: 'Honda', model: 'CG 160', year: 2022 }).expect(200);
      await ctx.http().patch('/v1/drivers/me').set(auth(token)).send({ cnhNumber: '01234567890', cnhCategory: 'a', cnhExpiresAt: '2031-01-31' }).expect(200);
      await ctx.http()
        .put('/v1/drivers/me/address')
        .set(auth(token))
        .send({ zipCode: '01310100', street: 'Rua Augusta', number: '100', district: 'Consolação', city: 'São Paulo', state: 'SP' })
        .expect(200);
      await ctx.http()
        .put('/v1/drivers/me/bank-account')
        .set(auth(token))
        .send({ holderName: 'Entregador Teste', holderDocument: id.cpf, bankCode: '260', branch: '0001', accountNumber: '998877', accountType: 'PAYMENT', pixKeyType: 'CPF', pixKey: id.cpf })
        .expect(200);
      for (const type of ['CNH', 'VEHICLE_REGISTRATION', 'SELFIE', 'ADDRESS_PROOF']) {
        await ctx.http().post('/v1/drivers/me/documents').set(auth(token)).field('type', type).attach('file', SAMPLE_PNG, `${type}.png`).expect(201);
      }
      const submitted = await ctx.http().post('/v1/drivers/me/submit').set(auth(token)).expect(201);
      expect(submitted.body.status).toBe('UNDER_REVIEW');
      expect(submitted.body.cnhNumberMasked).toBe('*******7890');

      const driverId = submitted.body.id;
      const detail = await ctx.http().get(`/v1/admin/drivers/${driverId}`).set(auth(adminToken)).expect(200);
      const selfie = detail.body.documents.find((doc: { type: string }) => doc.type === 'SELFIE');
      await ctx.http()
        .post(`/v1/admin/drivers/${driverId}/documents/${selfie.id}/review`)
        .set(auth(adminToken))
        .send({ status: 'REJECTED', note: 'Foto sem o documento visível' })
        .expect(201);
      const changes = await ctx.http()
        .post(`/v1/admin/drivers/${driverId}/actions`)
        .set(auth(adminToken))
        .send({ action: 'REQUEST_CHANGES', reason: 'Reenvie a selfie segurando o documento' })
        .expect(201);
      expect(changes.body.status).toBe('PENDING_DOCUMENTS');

      // Entregador vê a pendência, reenvia e submete de novo
      const again = await ctx.http().get('/v1/drivers/me').set(auth(token)).expect(200);
      expect(again.body.requirements.find((r: { key: string }) => r.key === 'document:SELFIE')).toMatchObject({ done: false, detail: 'Foto sem o documento visível' });
      await ctx.http().post('/v1/drivers/me/documents').set(auth(token)).field('type', 'SELFIE').attach('file', SAMPLE_PNG, 'selfie2.png').expect(201);
      await ctx.http().post('/v1/drivers/me/submit').set(auth(token)).expect(201);

      const review = await ctx.http().get(`/v1/admin/drivers/${driverId}`).set(auth(adminToken)).expect(200);
      for (const doc of review.body.documents.filter((d: { status: string }) => d.status === 'PENDING')) {
        await ctx.http().post(`/v1/admin/drivers/${driverId}/documents/${doc.id}/review`).set(auth(adminToken)).send({ status: 'APPROVED' }).expect(201);
      }
      const approved = await ctx.http().post(`/v1/admin/drivers/${driverId}/actions`).set(auth(adminToken)).send({ action: 'APPROVE' }).expect(201);
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.vehicles[0].status).toBe('APPROVED');
      expect(approved.body.history.map((h: { action: string }) => h.action)).toEqual(['APPROVE', 'SUBMIT', 'REQUEST_CHANGES', 'SUBMIT', 'CREATE']);

      const me = await ctx.http().get('/v1/auth/me').set(auth(token)).expect(200);
      expect(me.body.driver).toMatchObject({ id: driverId, status: 'APPROVED' });
      expect(me.body.permissions).toContain('driver.deliveries.work');
    });

    it('menores de 18 anos não podem se cadastrar como entregador', async () => {
      const id = uniqueIdentity();
      const registered = await ctx.http()
        .post('/v1/auth/register/driver')
        .send({ name: 'Jovem', email: id.email, phone: id.phone, password: 'SenhaForte123', cpf: id.cpf, birthDate: '2012-01-01', vehicleType: 'BICYCLE', acceptTerms: true, acceptPrivacy: true, acceptDriverTerms: true, acceptLocationTracking: true })
        .expect(201);
      const profile = await ctx.http().get('/v1/drivers/me').set(auth(registered.body.accessToken)).expect(200);
      expect(profile.body.requirements.find((r: { key: string }) => r.key === 'birth_date')).toMatchObject({ done: false });
      await ctx.http().post('/v1/drivers/me/submit').set(auth(registered.body.accessToken)).expect(400);
    });
  });

  describe('LGPD', () => {
    it('exporta dados e anonimiza a conta após a exclusão aprovada', async () => {
      const { response, body } = await registerCustomer();
      const token = response.body.accessToken;
      const exported = await ctx.http().get('/v1/me/data-export').set(auth(token)).expect(200);
      expect(exported.body.profile.email).toBe(body.email);
      expect(exported.body.profile.cpf).toBe(body.cpf);
      expect(exported.body.profile).not.toHaveProperty('passwordHash');

      await ctx.http().post('/v1/me/consents').set(auth(token)).send({ type: 'TERMS_OF_USE', granted: false }).expect(400);
      await ctx.http().post('/v1/me/consents').set(auth(token)).send({ type: 'MARKETING_EMAIL', granted: false }).expect(201);

      const request = await ctx.http().post('/v1/me/privacy/deletion-request').set(auth(token)).send({ reason: 'Não uso mais' }).expect(201);
      await ctx.http().post('/v1/me/privacy/deletion-request').set(auth(token)).send({}).expect(409);
      await ctx.http()
        .post(`/v1/admin/privacy-requests/${request.body.id}/resolve`)
        .set(auth(adminToken))
        .send({ approve: true, response: 'Dados anonimizados conforme solicitado.' })
        .expect(201);

      await ctx.http().get('/v1/auth/me').set(auth(token)).expect(403);
      await ctx.http().post('/v1/auth/login').send({ login: body.email, password: body.password }).expect(401);
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: response.body.user.id } });
      expect(user).toMatchObject({ name: 'Titular removido', cpfHash: null, phone: null, status: 'DEACTIVATED' });
      expect(user.anonymizedAt).not.toBeNull();
      // Os consentimentos (prova legal) permanecem
      expect(await ctx.prisma.consent.count({ where: { userId: user.id } })).toBeGreaterThan(0);
    });
  });

  describe('Multi-tenant', () => {
    it('equipe de outro tenant não acessa empresas deste tenant', async () => {
      const company = await ctx.prisma.company.findFirstOrThrow({ where: { tenant: { slug: 'levoja' } } });
      const other = await ctx.prisma.tenant.create({ data: { slug: `outro-${Date.now()}`, name: 'Outro', domains: [] } });
      const permission = await ctx.prisma.permission.findUniqueOrThrow({ where: { key: 'companies.read' } });
      const manage = await ctx.prisma.permission.findUniqueOrThrow({ where: { key: 'companies.manage' } });
      const role = await ctx.prisma.role.create({
        data: {
          tenantId: other.id,
          key: 'admin',
          name: 'Admin',
          scope: 'PLATFORM',
          isStaff: true,
          permissions: { create: [{ permissionId: permission.id }, { permissionId: manage.id }] },
        },
      });
      const argon2 = await import('argon2');
      await ctx.prisma.user.create({
        data: {
          tenantId: other.id,
          name: 'Admin Outro',
          email: 'admin@outro.test',
          passwordHash: await argon2.hash('OutroTenant123'),
          roles: { create: { roleId: role.id } },
        },
      });
      const response = await ctx.http()
        .post('/v1/auth/login')
        .set('X-Tenant', other.slug)
        .send({ login: 'admin@outro.test', password: 'OutroTenant123', app: 'ADMIN' })
        .expect(200);
      const token = response.body.accessToken;

      await ctx.http().get(`/v1/admin/companies/${company.id}`).set(auth(token)).expect(404);
      await ctx.http().get(`/v1/companies/${company.id}`).set(auth(token)).expect(404);
      const list = await ctx.http().get('/v1/admin/companies').set(auth(token)).expect(200);
      expect(list.body.meta.total).toBe(0);
      // O mesmo e-mail pode existir em tenants diferentes; o login respeita o tenant
      await ctx.http().post('/v1/auth/login').send({ login: 'admin@outro.test', password: 'OutroTenant123' }).expect(401);
    });
  });
});
