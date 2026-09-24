'use client';

import { useState } from 'react';
import { Plus, TicketPercent } from 'lucide-react';
import { api, Paginated, useApi } from '@levoja/web-kit/client';
import { Button, CouponForm, CouponRecord, CouponsTable, EmptyState, ErrorState, Pagination, SkeletonRows, useToast } from '@levoja/web-kit/ui';
import { useCompany } from '@/lib/company';

export default function CompanyCouponsPage() {
  const { company, can } = useCompany();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<CouponRecord | 'new' | null>(null);
  const base = `companies/${company.id}/coupons`;
  const { data, error, isLoading, refetch } = useApi<Paginated<CouponRecord>>(base, { page, pageSize: 20 });
  const manage = can('company.products.manage');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          Cupons exclusivos da sua loja. O desconto é abatido do valor da venda no repasse e a comissão é calculada sobre o valor já com desconto.
        </p>
        {manage && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            Novo cupom
          </Button>
        )}
      </div>
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.data.length === 0 && <EmptyState icon={<TicketPercent className="h-8 w-8" />} title="Nenhum cupom criado" description="Crie cupons de desconto, entrega grátis ou promoções por horário." />}
      {!!data?.data.length && (
        <>
          <CouponsTable rows={data.data} onEdit={manage ? setEditing : undefined} />
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={setPage} />
        </>
      )}
      {editing && (
        <CouponForm
          coupon={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={async (body) => {
            if (editing === 'new') await api.post(base, body);
            else await api.patch(`${base}/${editing.id}`, body);
            toast.success('Cupom salvo.');
            await refetch();
          }}
        />
      )}
    </div>
  );
}
