'use client';

import Link from 'next/link';
import { Building2, FileSpreadsheet, Repeat, Receipt } from 'lucide-react';
import { formatBRL, VEHICLE_TYPE_LABELS } from '@levoja/shared';
import { useApi } from '@levoja/web-kit/client';
import { Badge, Card, DescriptionList, ErrorState, Skeleton, formatDate } from '@levoja/web-kit/ui';
import type { B2bOverview } from '@/components/b2b';
import { useCompany } from '@/lib/company';

/** Uso do limite de crédito: a cor da barra indica o nível (com o percentual escrito ao lado). */
function CreditMeter({ used, limit }: { used: number; limit: number }) {
  const share = limit ? Math.min(1, used / limit) : 0;
  const color = share >= 0.9 ? 'var(--lj-danger)' : share >= 0.7 ? 'var(--lj-warning)' : 'var(--lj-chart-1)';
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-muted">Crédito utilizado</span>
        <span className="font-semibold tabular-nums text-fg">
          {formatBRL(used)} de {formatBRL(limit)} ({Math.round(share * 100)}%)
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label="Crédito utilizado">
        <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: color }} />
      </div>
    </div>
  );
}

export default function CorporateOverviewPage() {
  const { company, can } = useCompany();
  const { data, error, isLoading, refetch } = useApi<B2bOverview>(`companies/${company.id}/b2b`);
  const base = `/empresa/${company.id}/corporativo`;

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-64" />;
  const contract = data.contract;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {contract ? (
          <Card title={`Contrato #${contract.number} — ${contract.title}`} actions={<Badge tone="success">Ativo</Badge>}>
            <div className="space-y-5">
              <CreditMeter used={data.exposureCents} limit={contract.creditLimitCents} />
              <DescriptionList
                items={[
                  { label: 'Vigência', value: `${formatDate(contract.startsOn)}${contract.endsOn ? ` a ${formatDate(contract.endsOn)}` : ' (sem término)'}` },
                  { label: 'Fechamento da fatura', value: `Todo dia ${contract.billingDay} · vencimento em ${contract.paymentTermDays} dia(s)` },
                  { label: 'Crédito disponível', value: formatBRL(data.availableCreditCents) },
                  { label: 'Franquia mínima mensal', value: contract.minimumMonthlyCents ? formatBRL(contract.minimumMonthlyCents) : 'Não há' },
                  { label: 'Desconto sobre a tabela padrão', value: contract.discountBps ? `${(contract.discountBps / 100).toLocaleString('pt-BR')}%` : '—' },
                  { label: 'Centro de custo', value: contract.requireCostCenter ? 'Obrigatório em todas as entregas' : 'Opcional' },
                  { label: 'Aviso aos destinatários', value: contract.notifyRecipients ? 'SMS com link de acompanhamento' : 'Desativado' },
                ]}
              />
              {contract.priceRules.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-semibold">Tabela especial</p>
                  <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                    {contract.priceRules.map((rule) => (
                      <li key={rule.name} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                        <span>
                          {rule.name}
                          <span className="text-muted">
                            {rule.vehicleType ? ` · ${VEHICLE_TYPE_LABELS[rule.vehicleType as keyof typeof VEHICLE_TYPE_LABELS]}` : ''}
                            {rule.city ? ` · ${rule.city}` : ''}
                          </span>
                        </span>
                        <span className="tabular-nums">
                          {formatBRL(rule.baseCents)}
                          {rule.includedKm ? ` até ${rule.includedKm} km` : ''}
                          {rule.perKmCents ? ` + ${formatBRL(rule.perKmCents)}/km` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>
        ) : (
          <Card title="Sem contrato corporativo ativo">
            <p className="text-sm text-muted">
              {data.contractStatus === 'SUSPENDED'
                ? 'Seu contrato está suspenso: entregas faturadas estão bloqueadas até a regularização.'
                : data.contractStatus === 'DRAFT'
                  ? 'Seu contrato está em preparação pela nossa equipe comercial.'
                  : 'Com um contrato, sua empresa ganha entregas faturadas mensalmente, limite de crédito, tabela especial de preços e franquias.'}{' '}
              Enquanto isso, lotes e recorrências podem ser pagos com o saldo da carteira.
            </p>
            {can('company.support.use') && (
              <Link href={`/empresa/${company.id}/suporte`} className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline">
                Falar com o comercial (abrir chamado)
              </Link>
            )}
          </Card>
        )}
      </div>
      <div className="space-y-4">
        {can('company.finance.read') && (
          <Card title="Faturas">
            <p className="text-sm">
              <strong>{data.openInvoices}</strong> em aberto{data.overdueInvoices ? <span className="text-danger"> · {data.overdueInvoices} vencida(s)</span> : null}
            </p>
            <Link href={`${base}/faturas`} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
              <Receipt className="h-4 w-4" aria-hidden /> Ver faturas
            </Link>
          </Card>
        )}
        {can('company.deliveries.request') && (
          <Card title="Atalhos">
            <ul className="space-y-2 text-sm">
              <li>
                <Link href={`${base}/lotes`} className="inline-flex items-center gap-2 text-brand-600 hover:underline">
                  <FileSpreadsheet className="h-4 w-4" aria-hidden /> Importar lote de entregas (CSV/Excel)
                </Link>
              </li>
              <li>
                <Link href={`${base}/recorrentes`} className="inline-flex items-center gap-2 text-brand-600 hover:underline">
                  <Repeat className="h-4 w-4" aria-hidden /> Entregas recorrentes
                </Link>
              </li>
              <li>
                <Link href={`${base}/unidades`} className="inline-flex items-center gap-2 text-brand-600 hover:underline">
                  <Building2 className="h-4 w-4" aria-hidden /> Unidades e transferências
                </Link>
              </li>
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
