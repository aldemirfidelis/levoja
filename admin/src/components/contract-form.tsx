'use client';

import { FormEvent, useState } from 'react';
import { Button, Checkbox, Input, MoneyInput, Textarea } from '@levoja/web-kit/ui';
import { CompanyPicker } from '@/components/company-picker';

export interface ContractValues {
  title: string;
  startsOn: string;
  endsOn: string | null;
  billingDay: number;
  paymentTermDays: number;
  creditLimitCents: number;
  minimumMonthlyCents: number;
  discountBps: number;
  requireCostCenter: boolean;
  notifyRecipients: boolean;
  blockAfterOverdueDays: number;
  notes: string | null;
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/**
 * Condições comerciais do contrato. `withCompany` exibe a busca de empresa (criação);
 * `locked` impede alterar início e dia de fechamento depois da ativação.
 */
export function ContractForm({
  initial,
  withCompany,
  locked,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial?: Partial<ContractValues>;
  withCompany?: boolean;
  locked?: boolean;
  onSubmit: (values: ContractValues & { companyId?: string }) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState<ContractValues>({
    title: initial?.title ?? '',
    startsOn: initial?.startsOn ?? today(),
    endsOn: initial?.endsOn ?? null,
    billingDay: initial?.billingDay ?? 1,
    paymentTermDays: initial?.paymentTermDays ?? 10,
    creditLimitCents: initial?.creditLimitCents ?? 0,
    minimumMonthlyCents: initial?.minimumMonthlyCents ?? 0,
    discountBps: initial?.discountBps ?? 0,
    requireCostCenter: initial?.requireCostCenter ?? false,
    notifyRecipients: initial?.notifyRecipients ?? true,
    blockAfterOverdueDays: initial?.blockAfterOverdueDays ?? 5,
    notes: initial?.notes ?? null,
  });
  const [busy, setBusy] = useState(false);
  const [discountText, setDiscountText] = useState(initial?.discountBps ? String(initial.discountBps / 100).replace('.', ',') : '');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const discount = Number(discountText.replace(',', '.') || 0);
      await onSubmit({ ...form, discountBps: Math.round(discount * 100), ...(withCompany ? { companyId: company?.id } : {}) });
    } finally {
      setBusy(false);
    }
  };

  const number = (key: keyof ContractValues) => (event: { target: { value: string } }) => setForm({ ...form, [key]: Number(event.target.value) });
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {withCompany && (
        <div className="sm:col-span-2">
          <CompanyPicker label="Empresa" value={company} onChange={setCompany} hint="Empresa aprovada que receberá o contrato." />
        </div>
      )}
      <Input className="sm:col-span-2" label="Título" required minLength={3} maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
      <Input label="Início" type="date" required disabled={locked} value={form.startsOn} onChange={(event) => setForm({ ...form, startsOn: event.target.value })} />
      <Input label="Término (opcional)" type="date" value={form.endsOn ?? ''} min={form.startsOn} onChange={(event) => setForm({ ...form, endsOn: event.target.value || null })} />
      <Input label="Dia de fechamento" type="number" min={1} max={28} required disabled={locked} value={form.billingDay} onChange={number('billingDay')} hint="A fatura cobre do fechamento anterior até a véspera." />
      <Input label="Prazo de pagamento (dias)" type="number" min={1} max={90} required value={form.paymentTermDays} onChange={number('paymentTermDays')} />
      <MoneyInput label="Limite de crédito" required value={form.creditLimitCents} onChange={(cents) => setForm({ ...form, creditLimitCents: cents ?? 0 })} hint="Máximo de entregas faturadas em aberto." />
      <MoneyInput label="Franquia mínima mensal" value={form.minimumMonthlyCents || null} onChange={(cents) => setForm({ ...form, minimumMonthlyCents: cents ?? 0 })} hint="Complemento cobrado se o mês ficar abaixo." />
      <Input label="Desconto sobre a tabela padrão (%)" inputMode="decimal" value={discountText} onChange={(event) => setDiscountText(event.target.value)} hint="Usado quando nenhuma regra da tabela especial se aplica." />
      <Input label="Bloquear faturado após atraso de (dias)" type="number" min={0} max={90} value={form.blockAfterOverdueDays} onChange={number('blockAfterOverdueDays')} />
      <div className="space-y-2 sm:col-span-2">
        <Checkbox label="Centro de custo obrigatório em todas as entregas" checked={form.requireCostCenter} onChange={(event) => setForm({ ...form, requireCostCenter: event.target.checked })} />
        <Checkbox label="Avisar destinatários por SMS (link de acompanhamento e código)" checked={form.notifyRecipients} onChange={(event) => setForm({ ...form, notifyRecipients: event.target.checked })} />
      </div>
      <Textarea className="sm:col-span-2" label="Observações internas" value={form.notes ?? ''} onChange={(event) => setForm({ ...form, notes: event.target.value || null })} maxLength={2000} />
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={busy} disabled={withCompany && !company}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
