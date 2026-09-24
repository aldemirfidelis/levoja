'use client';

import { useState } from 'react';
import { RefreshCw, Timer } from 'lucide-react';
import { ETA_BAND_LABELS, VEHICLE_TYPE_LABELS, type VehicleType } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { Card, DataTable, EmptyState, ErrorState, formatDateTime, PageHeader, Button, Skeleton, StatCard, useToast } from '@levoja/web-kit/ui';
import { cityLabel, IntelligenceNav } from '@/components/intelligence-nav';

interface Calibration {
  id: string;
  city: string;
  vehicle: string;
  band: number;
  transitFactor: number;
  pickupMinutes: number | null;
  dispatchMinutes: number | null;
  samples: number;
  maeBeforeMin: number | null;
  maeAfterMin: number | null;
}

interface EtaView {
  overall: Calibration | null;
  groups: Calibration[];
  companies: { id: string; tradeName: string; averagePrepMinutes: number; learnedPrepMinutes: number | null }[];
  updatedAt: string | null;
}

const minutes = (value: number | null | undefined) => (value == null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min`);

export default function EtaPage() {
  const toast = useToast();
  const { data, error, isLoading, refetch } = useApi<EtaView>('admin/intelligence/eta');
  const [busy, setBusy] = useState(false);

  const calibrate = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ samples: number; groups: number; companies: number }>('admin/intelligence/eta/calibrate');
      toast.success(`Calibração concluída: ${result.samples} entregas, ${result.groups} grupos e ${result.companies} loja(s) com preparo aprendido.`);
      await refetch();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const overall = data?.overall;
  const specific = data?.groups.filter((group) => group.band >= 0) ?? [];

  return (
    <>
      <PageHeader
        title="Inteligência"
        description="Previsão do tempo de entrega calibrada pelo histórico: o tempo estimado pela rota é corrigido pelo fator real de cada cidade, veículo e horário, e as esperas usam as medianas observadas."
        actions={
          <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={busy} onClick={() => void calibrate()}>
            Recalibrar agora
          </Button>
        }
      />
      <IntelligenceNav />
      {isLoading && <Skeleton className="h-96" />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && !overall && <EmptyState icon={<Timer className="h-8 w-8" />} title="Ainda sem calibração" description="São necessárias entregas concluídas suficientes (configuração: amostras mínimas). A calibração roda toda madrugada." />}
      {data && overall && (
        <>
          <p className="mb-4 text-xs text-muted">Atualizada em {formatDateTime(data.updatedAt)} · {overall.samples.toLocaleString('pt-BR')} entregas analisadas.</p>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Fator geral de trajeto" value={`× ${overall.transitFactor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`} hint="Tempo real ÷ tempo estimado pela rota" />
            <StatCard label="Erro médio antes" value={minutes(overall.maeBeforeMin)} hint="Estimativa só pela rota" />
            <StatCard label="Erro médio calibrado" value={minutes(overall.maeAfterMin)} tone={overall.maeAfterMin != null && overall.maeBeforeMin != null && overall.maeAfterMin < overall.maeBeforeMin ? 'success' : 'neutral'} />
            <StatCard label="Esperas (medianas)" value={minutes(overall.dispatchMinutes)} hint={`até achar entregador · ${minutes(overall.pickupMinutes)} até a coleta`} />
          </div>
          <div className="grid gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <Card title="Fatores por cidade, veículo e horário">
                <DataTable
                  rows={specific}
                  rowKey={(row) => row.id}
                  columns={[
                    { key: 'city', header: 'Cidade', cell: (row) => (row.city === '*' ? 'Todas' : cityLabel(row.city)) },
                    { key: 'vehicle', header: 'Veículo', cell: (row) => (row.vehicle === '*' ? 'Todos' : (VEHICLE_TYPE_LABELS[row.vehicle as VehicleType] ?? row.vehicle)) },
                    { key: 'band', header: 'Horário', cell: (row) => ETA_BAND_LABELS[row.band] ?? '—', hideOnMobile: true },
                    { key: 'factor', header: 'Fator', className: 'text-right tabular-nums', cell: (row) => `× ${row.transitFactor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}` },
                    { key: 'mae', header: 'Erro (antes → depois)', className: 'text-right tabular-nums', cell: (row) => `${minutes(row.maeBeforeMin)} → ${minutes(row.maeAfterMin)}`, hideOnMobile: true },
                    { key: 'samples', header: 'Amostras', className: 'text-right tabular-nums', cell: (row) => row.samples.toLocaleString('pt-BR'), hideOnMobile: true },
                  ]}
                />
              </Card>
            </div>
            <Card title="Preparo real das lojas">
              {data.companies.length === 0 ? (
                <p className="text-sm text-muted">Nenhuma loja com histórico suficiente (mínimo de 10 pedidos no período).</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {data.companies.map((company) => {
                    const gap = (company.learnedPrepMinutes ?? 0) - company.averagePrepMinutes;
                    return (
                      <li key={company.id} className="flex items-center justify-between gap-2 py-2">
                        <span className="min-w-0 truncate text-fg">{company.tradeName}</span>
                        <span className={`shrink-0 tabular-nums ${gap > 5 ? 'text-danger' : 'text-muted'}`}>
                          {company.learnedPrepMinutes} min <span className="text-xs">(informa {company.averagePrepMinutes})</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted">A previsão mostrada ao cliente usa o preparo real quando há histórico.</p>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
