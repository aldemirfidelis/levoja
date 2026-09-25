'use client';

import { FormEvent, ReactNode, useState } from 'react';
import { COUPON_TYPE_LABELS, COUPON_TYPES, COUPON_VISIBILITY_LABELS, CouponType, CouponVisibility, describeCoupon, formatBRL, WEEKDAY_SHORT_LABELS } from '@levoja/shared';
import { Button, Checkbox, cn, Field, Input, Select, Textarea } from './primitives';
import { errorMessage } from './feedback';
import { Badge, DataTable, formatDateTime } from './data';
import { Dialog } from './overlay';
import { MoneyInput } from './money-input';

export interface CouponRecord {
  id: string;
  code: string;
  description: string | null;
  type: CouponType;
  percentBps: number | null;
  amountCents: number | null;
  maxDiscountCents: number | null;
  minOrderCents: number;
  segmentId: string | null;
  firstOrderOnly: boolean;
  startsAt: string | null;
  endsAt: string | null;
  weekdays: number[];
  fromTime: string | null;
  toTime: string | null;
  maxRedemptions: number | null;
  maxPerCustomer: number;
  redemptions: number;
  isActive: boolean;
  fundedBy: 'PLATFORM' | 'COMPANY';
  companyId: string | null;
  companyName?: string | null;
  /** CODE = só com o código; PUBLIC = listado no app; TIER = exclusivo de nível de fidelidade. */
  visibility?: CouponVisibility;
  minTier?: string | null;
}

export type CouponBody = Record<string, unknown>;

