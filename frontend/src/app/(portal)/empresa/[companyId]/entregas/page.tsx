'use client';

import { useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { Button, useToast } from '@levoja/web-kit/ui';
import { DeliveriesList } from '@/components/deliveries-list';
import { DeliveryDetail } from '@/components/delivery-detail';
import { DeliveryRequestForm } from '@/components/delivery-request';
import { useCompany } from '@/lib/company';

type View = { mode: 'list' } | { mode: 'new' } | { mode: 'detail'; id: string };

export default function CompanyDeliveriesPage() {
  const { company, can } = useCompany();
  const toast = useToast();
  const [view, setView] = useState<View>({ mode: 'list' });
  const base = `companies/${company.id}/deliveries`;
  const back = (
    <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} className="mb-4" onClick={() => setView({ mode: 'list' })}>
      Entregas
    </Button>
  );

  if (view.mode === 'new') {
    return (
      <>
        {back}
        <DeliveryRequestForm
          basePath={base}
          isCompany
          companyId={company.id}
          onCreated={(id) => {
            toast.success('Entrega solicitada.');
            setView({ mode: 'detail', id });
          }}
        />
      </>
    );
  }
  if (view.mode === 'detail') {
    return (
      <>
        {back}
        <DeliveryDetail path={`${base}/${view.id}`} />
      </>
    );
  }
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Entregas dos seus pedidos e entregas avulsas solicitadas pela empresa.</p>
        {can('company.deliveries.request') && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setView({ mode: 'new' })}>
            Solicitar entrega avulsa
          </Button>
        )}
      </div>
      <DeliveriesList path={base} onOpen={(delivery) => setView({ mode: 'detail', id: delivery.id })} />
    </>
  );
}
