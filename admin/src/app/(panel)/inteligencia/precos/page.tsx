'use client';

import { FormEvent, useState } from 'react';
import { CalendarClock, Check, Lightbulb, Plus, X } from 'lucide-react';
import { SUGGESTION_STATUS_LABELS, type SuggestionStatus } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, formatDateTime, Input, PageHeader, SkeletonRows, useToast } from '@levoja/web-kit/ui';
import { bpsLabel, cityLabel, IntelligenceNav } from '@/components/intelligence-nav';
import { useSession } from '@/lib/session';

interface Suggestion {
  id: string;
  city: string;
  windowStart: string;
  windowEnd: string;
  surchargeBps: number;
  predicted: number;
  driversNeeded: number;
  driversExpected: number;
  reason: string;
  status: SuggestionStatus;
}

interface Surcharge {
  id: string;
  city: string | null;
  startsAt: string;
  endsAt: string;
  surchargeBps: number;
  reason: string;
  canceledAt: string | null;
}

const toLocalInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function surchargeState(surcharge: Surcharge) {
  const now = Date.now();
  if (surcharge.canceledAt) return { label: 'Cancelado', tone: 'neutral' as const };
  if (new Date(surcharge.endsAt).getTime() <= now) return { label: 'Encerrado', tone: 'neutral' as const };
  if (new Date(surcharge.startsAt).getTime() <= now) return { label: 'Em vigor', tone: 'success' as const };
  return { label: 'Programado', tone: 'info' as const };
}

