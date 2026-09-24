import { Global, Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { PaymentsService } from './payments.service';
import { CommissionService } from './commission.service';
import { SettlementService } from './settlement.service';
import { WithdrawalsService } from './withdrawals.service';
import { ReconciliationService } from './reconciliation.service';
import { AdminFinanceController, CompanyFinanceController, CustomerWalletController, DriverWalletController, PaymentsController } from './finance.controller';

/**
 * Fase 4 — Financeiro: pagamentos (PIX, cartão, carteira, dinheiro), estornos, razão e carteiras,
 * comissões, liquidação de pedidos/entregas, saques, cupons e conciliação.
 */
@Global()
@Module({
  providers: [LedgerService, PaymentsService, CommissionService, SettlementService, WithdrawalsService, ReconciliationService],
  controllers: [PaymentsController, DriverWalletController, CompanyFinanceController, CustomerWalletController, AdminFinanceController],
  exports: [LedgerService, PaymentsService, CommissionService, SettlementService, WithdrawalsService],
})
export class FinanceModule {}
