'use client';

import { formatBRL } from '@levoja/shared';
import { useApi } from '@levoja/web-kit/client';
import { Card } from '@levoja/web-kit/ui';
import { BankAccountForm } from '@/components/partner-forms';
import { WalletOverview, WalletPanel } from '@/components/wallet-panel';
import { useCompany } from '@/lib/company';

interface CompanyWallet extends WalletOverview {
  commission: { percentBps: number; fixedCents: number; ruleName: string };
  releaseDays: number;
  userCanWithdraw: boolean;
}

export default function CompanyFinancePage() {
  const { company, reload, can } = useCompany();
  const base = `companies/${company.id}/finance`;
  const { data } = useApi<CompanyWallet>(can('company.finance.read') ? `${base}/wallet` : null);

  return (
    <div className="space-y-6">
      {can('company.finance.read') && (
        <>
          {data && (
            <p className="text-sm text-muted">
              Comissão vigente: <strong className="text-fg">{`${(data.commission.percentBps / 100).toLocaleString('pt-BR')}%${data.commission.fixedCents ? ` + ${formatBRL(data.commission.fixedCents)} por pedido` : ''}`}</strong> sobre as vendas (após cupons da loja). Os valores das
              vendas ficam disponíveis {data.releaseDays ? `${data.releaseDays} dia(s) após a entrega` : 'logo após a entrega'}.
            </p>
          )}
          <WalletPanel
            overviewPath={`${base}/wallet`}
            transactionsPath={`${base}/transactions`}
            withdrawalsPath={`${base}/withdrawals`}
            settleDebtPath={`${base}/settle-debt`}
            canWithdraw={can('company.finance.withdraw')}
            releaseHint={data ? (data.releaseDays ? `Liberado ${data.releaseDays} dia(s) após cada entrega` : undefined) : undefined}
          />
        </>
      )}
      {can('company.profile.manage') && (
        <Card title="Conta para repasses">
          <p className="mb-4 text-sm text-muted">
            Os saques são enviados por PIX para a chave cadastrada aqui. Por segurança, os dados completos não são exibidos novamente e, após uma alteração, novos saques ficam retidos por 24 horas.
          </p>
          <BankAccountForm path={`companies/${company.id}/bank-account`} current={company.bankAccount} onSaved={reload} defaultHolder={company.legalName} />
        </Card>
      )}
    </div>
  );
}
