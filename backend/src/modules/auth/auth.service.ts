import { EventEmitter2 } from '@nestjs/event-emitter';
import { AUTH_SESSION_STARTED, AuthSessionStartedEvent } from '../../common/intelligence-events';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { normalizeBrazilianPhone, ROLE_KEYS } from '@levoja/shared';
import { PrismaService, Tx } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { PasswordService } from '../../infra/crypto/password.service';
import { generateTotpSecret, totpUri, verifyTotp } from '../../infra/crypto/totp';
import { MailService } from '../../infra/mail/mail.service';
import { AppConfig } from '../../config/config.module';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../access/access.service';
import { RolesService } from '../access/roles.service';
import { UsersService } from '../users/users.service';
import { OneTimeTokenService } from '../users/one-time-token.service';
import { InvitationsService } from '../users/invitations.service';
import { LegalService, ConsentInput } from '../privacy/legal.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SmsProvider } from '../notifications/providers';
import { CompaniesService } from '../companies/companies.service';
import { DriversService } from '../drivers/drivers.service';
import type { ClientInfo } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { TokenPair, TokenService } from './token.service';
import {
  ChangePasswordDto,
  LoginDto,
  RegisterCompanyDto,
  RegisterCustomerDto,
  RegisterDriverDto,
  ResetPasswordDto,
} from './auth.dto';
import type { User } from '../../generated/prisma/client';

type AppKind = LoginDto['app'];

export interface SignupContext {
  tenantId: string;
  userId: string;
  profile: 'CUSTOMER' | 'DRIVER' | 'COMPANY';
  companyId?: string;
  referralCode?: string;
  client: ClientInfo;
}

/** Regra executada no cadastro, dentro da transação (ex.: vincular o código de indicação). Lança exceção para recusar. */
export type SignupHook = (tx: Tx, context: SignupContext) => Promise<void>;

export type LoginResult = (TokenPair & { mfaRequired?: false; user: ReturnType<UsersService['toView']> }) | { mfaRequired: true; mfaToken: string };

const STATUS_MESSAGES: Record<string, string> = {
  SUSPENDED: 'Conta suspensa. Entre em contato com o suporte.',
  BLOCKED: 'Conta bloqueada. Entre em contato com o suporte.',
  DEACTIVATED: 'Conta desativada.',
};

const INVALID_CREDENTIALS = 'E-mail/telefone ou senha incorretos.';

