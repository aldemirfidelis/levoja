'use client';

import { Suspense, useState } from 'react';
import { Activity, AlertOctagon, AlertTriangle, CheckCircle2, ScanSearch } from 'lucide-react';
import { ANOMALY_KIND_LABELS, ANOMALY_STATUS_LABELS, type AnomalyKind, type AnomalyStatus } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { Badge, Button, EmptyState, ErrorState, formatDateTime, PageHeader, Select, SkeletonRows, useToast } from '@levoja/web-kit/ui';
import { ANOMALY_TONE, cityLabel, IntelligenceNav, percent } from '@/components/intelligence-nav';
import { useUrlFilters } from '@/components/list-filters';

interface Anomaly {
  id: string;
  kind: AnomalyKind;
  severity: 'WARNING' | 'CRITICAL';
  status: AnomalyStatus;
  city: string | null;
  windowStart: string;
  windowEnd: string;
  observed: number;
  expected: number;
  zScore: number;
  message: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

const RATE_KINDS: AnomalyKind[] = ['CANCELLATION_SPIKE', 'PAYMENT_FAILURE_SPIKE'];

function value(anomaly: Anomaly, raw: number) {
  if (RATE_KINDS.includes(anomaly.kind)) return percent(raw, 1);
  if (anomaly.kind === 'DISPATCH_DELAY') return `${raw.toLocaleString('pt-BR')} min`;
  return raw.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

function AnomaliesView() {
  const toast = useToast();
  const [filters, setFilters] = useUrlFilters({ status: '' });
  const { data, error, isLoading, refetch } = useApi<Anomaly[]>('admin/intelligence/anomalies', { status: filters.status }, { refetchInterval: 60_000 });
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (key: string, path: string, success: string) => {
    setBusy(key);
    try {
      await api.post(path);
      toast.success(success);
      await refetch();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Inteligência"
        description="Desvios detectados a cada 10 minutos: volume fora da previsão, picos de cancelamento e de pagamentos recusados e despacho lento. Também aparecem na torre de controle."
        actions={
          <Button
            variant="secondary"
            icon={<ScanSearch className="h-4 w-4" />}
            loading={busy === 'scan'}
            onClick={() => void act('scan', 'admin/intelligence/anomalies/scan', 'Verificação concluída.')}
          >
            Verificar agora
          </Button>
        }
      />
      <IntelligenceNav />
      <Select
        aria-label="Situação"
        className="mb-4 sm:w-60"
        value={filters.status}
        onChange={(event) => setFilters({ status: event.target.value })}
        options={[{ value: '', label: 'Abertas e em acompanhamento' }, ...Object.entries(ANOMALY_STATUS_LABELS).map(([key, label]) => ({ value: key, label }))]}
      />
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.length === 0 && <EmptyState icon={<Activity className="h-8 w-8" />} title="Nenhuma anomalia" description="Os indicadores estão dentro do esperado." />}
      <ul className="space-y-3">
        {data?.map((anomaly) => (
          <li key={anomaly.id} className="rounded-xl border border-border bg-surface p-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                {anomaly.severity === 'CRITICAL' ? <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />}
                <div className="min-w-0">
                  <p className="font-medium text-fg">
                    {ANOMALY_KIND_LABELS[anomaly.kind]} {anomaly.city ? `· ${cityLabel(anomaly.city)}` : ''}
                  </p>
                  <p className="mt-0.5 text-fg">{anomaly.message}</p>
                  <p className="mt-1 text-xs text-muted">
                    {anomaly.severity === 'CRITICAL' ? 'Crítica' : 'Atenção'} · observado {value(anomaly, anomaly.observed)} × esperado {value(anomaly, anomaly.expected)} · desvio {anomaly.zScore.toLocaleString('pt-BR')} ·{' '}
                    {formatDateTime(anomaly.windowStart)} a {formatDateTime(anomaly.windowEnd)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={ANOMALY_TONE[anomaly.status]}>{ANOMALY_STATUS_LABELS[anomaly.status]}</Badge>
                {anomaly.status === 'OPEN' && (
                  <Button size="sm" variant="secondary" loading={busy === `ack-${anomaly.id}`} onClick={() => void act(`ack-${anomaly.id}`, `admin/intelligence/anomalies/${anomaly.id}/acknowledge`, 'Anomalia em acompanhamento.')}>
                    Acompanhar
                  </Button>
                )}
                {anomaly.status !== 'RESOLVED' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    loading={busy === `res-${anomaly.id}`}
                    onClick={() => void act(`res-${anomaly.id}`, `admin/intelligence/anomalies/${anomaly.id}/resolve`, 'Anomalia encerrada.')}
                  >
                    Encerrar
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function AnomaliesPage() {
  return (
    <Suspense>
      <AnomaliesView />
    </Suspense>
  );
}
