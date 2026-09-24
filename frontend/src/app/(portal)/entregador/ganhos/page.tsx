'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useApi } from '@levoja/web-kit/client';
import { Card, ErrorState, SkeletonRows } from '@levoja/web-kit/ui';
import { BankAccountForm, BankAccountView } from '@/components/partner-forms';
import { WalletPanel } from '@/components/wallet-panel';

interface DriverSummary {
  status: string;
  user: { name: string };
  bankAccount: BankAccountView | null;
}

export default function DriverEarningsPage() {
  const { data: driver, error, isLoading, refetch } = useApi<DriverSummary>('drivers/me');
  if (isLoading) return <SkeletonRows rows={6} />;
  if (error || !driver) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/entregador" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Cadastro de entregador
        </Link>
        <h1 className="text-2xl font-extrabold">Ganhos e saques</h1>
        <p className="mt-1 text-sm text-muted">Repasses das entregas, gorjetas e o dinheiro recebido em mãos. Saques via PIX para a sua chave cadastrada.</p>
      </div>
      {driver.status === 'APPROVED' ? (
        <WalletPanel
          overviewPath="drivers/me/wallet"
          transactionsPath="drivers/me/wallet/transactions"
          withdrawalsPath="drivers/me/withdrawals"
          settleDebtPath="drivers/me/wallet/settle-debt"
          canWithdraw
        />
      ) : (
        <Card>
          <p className="text-sm text-muted">Os ganhos aparecem aqui depois que o seu cadastro for aprovado e você concluir as primeiras entregas.</p>
        </Card>
      )}
      <Card title="Chave PIX para receber">
        <p className="mb-4 text-sm text-muted">Por segurança, após alterar os dados bancários novos saques ficam retidos por 24 horas.</p>
        <BankAccountForm path="drivers/me/bank-account" current={driver.bankAccount} onSaved={() => refetch()} defaultHolder={driver.user.name} />
      </Card>
    </div>
  );
}
