'use client';

import { useState } from 'react';
import { api, buildQuery, useApi } from '@levoja/web-kit/client';
import { Card, Input, ReportView, Select, Skeleton, type ReportData } from '@levoja/web-kit/ui';
import type { CostCenter } from '@/components/b2b';
import { useCompany } from '@/lib/company';
import { PlanAwareError } from '@/components/plan-gate';

const localDate = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date);

export default function CorporateReportPage() {
  const { company } = useCompany();
  const [from, setFrom] = useState(localDate(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(localDate(new Date()));
  const [granularity, setGranularity] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const { data: centers } = useApi<CostCenter[]>(`companies/${company.id}/b2b/cost-centers`);
  const query = { from, to, granularity: granularity || undefined, costCenterId: costCenterId || undefined };
  const { data, error, isLoading, isFetching, refetch } = useApi<ReportData>(`companies/${company.id}/b2b/report`, query, { placeholderData: (previous) => previous });

  return (
    <div className="space-y-6">
      <Card>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Input label="De" type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
          <Input label="Até" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
          <Select
            label="Agrupar por"
            value={granularity}
            onChange={(event) => setGranularity(event.target.value)}
            options={[
              { value: '', label: 'Automático' },
              { value: 'day', label: 'Dia' },
              { value: 'week', label: 'Semana' },
              { value: 'month', label: 'Mês' },
            ]}
          />
          <Select
            label="Centro de custo"
            value={costCenterId}
            onChange={(event) => setCostCenterId(event.target.value)}
            options={[{ value: '', label: 'Todos' }, ...(centers ?? []).map((center) => ({ value: center.id, label: `${center.code} — ${center.name}` }))]}
          />
        </div>
      </Card>
      {error && <PlanAwareError error={error} onRetry={() => refetch()} />}
      {isLoading && <Skeleton className="h-96" />}
      {data && <ReportView report={data} faded={isFetching} csvUrl={(table) => api.fileUrl(`companies/${company.id}/b2b/report${buildQuery({ ...query, format: 'csv', table })}`)} />}
    </div>
  );
}