export default function DynamicPricingPage() {
  const { can } = useSession();
  const toast = useToast();
  const manage = can('pricing.manage');
  const suggestions = useApi<Suggestion[]>('admin/intelligence/pricing/suggestions');
  const surcharges = useApi<Surcharge[]>('admin/intelligence/pricing/surcharges');
  const [approving, setApproving] = useState<Suggestion | null>(null);
  const [percentText, setPercentText] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ city: '', state: '', startsAt: toLocalInput(new Date()), endsAt: toLocalInput(new Date(Date.now() + 2 * 3_600_000)), percent: '10', reason: '' });
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    await Promise.all([suggestions.refetch(), surcharges.refetch()]);
  };

  const approve = async (event: FormEvent) => {
    event.preventDefault();
    if (!approving) return;
    setBusy(true);
    try {
      await api.post(`admin/intelligence/pricing/suggestions/${approving.id}/apply`, { surchargeBps: Math.round(Number(percentText.replace(',', '.')) * 100) });
      toast.success('Adicional programado.');
      setApproving(null);
      await refresh();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async (suggestion: Suggestion) => {
    try {
      await api.post(`admin/intelligence/pricing/suggestions/${suggestion.id}/dismiss`);
      toast.success('Sugestão descartada.');
      await refresh();
    } catch (err) {
      toast.error(err);
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('admin/intelligence/pricing/surcharges', {
        city: form.city || undefined,
        state: form.state || undefined,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        surchargeBps: Math.round(Number(form.percent.replace(',', '.')) * 100),
        reason: form.reason,
      });
      toast.success('Adicional programado.');
      setCreating(false);
      await refresh();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (surcharge: Surcharge) => {
    try {
      await api.post(`admin/intelligence/pricing/surcharges/${surcharge.id}/cancel`);
      toast.success('Adicional cancelado.');
      await refresh();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <PageHeader
        title="Inteligência"
        description="Adicionais de preço com data e hora. A previsão sugere quando falta entregador; o adicional só vale depois que alguém aprova. Ele incide sobre o frete da tabela padrão e sobre o repasse ao entregador (contratos corporativos não mudam)."
        actions={
          manage && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Programar adicional
            </Button>
          )
        }
      />
      <IntelligenceNav />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Sugestões aguardando decisão">
          {suggestions.isLoading && <SkeletonRows rows={3} />}
          {suggestions.error && <ErrorState error={suggestions.error} onRetry={() => suggestions.refetch()} />}
          {suggestions.data?.length === 0 && <EmptyState icon={<Lightbulb className="h-8 w-8" />} title="Nenhuma sugestão" description="Nenhuma falta de entregadores prevista acima do limite configurado." />}
          <ul className="space-y-3">
            {suggestions.data?.map((suggestion) => (
              <li key={suggestion.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-fg">
                    {cityLabel(suggestion.city)} · {formatDateTime(suggestion.windowStart)} a {new Date(suggestion.windowEnd).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <Badge tone="warning">+{bpsLabel(suggestion.surchargeBps)}</Badge>
                </div>
                <p className="mt-1 text-fg">{suggestion.reason}</p>
                <p className="mt-1 text-xs text-muted">
                  {suggestion.driversNeeded} entregador(es) necessário(s) × {suggestion.driversExpected.toLocaleString('pt-BR')} habitual(is) · {SUGGESTION_STATUS_LABELS[suggestion.status]}
                </p>
                {manage && (
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      icon={<Check className="h-4 w-4" />}
                      onClick={() => {
                        setApproving(suggestion);
                        setPercentText(String(suggestion.surchargeBps / 100).replace('.', ','));
                      }}
                    >
                      Aprovar
                    </Button>
                    <Button size="sm" variant="ghost" icon={<X className="h-4 w-4" />} onClick={() => void dismiss(suggestion)}>
                      Descartar
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Adicionais programados (últimos 7 dias e futuros)">
          {surcharges.isLoading && <SkeletonRows rows={3} />}
          {surcharges.error && <ErrorState error={surcharges.error} onRetry={() => surcharges.refetch()} />}
          {surcharges.data?.length === 0 && <EmptyState icon={<CalendarClock className="h-8 w-8" />} title="Nenhum adicional" />}
          <ul className="divide-y divide-border text-sm">
            {surcharges.data?.map((surcharge) => {
              const state = surchargeState(surcharge);
              const active = state.label === 'Em vigor' || state.label === 'Programado';
              return (
                <li key={surcharge.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-fg">
                      +{bpsLabel(surcharge.surchargeBps)} · {cityLabel(surcharge.city)}
                    </p>
                    <p className="text-xs text-muted">
                      {formatDateTime(surcharge.startsAt)} a {formatDateTime(surcharge.endsAt)} · {surcharge.reason}
                    </p>
                  </div>
                  <span className="flex items-center gap-2">
                    <Badge tone={state.tone}>{state.label}</Badge>
                    {manage && active && (
                      <Button size="sm" variant="ghost" onClick={() => void cancel(surcharge)}>
                        Cancelar
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      {approving && (
        <Dialog open onClose={() => setApproving(null)} title="Aprovar adicional sugerido" description={`${cityLabel(approving.city)} · ${formatDateTime(approving.windowStart)} a ${formatDateTime(approving.windowEnd)}`}>
          <form onSubmit={approve} className="space-y-4">
            <Input label="Adicional (%)" inputMode="decimal" required value={percentText} onChange={(event) => setPercentText(event.target.value)} hint={`Sugerido: ${bpsLabel(approving.surchargeBps)}. Pode ser ajustado.`} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setApproving(null)}>
                Cancelar
              </Button>
              <Button type="submit" loading={busy}>
                Programar adicional
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      {creating && (
        <Dialog open onClose={() => setCreating(false)} title="Programar adicional" description="Ex.: evento, feriado, chuva prevista. Vale para cotações feitas dentro do período.">
          <form onSubmit={create} className="grid gap-4 sm:grid-cols-2">
            <Input label="Cidade (vazio = todas)" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
            <Input label="UF" maxLength={2} value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value.toUpperCase() })} />
            <Input label="Início" type="datetime-local" required value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} />
            <Input label="Fim" type="datetime-local" required value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} />
            <Input label="Adicional (%)" inputMode="decimal" required value={form.percent} onChange={(event) => setForm({ ...form, percent: event.target.value })} />
            <Input label="Motivo" required minLength={5} maxLength={300} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
              <Button type="submit" loading={busy}>
                Programar
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
