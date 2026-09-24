'use client';

import { Suspense, useState } from 'react';
import { Plus, TicketPercent } from 'lucide-react';
import { api, Paginated, useApi } from '@levoja/web-kit/client';
import { Button, CouponForm, CouponRecord, CouponsTable, EmptyState, ErrorState, PageHeader, Pagination, Select, SkeletonRows, useToast } from '@levoja/web-kit/ui';
import { CompanyPicker } from '@/components/company-picker';
import { SearchInput, useUrlFilters } from '@/components/list-filters';

function AdminCouponForm({ coupon, onClose, onSaved }: { coupon: CouponRecord | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { data: segments } = useApi<{ id: string; name: string }[]>('segments');
  const [company, setCompany] = useState<{ id: string; name: string } | null>(coupon?.companyId ? { id: coupon.companyId, name: coupon.companyName ?? 'Empresa' } : null);
  const [fundedBy, setFundedBy] = useState<'PLATFORM' | 'COMPANY'>(coupon?.fundedBy ?? 'PLATFORM');

  return (
    <CouponForm
      coupon={coupon}
      segments={segments ?? []}
      onClose={onClose}
      extraFields={
        coupon ? (
          <p className="self-end text-sm text-muted sm:col-span-2">
            Escopo: {coupon.companyName ?? 'todas as lojas'} · custo da {coupon.fundedBy === 'COMPANY' ? 'loja' : 'plataforma'} (definidos na criação).
          </p>
        ) : (
          <>
            <CompanyPicker label="Loja" value={company} onChange={setCompany} hint="Opcional: restringe o cupom a uma loja." />
            <Select
              label="Quem paga o desconto"
              value={fundedBy}
              options={[
                { value: 'PLATFORM', label: 'Plataforma (marketing)' },
                { value: 'COMPANY', label: 'Loja (abatido do repasse)' },
              ]}
              onChange={(e) => setFundedBy(e.target.value as 'PLATFORM' | 'COMPANY')}
              hint={fundedBy === 'COMPANY' && !company ? 'Selecione a loja que financia o desconto.' : undefined}
            />
          </>
        )
      }
      onSubmit={async (body) => {
        if (coupon) await api.patch(`admin/finance/coupons/${coupon.id}`, body);
        else await api.post('admin/finance/coupons', { ...body, companyId: company?.id, fundedBy });
        toast.success('Cupom salvo.');
        onSaved();
      }}
    />
  );
}

function CouponsList() {
  const [filters, setFilters] = useUrlFilters({ search: '', page: '1' });
  const [editing, setEditing] = useState<CouponRecord | 'new' | null>(null);
  const { data, error, isLoading, refetch } = useApi<Paginated<CouponRecord>>('admin/finance/coupons', { search: filters.search, page: filters.page, pageSize: 25 });

  return (
    <>
      <PageHeader
        title="Cupons e promoções"
        description="Cupons percentuais, de valor fixo ou de entrega grátis, com validade, dias/horários, pedido mínimo, limite de usos e primeira compra. Cupons de lojas também aparecem aqui."
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Novo cupom</Button>}
      />
      <div className="mb-4">
        <SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Código do cupom" />
      </div>
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.data.length === 0 && <EmptyState icon={<TicketPercent className="h-8 w-8" />} title="Nenhum cupom encontrado" />}
      {!!data?.data.length && (
        <>
          <CouponsTable rows={data.data} onEdit={setEditing} showOwner />
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={(page) => setFilters({ page: String(page) })} />
        </>
      )}
      {editing && <AdminCouponForm coupon={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => refetch()} />}
    </>
  );
}

export default function CouponsPage() {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <CouponsList />
    </Suspense>
  );
}
