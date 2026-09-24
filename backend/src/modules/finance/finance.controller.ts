import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { CompanyPermission, CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import type { AuthUser } from '../../common/auth/auth-user';
import { PaginationQueryDto } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CouponsService } from '../coupons/coupons.service';
import { DeliveriesService } from '../logistics/deliveries.service';
import { PaymentsService } from './payments.service';
import { WithdrawalsService } from './withdrawals.service';
import { LedgerService, WalletOwner } from './ledger.service';
import { ReconciliationService } from './reconciliation.service';
import { CommissionService } from './commission.service';
import { SettlementService } from './settlement.service';
import {
  AdjustmentDto,
  AdminCouponDto,
  CommissionRuleDto,
  CouponDto,
  MarkPaidDto,
  PaymentsQueryDto,
  PeriodQueryDto,
  ReasonDto,
  RefundDto,
  UpdateCommissionRuleDto,
  UpdateCouponDto,
  VerifyWalletsDto,
  WalletsQueryDto,
  WithdrawalRequestDto,
  WithdrawalsQueryDto,
} from './finance.dto';

/** Resumo da carteira com as regras de saque vigentes. */
async function walletOverview(
  deps: { ledger: LedgerService; settings: SettingsService; prisma: PrismaService; withdrawals: WithdrawalsService; payments: PaymentsService },
  tenantId: string,
  owner: Extract<WalletOwner, { type: 'DRIVER' | 'COMPANY' }>,
) {
  const wallet = await deps.ledger.wallet(tenantId, owner);
  const [summary, finance, account, open] = await Promise.all([
    deps.ledger.summary(wallet.id),
    deps.settings.get(tenantId, 'finance'),
    deps.prisma.bankAccount.findUnique({ where: owner.type === 'DRIVER' ? { driverId: owner.driverId } : { companyId: owner.companyId }, select: { pixKeyMasked: true } }),
    deps.prisma.withdrawal.findFirst({ where: { walletId: wallet.id, status: { in: ['REQUESTED', 'PROCESSING'] } }, orderBy: { createdAt: 'desc' } }),
  ]);
  return {
    ...summary,
    debtCents: Math.max(0, -summary.availableCents),
    cashLimitCents: owner.type === 'DRIVER' ? finance.maxDriverCashDebtCents : null,
    cashLimitReached: owner.type === 'DRIVER' ? summary.availableCents < -finance.maxDriverCashDebtCents : false,
    canSettleDebtOnline: !!deps.payments.gateway,
    withdrawal: {
      mode: deps.withdrawals.mode,
      minCents: finance.minWithdrawalCents,
      feeCents: finance.withdrawalFeeCents,
      pixKey: account?.pixKeyMasked ?? null,
      open: open ? deps.withdrawals.view(open) : null,
    },
  };
}

// -----------------------------------------------------------------------------
// Pagamentos (cliente, webhooks, sandbox)
// -----------------------------------------------------------------------------

@ApiTags('Pagamentos')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly deliveries: DeliveriesService,
  ) {}

  @Public()
  @Get('methods')
  @ApiOperation({ summary: 'Formas de pagamento habilitadas' })
  methods() {
    return {
      orders: ['CASH', ...this.payments.onlineMethods],
      deliveries: { customer: this.deliveries.onDemandMethods(false), company: this.deliveries.onDemandMethods(true) },
      online: !!this.payments.gateway,
      provider: this.payments.gateway?.name ?? null,
      cardTokenization: this.payments.cardTokenization,
      sandbox: this.payments.isSandbox
        ? { cardTokens: { tok_approved: 'Aprovado', tok_declined: 'Recusado pelo emissor', tok_insufficient: 'Saldo insuficiente' } }
        : null,
    };
  }

  @ApiBearerAuth()
  @Post(':id/sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Consulta o provedor e atualiza o status do pagamento' })
  sync(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.sync(user, id);
  }

  @ApiBearerAuth()
  @Post('sandbox/:id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sandbox: simula a confirmação do PIX (indisponível em produção)' })
  sandboxApprove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.sandboxApprove(user, id);
  }

  @Public()
  @SkipThrottle()
  @Post('webhooks/:provider')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  webhook(@Param('provider') provider: string, @Headers() headers: Record<string, string>, @Body() body: unknown) {
    return this.payments.handleWebhook(provider, headers, body);
  }
}

