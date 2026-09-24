'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useApi } from '@levoja/web-kit/client';
import {
  Badge,
  Card,
  DescriptionList,
  ErrorState,
  formatDateTime,
  formatPhone,
  PageHeader,
  PartnerStatusBadge,
  SkeletonRows,
} from '@levoja/web-kit/ui';
import { DocumentsReview, PartnerActions, RequirementsList, StatusHistory } from '@/components/partner-review';
import { useSession } from '@/lib/session';
import type { CompanyDetail } from '@/lib/types';

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const FULFILLMENT: Record<string, string> = { PLATFORM: 'Entregadores da plataforma', OWN_FLEET: 'Frota própria', HYBRID: 'Plataforma + frota própria' };

export default function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useSession();
  const { data, error, isLoading, refetch } = useApi<CompanyDetail>(`admin/companies/${id}`);
  const basePath = `admin/companies/${id}`;

  const back = (
    <Link href="/empresas" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
      <ArrowLeft className="h-4 w-4" /> Empresas
    </Link>
  );

  if (isLoading) return <SkeletonRows rows={8} />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <>
      <PageHeader
        back={back}
        title={data.tradeName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <PartnerStatusBadge status={data.status} />
            <span>{data.segment.name}</span>
            {data.segment.isRegulated && <Badge tone="warning">Segmento regulado</Badge>}
            {data.status === 'APPROVED' && <Badge tone={data.isOpen ? 'success' : 'neutral'}>{data.isOpen ? 'Loja aberta' : 'Loja fechada'}</Badge>}
          </span>
        }
        actions={<PartnerActions actions={data.adminActions} basePath={basePath} onDone={() => refetch()} subject={data.tradeName} />}
      />

      {data.statusReason && (
        <p className="mb-6 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-fg">
          <strong>Motivo registrado:</strong> {data.statusReason}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Documentos">
            <DocumentsReview documents={data.documents} basePath={basePath} canReview={can('companies.review')} onChange={() => refetch()} />
          </Card>

          <Card title="Dados cadastrais">
            <DescriptionList
              items={[
                { label: 'Razão social', value: data.legalName },
                { label: 'CNPJ', value: data.cnpj },
                { label: 'Responsável', value: `${data.responsibleName} (CPF ${data.responsibleCpfMasked})` },
                { label: 'E-mail', value: data.email },
                { label: 'Telefone', value: formatPhone(data.phone) },
                { label: 'Entregas', value: FULFILLMENT[data.fulfillmentMode] ?? data.fulfillmentMode },
                {
                  label: 'Endereço',
                  value: data.address
                    ? `${data.address.street}, ${data.address.number}${data.address.complement ? ` - ${data.address.complement}` : ''} — ${data.address.district}, ${data.address.city}/${data.address.state} · CEP ${data.address.zipCode}`
                    : null,
                },
                { label: 'Cadastrada em', value: formatDateTime(data.createdAt) },
                { label: 'Enviada para análise', value: formatDateTime(data.submittedAt) },
                { label: 'Aprovada em', value: formatDateTime(data.approvedAt) },
              ]}
            />
            {data.description && <p className="mt-4 text-sm text-muted">{data.description}</p>}
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card title="Horário de funcionamento">
              {data.openingHours.length === 0 ? (
                <p className="text-sm text-muted">Não informado.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {data.openingHours.map((hour, index) => (
                    <li key={index} className="flex justify-between">
                      <span className="text-muted">{WEEKDAYS[hour.weekday]}</span>
                      <span className="tabular-nums">
                        {hour.opensAt} – {hour.closesAt}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Dados para repasse">
              {data.bankAccount ? (
                <DescriptionList
                  items={[
                    { label: 'Titular', value: data.bankAccount.holderName },
                    { label: 'Banco / agência', value: `${data.bankAccount.bankCode} / ${data.bankAccount.branch}` },
                    { label: 'Conta', value: `••••${data.bankAccount.accountLast4}` },
                    { label: 'Chave PIX', value: data.bankAccount.pixKeyMasked ? `${data.bankAccount.pixKeyType}: ${data.bankAccount.pixKeyMasked}` : null },
                  ]}
                />
              ) : (
                <p className="text-sm text-muted">Não informado.</p>
              )}
            </Card>
          </div>

          <Card title={`Equipe (${data.members.length})`}>
            <ul className="divide-y divide-border">
              {data.members.map((member) => (
                <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <span className="font-medium text-fg">{member.name}</span> <span className="text-muted">{member.email}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone="brand">{member.role.name}</Badge>
                    {!member.isActive && <Badge>Inativo</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <RequirementsList items={data.requirements} />
          <StatusHistory entries={data.history} />
          {can('audit.read') && (
            <Link href={`/auditoria?entityType=Company&entityId=${data.id}`} className="block text-center text-sm text-brand-600 hover:underline">
              Ver trilha de auditoria desta empresa
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
