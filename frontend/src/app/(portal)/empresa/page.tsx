'use client';

import Link from 'next/link';
import { Building2, Plus } from 'lucide-react';
import { useApi } from '@levoja/web-kit/client';
import { EmptyState, ErrorState, PageHeader, PartnerStatusBadge, SkeletonRows } from '@levoja/web-kit/ui';
import type { PartnerStatus } from '@levoja/shared';

interface MyCompany {
  id: string;
  tradeName: string;
  status: PartnerStatus;
  isOpen: boolean;
  logoUrl: string | null;
  role: { key: string; name: string };
}

export default function MyCompaniesPage() {
  const { data, error, isLoading, refetch } = useApi<MyCompany[]>('companies/mine');
  return (
    <>
      <PageHeader
        title="Minhas empresas"
        actions={
          <Link href="/empresa/nova" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600">
            <Plus className="h-4 w-4" /> Nova empresa
          </Link>
        }
      />
      {isLoading && <SkeletonRows rows={3} />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.length === 0 && (
        <EmptyState
          icon={<Building2 className="h-8 w-8" />}
          title="Você ainda não participa de nenhuma empresa"
          description="Cadastre sua empresa para vender e entregar pela plataforma."
          action={
            <Link href="/empresa/nova" className="font-semibold text-brand-600 hover:underline">
              Cadastrar empresa
            </Link>
          }
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.map((company) => (
          <Link key={company.id} href={`/empresa/${company.id}`} className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-5 hover:border-brand-300 hover:shadow-md">
            {company.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logoUrl} alt="" className="h-14 w-14 rounded-xl object-cover" />
            ) : (
              <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-surface-2 text-xl font-bold text-muted">{company.tradeName[0]}</span>
            )}
            <div className="min-w-0">
              <p className="truncate font-bold text-fg">{company.tradeName}</p>
              <p className="text-xs text-muted">{company.role.name}</p>
              <div className="mt-1">
                <PartnerStatusBadge status={company.status} />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