// -----------------------------------------------------------------------------
// Carteira do entregador
// -----------------------------------------------------------------------------

@ApiTags('Entregador (financeiro)')
@ApiBearerAuth()
@Controller('drivers/me')
@RequirePermissions('driver.earnings.read')
export class DriverWalletController {
  constructor(
    readonly ledger: LedgerService,
    readonly settings: SettingsService,
    readonly prisma: PrismaService,
    readonly withdrawals: WithdrawalsService,
    readonly payments: PaymentsService,
  ) {}

  private owner(user: AuthUser) {
    if (!user.driverId) throw new ForbiddenException('Perfil de entregador não encontrado.');
    return { type: 'DRIVER' as const, driverId: user.driverId };
  }

  @Get('wallet')
  wallet(@CurrentUser() user: AuthUser) {
    return walletOverview(this, user.tenantId, this.owner(user));
  }

  @Get('wallet/transactions')
  async transactions(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    const wallet = await this.ledger.wallet(user.tenantId, this.owner(user));
    return this.ledger.transactions(wallet.id, query);
  }

  @Post('wallet/settle-debt')
  @ApiOperation({ summary: 'Gera um PIX para quitar o saldo devedor (dinheiro recebido em entregas)' })
  settleDebt(@CurrentUser() user: AuthUser) {
    return this.payments.createDebtSettlement(user, this.owner(user));
  }

  @Get('withdrawals')
  list(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.withdrawals.listForWallet(user.tenantId, this.owner(user), query);
  }

  @Post('withdrawals')
  @RequirePermissions('driver.wallet.withdraw')
  request(@CurrentUser() user: AuthUser, @Body() dto: WithdrawalRequestDto) {
    return this.withdrawals.request(user, this.owner(user), dto.amountCents);
  }

  @Post('withdrawals/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('driver.wallet.withdraw')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.withdrawals.cancel(user, this.owner(user), id);
  }
}

// -----------------------------------------------------------------------------
// Financeiro da empresa
// -----------------------------------------------------------------------------

@ApiTags('Empresa (financeiro)')
@ApiBearerAuth()
@Controller('companies/:companyId')
@CompanyPermission('company.finance.read', 'payments.read')
export class CompanyFinanceController {
  constructor(
    readonly ledger: LedgerService,
    readonly settings: SettingsService,
    readonly prisma: PrismaService,
    readonly withdrawals: WithdrawalsService,
    readonly payments: PaymentsService,
    private readonly commission: CommissionService,
    private readonly coupons: CouponsService,
  ) {}

  @Get('finance/wallet')
  async wallet(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { tenantId: true, segmentId: true } });
    const [overview, rule] = await Promise.all([
      walletOverview(this, company.tenantId, { type: 'COMPANY', companyId }),
      this.commission.calculate(company.tenantId, { id: companyId, segmentId: company.segmentId }, 10_000),
    ]);
    const finance = await this.settings.get(company.tenantId, 'finance');
    return { ...overview, commission: { percentBps: rule.percentBps, fixedCents: rule.fixedCents, ruleName: rule.ruleName }, releaseDays: finance.companyReleaseDays, userCanWithdraw: user.canInCompany(companyId, 'company.finance.withdraw') };
  }

  @Get('finance/transactions')
  async transactions(@Param('companyId', ParseUUIDPipe) companyId: string, @Query() query: PaginationQueryDto) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { tenantId: true } });
    const wallet = await this.ledger.wallet(company.tenantId, { type: 'COMPANY', companyId });
    return this.ledger.transactions(wallet.id, query);
  }

  @Get('finance/withdrawals')
  async listWithdrawals(@Param('companyId', ParseUUIDPipe) companyId: string, @Query() query: PaginationQueryDto) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { tenantId: true } });
    return this.withdrawals.listForWallet(company.tenantId, { type: 'COMPANY', companyId }, query);
  }

  @Post('finance/withdrawals')
  @CompanyPermission('company.finance.withdraw')
  request(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: WithdrawalRequestDto) {
    return this.withdrawals.request(user, { type: 'COMPANY', companyId }, dto.amountCents);
  }

  @Post('finance/withdrawals/:id/cancel')
  @HttpCode(200)
  @CompanyPermission('company.finance.withdraw')
  cancel(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.withdrawals.cancel(user, { type: 'COMPANY', companyId }, id);
  }

  @Post('finance/settle-debt')
  @CompanyPermission('company.finance.withdraw')
  @ApiOperation({ summary: 'Gera um PIX para quitar o saldo devedor (entregas faturadas, pedidos em dinheiro)' })
  settleDebt(@CurrentUser() user: AuthUser, @Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.payments.createDebtSettlement(user, { type: 'COMPANY', companyId });
  }

  // --- Cupons da loja (desconto financiado pela empresa) ---

  @Get('coupons')
  @CompanyPermission('company.products.read', 'coupons.manage')
  async listCoupons(@Param('companyId', ParseUUIDPipe) companyId: string, @Query() query: PaginationQueryDto) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { tenantId: true } });
    return this.coupons.list(company.tenantId, query, companyId);
  }

  @Post('coupons')
  @CompanyPermission('company.products.manage', 'coupons.manage')
  async createCoupon(@Param('companyId', ParseUUIDPipe) companyId: string, @Body() dto: CouponDto) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { tenantId: true } });
    const { segmentId: _segment, ...input } = dto;
    return this.coupons.create(company.tenantId, input, { companyId, fundedBy: 'COMPANY' });
  }

  @Patch('coupons/:id')
  @CompanyPermission('company.products.manage', 'coupons.manage')
  async updateCoupon(@Param('companyId', ParseUUIDPipe) companyId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCouponDto) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { tenantId: true } });
    const { segmentId: _segment, ...input } = dto;
    return this.coupons.update(company.tenantId, id, input, companyId);
  }
}

