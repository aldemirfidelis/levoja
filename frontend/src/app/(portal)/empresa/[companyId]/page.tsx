'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Clock, Store } from 'lucide-react';
import { PARTNER_STATUS_LABELS } from '@levoja/shared';
import { api } from '@levoja/web-kit/client';
import { Badge, Button, Card, useToast } from '@levoja/web-kit/ui';
import { Checklist } from '@/components/partner-forms';
import { CompanyDashboard } from '@/components/company-dashboard';
import { useCompany } from '@/lib/company';

const STATUS_HELP: Record<string, string> = {
  DRAFT: 'Complete as pendências abaixo e envie o cadastro para análise.',
  PENDING_DOCUMENTS: 'Nossa equipe solicitou correções. Ajuste os itens indicados e envie novamente.',
  UNDER_REVIEW: 'Cadastro em análise. Você será avisado por e-mail e notificação assim que concluirmos (normalmente em até 2 dias úteis).',
  APPROVED: 'Cadastro aprovado! Abra a loja para começar a receber pedidos.',
  REJECTED: 'Cadastro reprovado. Veja o motivo, faça os ajustes e envie novamente.',
  SUSPENDED: 'Empresa suspensa. Fale com o suporte para regularizar.',
  BLOCKED: 'Empresa bloqueada. Fale com o suporte.',
};

export default function CompanyOverviewPage() {
  const { company, reload, can } = useCompany();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const pending = company.requirements.filter((item) => !item.done);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`companies/${company.id}/submit`);
      toast.success('Cadastro enviado para análise!');
      reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };

  const toggleOpen = async () => {
    setBusy(true);
    try {
      await api.post(`companies/${company.id}/open`, { isOpen: !company.isOpen });
      toast.success(company.isOpen ? 'Loja pausada.' : 'Loja aberta!');
      reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {company.status === 'APPROVED' && can('company.reports.read') && (
        <div className="mb-8">
          <CompanyDashboard companyId={company.id} />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={`Status: ${PARTNER_STATUS_LABELS[company.status]}`}>
            <p className="text-sm text-muted">{STATUS_HELP[company.status]}</p>
            {company.statusReason && (
              <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
                <strong>Mensagem da análise:</strong> {company.statusReason}
              </p>
            )}
            {company.ownerActions.includes('SUBMIT') && can('company.profile.manage') && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button onClick={submit} loading={busy} disabled={pending.length > 0}>
                  Enviar para análise
                </Button>
                {pending.length > 0 && <span className="text-sm text-muted">{pending.length} pendência(s) antes de enviar.</span>}
              </div>
            )}
          </Card>

          {company.status === 'APPROVED' && (
            <Card title="Operação da loja">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Store className={company.isOpen ? 'h-8 w-8 text-success' : 'h-8 w-8 text-muted'} aria-hidden />
                  <div>
                    <p className="font-semibold">{company.isOpen ? 'Loja aberta' : 'Loja pausada'}</p>
                    <p className="flex items-center gap-1 text-sm text-muted">
                      <Clock className="h-3.5 w-3.5" aria-hidden />
                      {company.isOpenNow ? 'Recebendo pedidos agora' : company.isOpen ? 'Fora do horário de funcionamento' : 'Não está recebendo pedidos'}
                    </p>
                  </div>
                </div>
                {can('company.orders.manage') && (
                  <Button variant={company.isOpen ? 'secondary' : 'success'} loading={busy} onClick={toggleOpen}>
                    {company.isOpen ? 'Pausar loja' : 'Abrir loja'}
                  </Button>
                )}
              </div>
              {can('company.orders.read') && (
                <p className="mt-4 text-sm text-muted">
                  Acompanhe os pedidos em{' '}
                  <Link href={`/empresa/${company.id}/pedidos`} className="text-brand-600 hover:underline">
                    Pedidos
                  </Link>{' '}
                  e as conversas com clientes e entregadores em{' '}
                  <Link href={`/empresa/${company.id}/mensagens`} className="text-brand-600 hover:underline">
                    Mensagens
                  </Link>
                  .
                </p>
              )}
            </Card>
          )}
        </div>

        <Card title="Checklist do cadastro">
          <Checklist items={company.requirements} />
          {pending.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              {pending.some((item) => item.key === 'address' || item.key === 'opening_hours') && (
                <Link href={`/empresa/${company.id}/endereco`} className="text-brand-600 hover:underline">
                  Endereço e horários
                </Link>
              )}
              {pending.some((item) => item.key.startsWith('document:')) && (
                <Link href={`/empresa/${company.id}/documentos`} className="text-brand-600 hover:underline">
                  Documentos
                </Link>
              )}
              {pending.some((item) => item.key === 'bank_account') && (
                <Link href={`/empresa/${company.id}/financeiro`} className="text-brand-600 hover:underline">
                  Dados bancários
                </Link>
              )}
            </div>
          )}
          {company.segment.isRegulated && (
            <p className="mt-4 text-xs text-muted">
              <Badge tone="warning">Segmento regulado</Badge> Documentos adicionais são exigidos por lei para este segmento.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