const toLocalInput = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/** Formulário de cupom (plataforma ou loja). Campos específicos entram por `extraFields`. */
export function CouponForm({
  coupon,
  title,
  onSubmit,
  onClose,
  extraFields,
  segments,
  tiers,
}: {
  coupon: CouponRecord | null;
  title?: string;
  onSubmit: (body: CouponBody) => Promise<unknown>;
  onClose: () => void;
  extraFields?: ReactNode;
  segments?: { id: string; name: string }[];
  /** Níveis de fidelidade (painel): habilita cupons exclusivos de nível. */
  tiers?: { key: string; name: string }[];
}) {
  const [form, setForm] = useState({
    code: coupon?.code ?? '',
    description: coupon?.description ?? '',
    type: coupon?.type ?? ('PERCENT' as CouponType),
    percent: coupon?.percentBps ? String(coupon.percentBps / 100) : '10',
    amountCents: coupon?.amountCents ?? null,
    maxDiscountCents: coupon?.maxDiscountCents ?? null,
    minOrderCents: coupon?.minOrderCents ?? 0,
    segmentId: coupon?.segmentId ?? '',
    firstOrderOnly: coupon?.firstOrderOnly ?? false,
    startsAt: toLocalInput(coupon?.startsAt ?? null),
    endsAt: toLocalInput(coupon?.endsAt ?? null),
    weekdays: coupon?.weekdays ?? [],
    fromTime: coupon?.fromTime ?? '',
    toTime: coupon?.toTime ?? '',
    maxRedemptions: coupon?.maxRedemptions != null ? String(coupon.maxRedemptions) : '',
    maxPerCustomer: String(coupon?.maxPerCustomer ?? 1),
    isActive: coupon?.isActive ?? true,
    visibility: coupon?.visibility ?? ('CODE' as CouponVisibility),
    minTier: coupon?.minTier ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    const percentBps = Math.round(Number(form.percent.replace(',', '.')) * 100);
    if (form.type === 'PERCENT' && !(percentBps > 0 && percentBps <= 10_000)) return setError('Percentual entre 0,01% e 100%.');
    if (form.type === 'FIXED' && !form.amountCents) return setError('Informe o valor do desconto.');
    if (!!form.fromTime !== !!form.toTime) return setError('Informe início e fim da janela de horário.');
    if (form.visibility === 'TIER' && !form.minTier) return setError('Escolha o nível de fidelidade mínimo.');
    const body: CouponBody = {
      description: form.description.trim() || undefined,
      type: form.type,
      percentBps: form.type === 'PERCENT' ? percentBps : undefined,
      amountCents: form.type === 'FIXED' ? form.amountCents : undefined,
      maxDiscountCents: form.maxDiscountCents || undefined,
      minOrderCents: form.minOrderCents ?? 0,
      firstOrderOnly: form.firstOrderOnly,
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      weekdays: form.weekdays,
      fromTime: form.fromTime || null,
      toTime: form.toTime || null,
      maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
      maxPerCustomer: Number(form.maxPerCustomer) || 1,
      isActive: form.isActive,
      visibility: form.visibility,
      minTier: form.visibility === 'TIER' ? form.minTier : null,
      ...(segments ? { segmentId: form.segmentId || null } : {}),
      ...(coupon ? {} : { code: form.code.trim().toUpperCase() }),
    };
    setBusy(true);
    try {
      await onSubmit(body);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleDay = (day: number) => set('weekdays', form.weekdays.includes(day) ? form.weekdays.filter((d) => d !== day) : [...form.weekdays, day].sort());

  return (
    <Dialog open onClose={onClose} size="lg" title={title ?? (coupon ? `Editar cupom ${coupon.code}` : 'Novo cupom')} description="O desconto é validado no carrinho e no checkout; o uso é contabilizado por cliente.">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Código"
          required
          disabled={!!coupon}
          pattern="[A-Za-z0-9_\-]{3,40}"
          hint={coupon ? 'O código não pode ser alterado.' : 'Letras, números, "-" ou "_" (3 a 40).'}
          value={form.code}
          onChange={(e) => set('code', e.target.value.toUpperCase())}
        />
        <Select label="Tipo" value={form.type} options={COUPON_TYPES.map((type) => ({ value: type, label: COUPON_TYPE_LABELS[type] }))} onChange={(e) => set('type', e.target.value as CouponType)} />
        {form.type === 'PERCENT' && <Input label="Percentual (%)" inputMode="decimal" required value={form.percent} onChange={(e) => set('percent', e.target.value)} />}
        {form.type === 'FIXED' && <MoneyInput label="Valor do desconto" required value={form.amountCents} onChange={(cents) => set('amountCents', cents)} />}
        {form.type !== 'FREE_DELIVERY' && <MoneyInput label="Desconto máximo" hint="Opcional" value={form.maxDiscountCents} onChange={(cents) => set('maxDiscountCents', cents)} />}
        <MoneyInput label="Pedido mínimo" value={form.minOrderCents} onChange={(cents) => set('minOrderCents', cents ?? 0)} />
        {segments && (
          <Select label="Categoria" value={form.segmentId} placeholder="Todas" options={segments.map((segment) => ({ value: segment.id, label: segment.name }))} onChange={(e) => set('segmentId', e.target.value)} />
        )}
        <Select
          label="Divulgação"
          value={form.visibility}
          options={(Object.keys(COUPON_VISIBILITY_LABELS) as CouponVisibility[])
            .filter((key) => key !== 'TIER' || (tiers?.length ?? 0) > 0 || form.visibility === 'TIER')
            .map((key) => ({ value: key, label: COUPON_VISIBILITY_LABELS[key] }))}
          onChange={(e) => set('visibility', e.target.value as CouponVisibility)}
          hint={form.visibility === 'PUBLIC' ? 'Aparece na Home e em "Meus cupons" do app.' : undefined}
        />
        {form.visibility === 'TIER' && (
          <Select label="Nível mínimo" value={form.minTier} placeholder="Escolha" options={(tiers ?? []).map((tier) => ({ value: tier.key, label: tier.name }))} onChange={(e) => set('minTier', e.target.value)} />
        )}
        {extraFields}
        <Textarea className="sm:col-span-2" label="Descrição para o cliente" maxLength={200} value={form.description} onChange={(e) => set('description', e.target.value)} />
        <Input label="Início" type="datetime-local" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
        <Input label="Fim" type="datetime-local" value={form.endsAt} onChange={(e) => set('endsAt', e.target.value)} />
        <Field label="Dias da semana" hint="Nenhum marcado = todos os dias." className="sm:col-span-2">
          {(id) => (
          <div id={id} role="group" className="flex flex-wrap gap-1">
            {WEEKDAY_SHORT_LABELS.map((label, day) => (
              <button
                key={label}
                type="button"
                aria-pressed={form.weekdays.includes(day)}
                onClick={() => toggleDay(day)}
                className={cn('h-9 w-12 rounded-lg border text-sm', form.weekdays.includes(day) ? 'border-brand-500 bg-brand-500/10 text-brand-600' : 'border-border text-muted hover:bg-surface-2')}
              >
                {label}
              </button>
            ))}
          </div>
          )}
        </Field>
        <Input label="Das (horário)" type="time" value={form.fromTime} onChange={(e) => set('fromTime', e.target.value)} hint="Promoção por horário (opcional)" />
        <Input label="Até" type="time" value={form.toTime} onChange={(e) => set('toTime', e.target.value)} />
        <Input label="Limite total de usos" type="number" min={1} placeholder="Ilimitado" value={form.maxRedemptions} onChange={(e) => set('maxRedemptions', e.target.value)} />
        <Input label="Usos por cliente" type="number" min={1} max={1000} value={form.maxPerCustomer} onChange={(e) => set('maxPerCustomer', e.target.value)} />
        <Checkbox label="Somente na primeira compra do cliente" checked={form.firstOrderOnly} onChange={(e) => set('firstOrderOnly', e.target.checked)} />
        <Checkbox label="Cupom ativo" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
        {error && (
          <p className="text-sm text-danger sm:col-span-2" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Lista de cupons com regra, validade e uso. */
export function CouponsTable({ rows, onEdit, showOwner }: { rows: CouponRecord[]; onEdit?: (coupon: CouponRecord) => void; showOwner?: boolean }) {
  const now = Date.now();
  const state = (coupon: CouponRecord) => {
    if (!coupon.isActive) return <Badge>Inativo</Badge>;
    if (coupon.endsAt && new Date(coupon.endsAt).getTime() <= now) return <Badge>Expirado</Badge>;
    if (coupon.maxRedemptions != null && coupon.redemptions >= coupon.maxRedemptions) return <Badge tone="warning">Esgotado</Badge>;
    if (coupon.startsAt && new Date(coupon.startsAt).getTime() > now) return <Badge tone="info">Agendado</Badge>;
    return <Badge tone="success">Ativo</Badge>;
  };
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.id}
      onRowClick={onEdit}
      columns={[
        {
          key: 'code',
          header: 'Cupom',
          cell: (row) => (
            <span>
              <span className="font-mono font-semibold">{row.code}</span>
              <span className="block text-xs text-muted">
                {describeCoupon(row, formatBRL)}
                {row.minOrderCents ? ` · mín. ${formatBRL(row.minOrderCents)}` : ''}
                {row.visibility === 'PUBLIC' ? ' · listado no app' : row.visibility === 'TIER' ? ` · exclusivo nível ${row.minTier ?? ''}` : ''}
              </span>
            </span>
          ),
        },
        ...(showOwner
          ? [
              {
                key: 'owner',
                header: 'Escopo',
                hideOnMobile: true,
                cell: (row: CouponRecord) => (
                  <span className="text-sm">
                    {row.companyName ?? 'Todas as lojas'}
                    <span className="block text-xs text-muted">Custo: {row.fundedBy === 'COMPANY' ? 'loja' : 'plataforma'}</span>
                  </span>
                ),
              },
            ]
          : []),
        { key: 'validity', header: 'Validade', hideOnMobile: true, cell: (row) => (row.endsAt ? `até ${formatDateTime(row.endsAt)}` : 'Sem prazo') },
        { key: 'usage', header: 'Usos', className: 'text-right', cell: (row) => `${row.redemptions}${row.maxRedemptions != null ? ` / ${row.maxRedemptions}` : ''}` },
        { key: 'state', header: '', cell: state },
      ]}
    />
  );
}