// -----------------------------------------------------------------------------
// Carteira do cliente (créditos de estornos)
// -----------------------------------------------------------------------------

@ApiTags('Cliente (carteira)')
@ApiBearerAuth()
@Controller('customers/me/wallet')
@RequirePermissions('customer.orders.read')
export class CustomerWalletController {
  constructor(private readonly ledger: LedgerService) {}

  private async walletId(user: AuthUser) {
    if (!user.customerId) throw new ForbiddenException('Perfil de cliente não encontrado.');
    return (await this.ledger.wallet(user.tenantId, { type: 'CUSTOMER', customerId: user.customerId })).id;
  }

  @Get()
  async summary(@CurrentUser() user: AuthUser) {
    return this.ledger.summary(await this.walletId(user));
  }

  @Get('transactions')
  async transactions(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.ledger.transactions(await this.walletId(user), query);
  }
}

// -----------------------------------------------------------------------------
// Painel administrativo
// -----------------------------------------------------------------------------

@ApiTags('Admin (financeiro)')
@ApiBearerAuth()
@Controller('admin/finance')
@RequirePermissions('payments.read')
export class AdminFinanceController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly withdrawals: WithdrawalsService,
    private readonly reconciliation: ReconciliationService,
    private readonly ledger: LedgerService,
    private readonly commission: CommissionService,
    private readonly coupons: CouponsService,
    private readonly settlement: SettlementService,
    private readonly prisma: PrismaService,
  ) {}

  // --- Pagamentos ---

  @Get('payments')
  listPayments(@CurrentUser() user: AuthUser, @Query() query: PaymentsQueryDto) {
    return this.payments.list(user.tenantId, query);
  }

  @Get('payments/:id')
  getPayment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(user.tenantId, id);
  }

  @Post('payments/:id/refund')
  @HttpCode(200)
  @RequirePermissions('payments.manage')
  refund(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundDto) {
    return this.payments.refund(user, id, dto.amountCents, dto.reason, dto.toWallet ?? false);
  }

  @Post('payments/:id/sync')
  @HttpCode(200)
  @RequirePermissions('payments.manage')
  syncPayment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.sync(user, id);
  }

  // --- Saques ---

  @Get('withdrawals')
  @RequirePermissions('payouts.read')
  listWithdrawals(@CurrentUser() user: AuthUser, @Query() query: WithdrawalsQueryDto) {
    return this.withdrawals.listAdmin(user.tenantId, query);
  }

  @Post('withdrawals/:id/approve')
  @HttpCode(200)
  @RequirePermissions('payouts.manage')
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.withdrawals.approve(user, id);
  }

  @Post('withdrawals/:id/reject')
  @HttpCode(200)
  @RequirePermissions('payouts.manage')
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.withdrawals.reject(user, id, dto.reason);
  }

  @Post('withdrawals/:id/mark-paid')
  @HttpCode(200)
  @RequirePermissions('payouts.manage')
  markPaid(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkPaidDto) {
    return this.withdrawals.markPaid(user, id, dto.transferReference);
  }

  @Post('withdrawals/:id/mark-failed')
  @HttpCode(200)
  @RequirePermissions('payouts.manage')
  markFailed(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.withdrawals.markFailed(user, id, dto.reason);
  }

  // --- Carteiras ---

  @Get('wallets')
  wallets(@CurrentUser() user: AuthUser, @Query() query: WalletsQueryDto) {
    return this.reconciliation.wallets(user.tenantId, query);
  }

  @Get('wallets/platform')
  @RequirePermissions('finance.reports')
  platformWallet(@CurrentUser() user: AuthUser) {
    return this.reconciliation.platformWallet(user.tenantId);
  }

  @Get('wallets/:id')
  wallet(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reconciliation.wallet(user.tenantId, id);
  }

  @Get('wallets/:id/transactions')
  async walletTransactions(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: PaginationQueryDto) {
    await this.reconciliation.wallet(user.tenantId, id);
    return this.ledger.transactions(id, query);
  }

  @Post('wallets/:id/adjustments')
  @RequirePermissions('payments.manage')
  @ApiOperation({ summary: 'Ajuste manual com justificativa (auditado)' })
  adjust(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdjustmentDto) {
    return this.reconciliation.adjust(user, id, dto.amountCents, dto.reason);
  }

  // --- Conciliação ---

  @Get('reconciliation')
  @RequirePermissions('finance.reports')
  report(@CurrentUser() user: AuthUser, @Query() query: PeriodQueryDto) {
    return this.reconciliation.report(user.tenantId, query.from, query.to);
  }

  @Post('reconciliation/verify-wallets')
  @HttpCode(200)
  @RequirePermissions('finance.reports')
  verify(@CurrentUser() user: AuthUser, @Body() dto: VerifyWalletsDto) {
    return this.reconciliation.verifyWallets(user.tenantId, dto.limit);
  }

  @Post('settlements/sweep')
  @HttpCode(200)
  @RequirePermissions('payments.manage')
  @ApiOperation({ summary: 'Reprocessa liquidações pendentes' })
  async sweep() {
    return { reprocessed: await this.settlement.sweepUnsettled() };
  }

  @Post('settlements/release')
  @HttpCode(200)
  @RequirePermissions('payments.manage')
  @ApiOperation({ summary: 'Libera agora os saldos cujo prazo já venceu' })
  async release() {
    return { released: await this.ledger.releaseDue() };
  }

  // --- Comissões ---

  @Get('commission-rules')
  @RequirePermissions('pricing.read')
  commissionRules(@CurrentUser() user: AuthUser) {
    return this.commission.list(user.tenantId);
  }

  @Post('commission-rules')
  @RequirePermissions('pricing.manage')
  createRule(@CurrentUser() user: AuthUser, @Body() dto: CommissionRuleDto) {
    return this.commission.create(user.tenantId, dto);
  }

  @Patch('commission-rules/:id')
  @RequirePermissions('pricing.manage')
  updateRule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCommissionRuleDto) {
    return this.commission.update(user.tenantId, id, dto);
  }

  // --- Cupons da plataforma ---

  @Get('coupons')
  @RequirePermissions('coupons.manage')
  listCoupons(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.coupons.list(user.tenantId, query);
  }

  @Post('coupons')
  @RequirePermissions('coupons.manage')
  async createCoupon(@CurrentUser() user: AuthUser, @Body() dto: AdminCouponDto) {
    const { companyId, fundedBy, ...input } = dto;
    if (fundedBy === 'COMPANY' && !companyId) throw new BadRequestException('Cupom financiado pela loja precisa estar vinculado a ela.');
    if (companyId && !(await this.prisma.company.findFirst({ where: { id: companyId, tenantId: user.tenantId }, select: { id: true } }))) {
      throw new BadRequestException('Empresa não encontrada.');
    }
    return this.coupons.create(user.tenantId, input, { companyId, fundedBy: fundedBy ?? 'PLATFORM' });
  }

  @Patch('coupons/:id')
  @RequirePermissions('coupons.manage')
  updateCoupon(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCouponDto) {
    return this.coupons.update(user.tenantId, id, dto);
  }
}
