'use client';

import { Paginated, useApi } from '@levoja/web-kit/client';
import { Card, SupportCenter } from '@levoja/web-kit/ui';
import { useCompany } from '@/lib/company';

/** Chamados da empresa com a plataforma (visíveis para toda a equipe com permissão). */
export default function CompanySupportPage() {
  const { company, can } = useCompany();
  const { data } = useApi<Paginated<{ id: string; number: number }>>(can('company.orders.read') ? `companies/${company.id}/orders` : null, { pageSize: 30 });
  return (
    <Card title="Atendimento">
      <SupportCenter as="COMPANY" companyId={company.id} orderOptions={data?.data.map((order) => ({ id: order.id, label: `Pedido #${order.number}` }))} />
    </Card>
  );
}
