'use client';

import { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Briefcase, Plus } from 'lucide-react';
import { CONTRACT_STATUS_LABELS, formatBRL, type ContractStatus } from '@levoja/shared';
import { api, Paginated, useApi } from '@levoja/web-kit/client';
import { Badge, Button, DataTable, Dialog, EmptyState, ErrorState, formatDate, PageHeader, Pagination, Select, SkeletonRows, useToast } from '@levoja/web-kit/ui';
import { B2bNav, CONTRACT_TONE } from '@/components/b2b-nav';
import { ContractForm } from '@/components/contract-form';
import { SearchInput, useUrlFilters } from '@/components/list-filters';
import { useSession } from '@/lib/session';

interface ContractRow {
  id: string;
  number: number;
  title: string;
  status: ContractStatus;
  company: { id: string; tradeName: string };
  startsOn: string;
  endsOn: string | null;
  creditLimitCents: number;
  discountBps: number;
  billingDay: number;
  priceRules: number;
}

function ContractsView() {
  const router = useRouter();
  const toast = useToast();
  const { can } = useSession();
  const [filters, setFilters] = useUrlFilters({ status: '', search: '', page: '1' });
  const { data, error, isLoading, refetch } = useApi<Paginated<ContractRow>>('admin/b2b/contracts', { ...filters, pageSize: 25 });
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Corporativo (B2B)"
        description="Contratos com empresas: faturamento mensal, limite de crédito, tabela especial e franquias."
        actions={can('contracts.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Novo contrato</Button>}
      />
      <B2bNav />
      <div className="mb-4 flex flex-wrap gap-3">
        <SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Número, título ou empresa" />
        <Select
          aria-label="Situação"
          className="w-44"
          value={filters.status}
          onChange={(event) => setFilters({ status: event.target.value })}
          options={[{ value: '', label: 'Todas as situações' }, ...Object.entries(CONTRACT_STATUS_LABELS).map(([value, label]) => ({ value, label }))]}
        />
      </div>
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.data.length === 0 && <EmptyState icon={<Briefcase className="h-8 w-8" />} title="Nenhum contrato" />}
      {data && data.data.length > 0 && (
        <>
          <DataTable
            rows={data.data}
            rowKey={(row) => row.id}
            onRowClick={(row) => router.push(`/b2b/contratos/${row.id}`)}
            columns={[
              {
                key: 'contract',
                header: 'Contrato',
                cell: (row) => (
                  <div>
                    <p className="font-medium">
                      #{row.number} · {row.title}
                    </p>
                    <p className="text-xs text-muted">{row.company.tradeName}</p>
                  </div>
                ),
              },
              { key: 'status', header: 'Situação', cell: (row) => <Badge tone={CONTRACT_TONE[row.status]}>{CONTRACT_STATUS_LABELS[row.status]}</Badge> },
              { key: 'credit', header: 'Crédito', className: 'text-right tabular-nums', cell: (row) => formatBRL(row.creditLimitCents), hideOnMobile: true },
              { key: 'pricing', header: 'Preço', cell: (row) => (row.priceRules ? `Tabela especial (${row.priceRules})` : row.discountBps ? `-${(row.discountBps / 100).toLocaleString('pt-BR')}%` : 'Tabela padrão'), hideOnMobile: true },
              { key: 'validity', header: 'Vigência', cell: (row) => `${formatDate(row.startsOn)}${row.endsOn ? ` a ${formatDate(row.endsOn)}` : ''}`, hideOnMobile: true },
            ]}
          />
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={(page) => setFilters({ page: String(page) })} />
        </>
      )}
      {creating && (
        <Dialog open onClose={() => setCreating(false)} size="lg" title="Novo contrato" description="O contrato nasce como rascunho; a ativação libera o faturado para a empresa.">
          <ContractForm
            withCompany
            submitLabel="Criar rascunho"
            onCancel={() => setCreating(false)}
            onSubmit={async (values) => {
              try {
                const created = await api.post<{ id: string }>('admin/b2b/contracts', values);
                toast.success('Contrato criado.');
                router.push(`/b2b/contratos/${created.id}`);
              } catch (err) {
                toast.error(err);
              }
            }}
          />
        </Dialog>
      )}
    </>
  );
}

export default function ContractsPage() {
  return (
    <Suspense>
      <ContractsView />
    </Suspense>
  );
}
