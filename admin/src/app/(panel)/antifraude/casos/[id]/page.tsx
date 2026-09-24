'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Eye, ShieldX } from 'lucide-react';
import { RISK_CASE_STATUS_LABELS, type RiskCaseStatus, type RiskLevel } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { Badge, Button, Dialog, ErrorState, formatDateTime, Input, PageHeader, Skeleton, Textarea, useToast } from '@levoja/web-kit/ui';
import { RISK_CASE_TONE } from '@/components/intelligence-nav';
import { RiskSubjectData, RiskSubjectView, ScoreMeter } from '@/components/risk-subject';
import { useSession } from '@/lib/session';

interface CaseDetail extends RiskSubjectData {
  id: string;
  number: number;
  status: RiskCaseStatus;
  level: RiskLevel;
  score: number;
  summary: string;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export default function RiskCasePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const toast = useToast();
  const { data, error, isLoading, refetch } = useApi<CaseDetail>(`admin/intelligence/fraud/cases/${id}`);
  const [decision, setDecision] = useState<'dismiss' | 'confirm' | null>(null);
  const [reason, setReason] = useState('');
  const [trustDays, setTrustDays] = useState(30);
  const [busy, setBusy] = useState(false);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-96" />;
  const open = data.status === 'OPEN' || data.status === 'IN_REVIEW';

  const startReview = async () => {
    try {
      await api.post(`admin/intelligence/fraud/cases/${id}/review`);
      toast.success('Caso em análise com você.');
      await refetch();
    } catch (err) {
      toast.error(err);
    }
  };

  const decide = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post(`admin/intelligence/fraud/cases/${id}/${decision}`, decision === 'dismiss' ? { reason, trustDays } : { reason });
      toast.success(decision === 'dismiss' ? 'Caso descartado.' : 'Fraude confirmada.');
      setDecision(null);
      setReason('');
      await refetch();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        back={
          <Link href="/antifraude" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" /> Antifraude
          </Link>
        }
        title={`Caso #${data.number} · ${data.user.name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={RISK_CASE_TONE[data.status]}>{RISK_CASE_STATUS_LABELS[data.status]}</Badge>
            <span>Aberto em {formatDateTime(data.createdAt)}</span>
            <span className="text-muted">· {data.summary}</span>
          </span>
        }
        actions={
          open &&
          can('fraud.manage') && (
            <div className="flex flex-wrap gap-2">
              {data.status === 'OPEN' && (
                <Button variant="secondary" icon={<Eye className="h-4 w-4" />} onClick={() => void startReview()}>
                  Assumir análise
                </Button>
              )}
              <Button variant="secondary" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setDecision('dismiss')}>
                Descartar
              </Button>
              <Button variant="danger" icon={<ShieldX className="h-4 w-4" />} onClick={() => setDecision('confirm')}>
                Confirmar fraude
              </Button>
            </div>
          )
        }
      />
      {data.resolution && (
        <div className="mb-6 rounded-lg border border-border bg-surface-2 p-4 text-sm">
          <p className="font-medium text-fg">Decisão em {formatDateTime(data.resolvedAt)}</p>
          <p className="mt-1 text-fg">{data.resolution}</p>
        </div>
      )}
      <div className="mb-6">
        <p className="mb-1 text-sm text-muted">Score quando o caso foi atualizado</p>
        <ScoreMeter score={data.score} level={data.level} />
      </div>
      <RiskSubjectView data={data} onChanged={() => void refetch()} />

      {decision && (
        <Dialog
          open
          onClose={() => setDecision(null)}
          title={decision === 'dismiss' ? 'Descartar o caso (falso positivo)' : 'Confirmar a fraude'}
          description={
            decision === 'dismiss'
              ? 'A conta fica isenta das ações automáticas (pagamento só online, cupom recusado) pelo período escolhido. Novos sinais continuam sendo registrados.'
              : 'A confirmação fica registrada na auditoria. Para bloquear o acesso, use "Bloquear conta" — é uma decisão separada.'
          }
        >
          <form onSubmit={decide} className="space-y-4">
            <Textarea label="Justificativa" required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
            {decision === 'dismiss' && (
              <Input label="Isenção das ações automáticas (dias)" type="number" min={0} max={180} value={trustDays} onChange={(event) => setTrustDays(Number(event.target.value))} hint="0 = sem isenção." />
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDecision(null)}>
                Cancelar
              </Button>
              <Button type="submit" variant={decision === 'confirm' ? 'danger' : 'primary'} loading={busy}>
                {decision === 'dismiss' ? 'Descartar caso' : 'Confirmar fraude'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