@Injectable()
export class AuthService {
  private readonly signupHooks: SignupHook[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly users: UsersService,
    private readonly roles: RolesService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly legal: LegalService,
    private readonly oneTime: OneTimeTokenService,
    private readonly invitations: InvitationsService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly sms: SmsProvider,
    private readonly companies: CompaniesService,
    private readonly drivers: DriversService,
    private readonly config: AppConfig,
    private readonly events: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------------
  // Cadastro
  // ---------------------------------------------------------------------------

  registerSignupHook(hook: SignupHook): void {
    this.signupHooks.push(hook);
  }

  private async runSignupHooks(tx: Tx, context: SignupContext) {
    for (const hook of this.signupHooks) await hook(tx, context);
  }

  async registerCustomer(tenantId: string, dto: RegisterCustomerDto, client: ClientInfo): Promise<LoginResult> {
    const role = await this.roles.findByKey(tenantId, ROLE_KEYS.CUSTOMER);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await this.users.create(tx, tenantId, { ...dto, roleIds: [role.id] });
      await tx.customer.create({ data: { tenantId, userId: created.id } });
      await this.legal.recordConsents(tx, tenantId, created.id, this.baseConsents(dto.marketingOptIn), client);
      await this.runSignupHooks(tx, { tenantId, userId: created.id, profile: 'CUSTOMER', referralCode: dto.referralCode, client });
      await this.audit.log(
        { action: 'auth.register', entityType: 'User', entityId: created.id, actorId: created.id, tenantId, metadata: { profile: 'customer' } },
        tx,
      );
      return created;
    });
    await this.welcome(user, 'Sua conta foi criada. Peça o que precisar, entregamos para você!');
    return this.completeLogin(user, client, 'CUSTOMER');
  }

  async registerDriver(tenantId: string, dto: RegisterDriverDto, client: ClientInfo): Promise<LoginResult> {
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await this.users.create(tx, tenantId, { ...dto, roleIds: [] });
      await this.drivers.createForUser(tx, tenantId, created.id, dto.vehicleType);
      await this.legal.recordConsents(
        tx,
        tenantId,
        created.id,
        [
          ...this.baseConsents(dto.marketingOptIn),
          { type: 'DRIVER_TERMS', granted: true },
          { type: 'LOCATION_TRACKING', granted: true },
        ],
        client,
      );
      await this.runSignupHooks(tx, { tenantId, userId: created.id, profile: 'DRIVER', referralCode: dto.referralCode, client });
      await this.audit.log(
        { action: 'auth.register', entityType: 'User', entityId: created.id, actorId: created.id, tenantId, metadata: { profile: 'driver' } },
        tx,
      );
      return created;
    });
    await this.welcome(user, 'Seu cadastro de entregador foi iniciado. Envie seus documentos pelo app para análise.');
    return this.completeLogin(user, client, 'DRIVER');
  }

  async registerCompany(tenantId: string, dto: RegisterCompanyDto, client: ClientInfo): Promise<LoginResult & { companyId?: string }> {
    let companyId = '';
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await this.users.create(tx, tenantId, { ...dto, roleIds: [] });
      const company = await this.companies.createForOwner(tx, tenantId, created.id, dto.company);
      companyId = company.id;
      await this.legal.recordConsents(
        tx,
        tenantId,
        created.id,
        [...this.baseConsents(dto.marketingOptIn), { type: 'COMPANY_TERMS', granted: true }],
        client,
      );
      await this.runSignupHooks(tx, { tenantId, userId: created.id, profile: 'COMPANY', companyId: company.id, referralCode: dto.referralCode, client });
      await this.audit.log(
        {
          action: 'auth.register',
          entityType: 'User',
          entityId: created.id,
          actorId: created.id,
          tenantId,
          metadata: { profile: 'company', companyId: company.id },
        },
        tx,
      );
      return created;
    });
    await this.welcome(user, 'Cadastro da empresa iniciado. Complete os dados e envie os documentos para análise.');
    const result = await this.completeLogin(user, client, 'COMPANY');
    return { ...result, companyId };
  }

  private baseConsents(marketingOptIn = false): ConsentInput[] {
    return [
      { type: 'TERMS_OF_USE', granted: true },
      { type: 'PRIVACY_POLICY', granted: true },
      { type: 'MARKETING_EMAIL', granted: marketingOptIn },
      { type: 'MARKETING_PUSH', granted: marketingOptIn },
    ];
  }

  private async welcome(user: User, message: string) {
    await this.notifications.notify({
      userId: user.id,
      type: 'user.welcome',
      title: `Bem-vindo(a) ao ${this.config.env.APP_NAME}!`,
      body: message,
      channels: ['inapp', 'email'],
    });
  }

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  async login(tenantId: string, dto: LoginDto, client: ClientInfo): Promise<LoginResult> {
    const user = await this.findByLogin(tenantId, dto.login);
    if (!user || user.anonymizedAt || !user.passwordHash) {
      await this.passwords.verifyDummy(dto.password);
      await this.audit.log({ action: 'auth.login.failed', actorId: null, tenantId, metadata: { reason: 'unknown_user' } });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new HttpException(
        `Muitas tentativas incorretas. Tente novamente em ${minutes} minuto(s) ou redefina sua senha.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!(await this.passwords.verify(user.passwordHash, dto.password))) {
      await this.registerFailedAttempt(user);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    // O status só é revelado após a senha correta (evita enumeração de contas).
    if (user.status !== 'ACTIVE') {
      await this.audit.log({ action: 'auth.login.denied', entityType: 'User', entityId: user.id, actorId: user.id, tenantId, metadata: { status: user.status } });
      throw new ForbiddenException(STATUS_MESSAGES[user.status] ?? 'Acesso negado.');
    }
    if (dto.app === 'ADMIN') {
      const profile = await this.access.getProfile(user.id);
      if (!profile?.isStaff) throw new ForbiddenException('Acesso restrito à equipe da plataforma.');
    }
    if (user.failedLoginCount > 0) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    }

    if (user.mfaEnabled) {
      return { mfaRequired: true, mfaToken: await this.tokens.signMfaChallenge(user.id) };
    }
    return this.completeLogin(user, client, dto.app);
  }

  async loginWithMfa(mfaToken: string, code: string, client: ClientInfo, app?: AppKind): Promise<LoginResult> {
    const userId = await this.tokens.verifyMfaChallenge(mfaToken);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== 'ACTIVE') throw new ForbiddenException(STATUS_MESSAGES[user.status] ?? 'Acesso negado.');
    const secret = this.crypto.decryptNullable(user.mfaSecretEncrypted);
    if (!user.mfaEnabled || !secret || !verifyTotp(secret, code)) {
      await this.registerFailedAttempt(user);
      throw new UnauthorizedException('Código de verificação inválido.');
    }
    return this.completeLogin(user, client, app);
  }

  private async findByLogin(tenantId: string, login: string): Promise<User | null> {
    const identifier = login.trim();
    if (identifier.includes('@')) {
      return this.prisma.user.findUnique({ where: { tenantId_email: { tenantId, email: identifier.toLowerCase() } } });
    }
    const phone = normalizeBrazilianPhone(identifier);
    return phone ? this.prisma.user.findUnique({ where: { tenantId_phone: { tenantId, phone } } }) : null;
  }

  private async registerFailedAttempt(user: User) {
    const attempts = user.failedLoginCount + 1;
    const lock = attempts >= this.config.env.MAX_LOGIN_ATTEMPTS;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : attempts,
        lockedUntil: lock ? new Date(Date.now() + this.config.env.LOGIN_LOCK_MINUTES * 60_000) : undefined,
      },
    });
    await this.audit.log({
      action: lock ? 'auth.login.locked' : 'auth.login.failed',
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      tenantId: user.tenantId,
      metadata: { attempts },
    });
  }

  private async completeLogin(user: User, client: ClientInfo, app?: AppKind): Promise<LoginResult> {
    if (app === 'CUSTOMER') await this.ensureCustomerProfile(user);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: client.ip },
    });
    const pair = await this.tokens.issue(updated, client);
    await this.audit.log({
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      actorId: user.id,
      tenantId: user.tenantId,
      metadata: { app: app ?? null },
    });
    // Antifraude: registra o aparelho usado (várias contas no mesmo aparelho). A equipe fica de fora.
    if (app !== 'ADMIN') {
      this.events.emit(AUTH_SESSION_STARTED, {
        tenantId: user.tenantId,
        userId: user.id,
        app: app ?? null,
        deviceId: client.deviceId,
        ip: client.ip,
        userAgent: client.userAgent,
      } satisfies AuthSessionStartedEvent);
    }
    return { ...pair, user: this.users.toView(updated) };
  }

  /** Quem entra pelo app do cliente (ex.: um entregador) ganha o perfil de cliente automaticamente. */
  private async ensureCustomerProfile(user: User) {
    const existing = await this.prisma.customer.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (existing) return;
    const role = await this.roles.findByKey(user.tenantId, ROLE_KEYS.CUSTOMER);
    await this.prisma.$transaction([
      this.prisma.customer.create({ data: { tenantId: user.tenantId, userId: user.id } }),
      this.prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        create: { userId: user.id, roleId: role.id },
        update: {},
      }),
    ]);
    await this.access.invalidate(user.id);
  }

  // ---------------------------------------------------------------------------
  // Sessões
  // ---------------------------------------------------------------------------

  refresh(refreshToken: string, client: ClientInfo) {
    return this.tokens.rotate(refreshToken, client);
  }

  async logout(refreshToken: string) {
    const revoked = await this.tokens.revokeByToken(refreshToken, 'logout');
    if (revoked) await this.audit.log({ action: 'auth.logout', entityType: 'User', entityId: revoked.userId, actorId: revoked.userId });
  }

  async logoutAll(user: AuthUser) {
    await this.tokens.revokeAllForUser(user.userId, 'logout_all');
    await this.audit.log({ action: 'auth.logout_all', entityType: 'User', entityId: user.userId });
  }

  async sessions(user: AuthUser) {
    const tokens = await this.prisma.refreshToken.findMany({
      where: { userId: user.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { familyId: true, createdAt: true, lastUsedAt: true, ip: true, userAgent: true },
    });
    return tokens.map((token) => ({
      id: token.familyId,
      lastActivityAt: token.createdAt,
      ip: token.ip,
      userAgent: token.userAgent,
      current: token.familyId === user.sessionId,
    }));
  }

  async revokeSession(user: AuthUser, familyId: string) {
    const owned = await this.prisma.refreshToken.findFirst({ where: { familyId, userId: user.userId }, select: { id: true } });
    if (!owned) throw new BadRequestException('Sessão não encontrada.');
    await this.tokens.revokeFamily(familyId, 'revoked_by_user');
    await this.audit.log({ action: 'auth.session.revoke', entityType: 'User', entityId: user.userId, metadata: { familyId } });
  }

  // ---------------------------------------------------------------------------
  // Senha
  // ---------------------------------------------------------------------------

  /** Sempre responde com sucesso para não revelar se o e-mail está cadastrado. */
  async forgotPassword(tenantId: string, email: string, portal: 'web' | 'admin' = 'web') {
    const user = await this.prisma.user.findUnique({ where: { tenantId_email: { tenantId, email: email.trim().toLowerCase() } } });
    if (!user || user.status !== 'ACTIVE' || user.anonymizedAt) return;
    await this.invitations.sendPasswordReset(user, portal);
    await this.audit.log({ action: 'auth.password.forgot', entityType: 'User', entityId: user.id, actorId: user.id, tenantId });
  }

  async resetPassword(dto: ResetPasswordDto) {
    this.users.assertPassword(dto.password);
    const { userId, purpose } = await this.oneTime.consumeLink(['PASSWORD_RESET', 'INVITATION'], dto.token);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== 'ACTIVE') throw new ForbiddenException(STATUS_MESSAGES[user.status] ?? 'Acesso negado.');
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await this.passwords.hash(dto.password),
        failedLoginCount: 0,
        lockedUntil: null,
        // Quem recebeu o link comprovou o acesso ao e-mail.
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      },
    });
    await this.tokens.revokeAllForUser(userId, 'password_reset');
    await this.audit.log({
      action: purpose === 'INVITATION' ? 'auth.invitation.accept' : 'auth.password.reset',
      entityType: 'User',
      entityId: userId,
      actorId: userId,
      tenantId: user.tenantId,
    });
  }

  async changePassword(actor: AuthUser, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (!(await this.passwords.verify(user.passwordHash, dto.currentPassword))) {
      throw new BadRequestException('Senha atual incorreta.');
    }
    this.users.assertPassword(dto.newPassword);
    if (dto.currentPassword === dto.newPassword) throw new BadRequestException('A nova senha deve ser diferente da atual.');
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await this.passwords.hash(dto.newPassword) } });
    // Mantém a sessão atual e encerra as demais.
    await this.prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null, NOT: { familyId: actor.sessionId } },
      data: { revokedAt: new Date(), revokedReason: 'password_change' },
    });
    await this.audit.log({ action: 'auth.password.change', entityType: 'User', entityId: user.id });
  }

  // ---------------------------------------------------------------------------
  // Verificação de e-mail / telefone
  // ---------------------------------------------------------------------------

  async sendVerification(actor: AuthUser, channel: 'email' | 'phone') {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (channel === 'email') {
      if (user.emailVerifiedAt) throw new ConflictException('E-mail já verificado.');
      const code = await this.oneTime.issueCode(user.id, 'EMAIL_VERIFICATION');
      await this.mail.send({
        to: user.email,
        subject: 'Código de verificação',
        paragraphs: [`Seu código de verificação é ${code}.`, 'Ele expira em 15 minutos. Não compartilhe este código.'],
      });
      return;
    }
    if (!user.phone) throw new BadRequestException('Cadastre um telefone antes de verificá-lo.');
    if (user.phoneVerifiedAt) throw new ConflictException('Telefone já verificado.');
    const code = await this.oneTime.issueCode(user.id, 'PHONE_VERIFICATION');
    await this.sms.send({ to: user.phone, body: `${this.config.env.APP_NAME}: seu código é ${code}. Não compartilhe.`, channel: 'sms' });
  }

  async confirmVerification(actor: AuthUser, channel: 'email' | 'phone', code: string) {
    await this.oneTime.consumeCode(actor.userId, channel === 'email' ? 'EMAIL_VERIFICATION' : 'PHONE_VERIFICATION', code);
    await this.prisma.user.update({
      where: { id: actor.userId },
      data: channel === 'email' ? { emailVerifiedAt: new Date() } : { phoneVerifiedAt: new Date() },
    });
    await this.audit.log({ action: `auth.verify.${channel}`, entityType: 'User', entityId: actor.userId });
  }

  // ---------------------------------------------------------------------------
  // MFA (TOTP) — opcional para usuários, recomendado para a equipe
  // ---------------------------------------------------------------------------

  async setupMfa(actor: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (user.mfaEnabled) throw new ConflictException('A verificação em duas etapas já está ativa.');
    const secret = generateTotpSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaSecretEncrypted: this.crypto.encrypt(secret) } });
    return { secret, otpauthUrl: totpUri(secret, user.email, this.config.env.APP_NAME) };
  }

  async enableMfa(actor: AuthUser, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    const secret = this.crypto.decryptNullable(user.mfaSecretEncrypted);
    if (!secret) throw new BadRequestException('Inicie a configuração antes de ativar.');
    if (!verifyTotp(secret, code)) throw new BadRequestException('Código inválido. Confira o horário do seu celular.');
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    await this.audit.log({ action: 'auth.mfa.enable', entityType: 'User', entityId: user.id });
  }

  async disableMfa(actor: AuthUser, password: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    const secret = this.crypto.decryptNullable(user.mfaSecretEncrypted);
    if (!user.mfaEnabled || !secret) throw new ConflictException('A verificação em duas etapas não está ativa.');
    if (!(await this.passwords.verify(user.passwordHash, password)) || !verifyTotp(secret, code)) {
      throw new BadRequestException('Senha ou código inválido.');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecretEncrypted: null } });
    await this.audit.log({ action: 'auth.mfa.disable', entityType: 'User', entityId: user.id });
  }

  // ---------------------------------------------------------------------------
  // Perfil de acesso
  // ---------------------------------------------------------------------------

  async me(actor: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      include: {
        driver: { select: { id: true, status: true } },
        companyMemberships: {
          where: { isActive: true },
          select: {
            role: { select: { key: true, name: true } },
            company: { select: { id: true, tradeName: true, status: true, logoKey: true } },
          },
        },
      },
    });
    const companyPermissions = new Map(actor.companies.map((membership) => [membership.companyId, membership.permissions]));
    return {
      user: this.users.toView(user),
      roles: actor.roles,
      permissions: actor.permissions,
      isStaff: actor.isStaff,
      customerId: actor.customerId,
      driver: user.driver,
      companies: user.companyMemberships.map(({ company, role }) => ({
        id: company.id,
        tradeName: company.tradeName,
        status: company.status,
        role,
        permissions: companyPermissions.get(company.id) ?? [],
      })),
    };
  }
}
