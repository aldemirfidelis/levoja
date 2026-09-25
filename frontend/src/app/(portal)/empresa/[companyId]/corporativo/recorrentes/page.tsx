'use client';

import { FormEvent, useState } from 'react';
import { Plus, Repeat } from 'lucide-react';
import { ITEM_CATEGORIES, ITEM_CATEGORY_LABELS, formatBRL } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { Badge, Button, Card, Dialog, EmptyState, formatDate, formatDateTime, Input, Select, SkeletonRows, Textarea, useToast } from '@levoja/web-kit/ui';
import { WEEKDAYS, type B2bOverview, type CompanyLocation, type CostCenter } from '@/components/b2b';
import { useCompany } from '@/lib/company';
import { PlanAwareError } from '@/components/plan-gate';

interface Recurrence {
  id: string;
  name: string;
  pickupLocationId: string | null;
  dropoffLocationId: string | null;
  dropoff: { name: string | null; street: string; number: string; city: string } | null;
  weekdays: number[];
  time: string;
  startsOn: string;
  endsOn: string | null;
  itemCategory: string;
  itemDescription: string | null;
  paymentMethod: 'INVOICE' | 'WALLET';
  costCenterId: string | null;
  isActive: boolean;
  runs: { id: string; occursOn: string; scheduledFor: string; deliveryId: string | null; error: string | null }[];
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

function RecurrenceDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { company } = useCompany();
  const toast = useToast();
  const { data: b2b } = useApi<B2bOverview>(`companies/${company.id}/b2b`);
  const { data: locations } = useApi<CompanyLocation[]>(`companies/${company.id}/b2b/locations`);
  const { data: centers } = useApi<CostCenter[]>(`companies/${company.id}/b2b/cost-centers`);
  const [form, setForm] = useState({
    name: '',
    pickupLocationId: '',
    dropoffLocationId: '',
    weekdays: [1, 2, 3, 4, 5],
    time: '09:00',
    startsOn: today(),
    endsOn: '',
    itemCategory: 'DOCUMENT',
    itemDescription: '',
    notes: '',
    paymentMethod: '',
    costCenterId: '',
  });
  const [busy, setBusy] = useState(false);
  const payment = form.paymentMethod || (b2b?.canInvoice ? 'INVOICE' : 'WALLET');
  const toggleDay = (day: number) => setForm({ ...form, weekdays: form.weekdays.includes(day) ? form.weekdays.filter((item) => item !== day) : [...form.weekdays, day].sort() });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post(`companies/${company.id}/b2b/recurring-deliveries`, {
        name: form.name,
        pickupLocationId: form.pickupLocationId || null,
        dropoffLocationId: form.dropoffLocationId,
        weekdays: form.weekdays,
        time: form.time,
        startsOn: form.startsOn,
        endsOn: form.endsOn || null,
        itemCategory: form.itemCategory,
        itemDescription: form.itemDescription || null,
        notes: form.notes || null,
        paymentMethod: payment,
        costCenterId: form.costCenterId || null,
      });
      toast.success('Recorrência criada. As entregas são agendadas automaticamente algumas horas antes.');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const locationOptions = (locations ?? []).map((location) => ({ value: location.id, label: `${location.name} — ${location.street}, ${location.number}` }));
  return (
    <Dialog open onClose={onClose} size="lg" title="Nova entrega recorrente" description="Ex.: malote diário entre unidades, reposição semanal para um cliente.">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Input className="sm:col-span-2" label="Nome" required minLength={2} maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Malote Matriz → Filial Sul" />
        <Select label="Coleta" value={form.pickupLocationId} onChange={(event) => setForm({ ...form, pickupLocationId: event.target.value })} options={[{ value: '', label: 'Endereço da empresa' }, ...locationOptions]} />
        <Select
          label="Destino"
          required
          value={form.dropoffLocationId}
          placeholder={locationOptions.length ? 'Escolha a unidade/local' : 'Cadastre as unidades primeiro'}
          onChange={(event) => setForm({ ...form, dropoffLocationId: event.target.value })}
          options={locationOptions}
        />
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-fg">Dias da semana</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((label, day) => (
              <button
                key={label}
                type="button"
                aria-pressed={form.weekdays.includes(day)}
                onClick={() => toggleDay(day)}
                className={`rounded-full border px-3 py-1 text-sm ${form.weekdays.includes(day) ? 'border-brand-500 bg-brand-500/10 text-brand-600' : 'border-border text-muted'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <Input label="Horário da entrega" type="time" required value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} />
        <Select label="Tipo de item" value={form.itemCategory} onChange={(event) => setForm({ ...form, itemCategory: event.target.value })} options={ITEM_CATEGORIES.map((category) => ({ value: category, label: ITEM_CATEGORY_LABELS[category] }))} />
        <Input label="Início" type="date" required value={form.startsOn} onChange={(event) => setForm({ ...form, startsOn: event.target.value })} />
        <Input label="Término (opcional)" type="date" value={form.endsOn} min={form.startsOn} onChange={(event) => setForm({ ...form, endsOn: event.target.value })} />
        <Select
          label="Pagamento"
          value={payment}
          onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })}
          options={[...(b2b?.canInvoice ? [{ value: 'INVOICE', label: `Faturado (crédito ${formatBRL(b2b.availableCreditCents)})` }] : []), { value: 'WALLET', label: 'Saldo da carteira' }]}
        />
        <Select
          label="Centro de custo"
          value={form.costCenterId}
          onChange={(event) => setForm({ ...form, costCenterId: event.target.value })}
          options={[{ value: '', label: 'Nenhum' }, ...(centers ?? []).filter((center) => center.isActive).map((center) => ({ value: center.id, label: `${center.code} — ${center.name}` }))]}
        />
        <Input className="sm:col-span-2" label="Descrição do item" value={form.itemDescription} onChange={(event) => setForm({ ...form, itemDescription: event.target.value })} maxLength={300} />
        <Textarea className="sm:col-span-2" label="Observações para o entregador" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength={500} />
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} disabled={!form.weekdays.length || !form.dropoffLocationId}>
            Criar recorrência
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function RecurringPage() {
  const { company, can } = useCompany();
  const toast = useToast();
  const manage = can('company.b2b.manage');
  const { data, error, isLoading, refetch } = useApi<Recurrence[]>(`companies/${company.id}/b2b/recurring-deliveries`);
  const { data: locations } = useApi<CompanyLocation[]>(`companies/${company.id}/b2b/locations`, { all: 'true' });
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const nameOf = (id: string | null) => (id ? (locations?.find((location) => location.id === id)?.name ?? 'Unidade') : company.tradeName);

  const run = async (key: string, action: () => Promise<unknown>, message: string) => {
    setBusy(key);
    try {
      await action();
      toast.success(message);
      await refetch();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="Entregas recorrentes" actions={manage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nova recorrência</Button>}>
      <p className="mb-4 text-sm text-muted">Nos dias e horários escolhidos, a entrega é agendada automaticamente (com antecedência) e segue o contrato, o limite e o centro de custo.</p>
      {isLoading && <SkeletonRows rows={3} />}
      {error && <PlanAwareError error={error} onRetry={() => refetch()} />}
      {data?.length === 0 && <EmptyState icon={<Repeat className="h-8 w-8" />} title="Nenhuma entrega recorrente" />}
      <ul className="space-y-3">
        {data?.map((recurrence) => (
          <li key={recurrence.id} className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">
                  {recurrence.name} <Badge tone={recurrence.isActive ? 'success' : 'neutral'}>{recurrence.isActive ? 'Ativa' : 'Pausada'}</Badge>
                </p>
                <p className="text-sm text-muted">
                  {nameOf(recurrence.pickupLocationId)} → {recurrence.dropoffLocationId ? nameOf(recurrence.dropoffLocationId) : recurrence.dropoff ? `${recurrence.dropoff.street}, ${recurrence.dropoff.number}` : '—'}
                </p>
                <p className="text-sm text-muted">
                  {recurrence.weekdays.map((day) => WEEKDAYS[day]).join(', ')} às {recurrence.time} · desde {formatDate(recurrence.startsOn)}
                  {recurrence.endsOn ? ` até ${formatDate(recurrence.endsOn)}` : ''} · {recurrence.paymentMethod === 'INVOICE' ? 'faturado' : 'carteira'}
                </p>
              </div>
              {manage && (
                <div className="flex gap-2">
                  {recurrence.isActive && (
                    <Button size="sm" variant="secondary" loading={busy === `run-${recurrence.id}`} onClick={() => void run(`run-${recurrence.id}`, () => api.post(`companies/${company.id}/b2b/recurring-deliveries/${recurrence.id}/run`), 'Ocorrências da janela geradas.')}>
                      Gerar agora
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === `toggle-${recurrence.id}`}
                    onClick={() => void run(`toggle-${recurrence.id}`, () => api.patch(`companies/${company.id}/b2b/recurring-deliveries/${recurrence.id}`, { isActive: !recurrence.isActive }), recurrence.isActive ? 'Recorrência pausada.' : 'Recorrência reativada.')}
                  >
                    {recurrence.isActive ? 'Pausar' : 'Reativar'}
                  </Button>
                </div>
              )}
            </div>
            {recurrence.runs.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
                {recurrence.runs.map((item) => (
                  <li key={item.id} className="flex flex-wrap justify-between gap-2">
                    <span>{formatDateTime(item.scheduledFor)}</span>
                    {item.error ? <span className="text-danger">{item.error}</span> : <span className="text-muted">Entrega agendada</span>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {creating && (
        <RecurrenceDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void refetch();
          }}
        />
      )}
    </Card>
  );
}
