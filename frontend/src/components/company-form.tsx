'use client';

import { FormEvent, useState } from 'react';
import { isValidCnpj, isValidCpf } from '@levoja/shared';
import { useApi } from '@levoja/web-kit/client';
import { Button, errorMessage, Input, Select, Textarea } from '@levoja/web-kit/ui';
import { maskCpf, maskPhone } from './signup-fields';

export interface CompanyFormValue {
  legalName: string;
  tradeName: string;
  cnpj: string;
  segmentId: string;
  email: string;
  phone: string;
  responsibleName: string;
  responsibleCpf: string;
  description: string;
}

interface Segment {
  id: string;
  name: string;
  kind: string;
}

/**
 * Formulário de dados da empresa. Com `legalLocked`, os campos jurídicos ficam somente leitura
 * (bloqueados pela API após o envio para análise).
 */
export function CompanyForm({
  initial,
  legalLocked,
  submitLabel,
  onSubmit,
}: {
  initial?: Partial<CompanyFormValue>;
  legalLocked?: boolean;
  submitLabel: string;
  onSubmit: (value: Partial<CompanyFormValue>) => Promise<void>;
}) {
  const { data: segments } = useApi<Segment[]>('segments');
  const [form, setForm] = useState<CompanyFormValue>({
    legalName: '',
    tradeName: '',
    cnpj: '',
    segmentId: '',
    email: '',
    phone: '',
    responsibleName: '',
    responsibleCpf: '',
    description: '',
    ...initial,
  });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (key: keyof CompanyFormValue) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!legalLocked) {
      if (!isValidCnpj(form.cnpj)) return setError('CNPJ inválido.');
      if (form.responsibleCpf && !form.responsibleCpf.includes('*') && !isValidCpf(form.responsibleCpf)) return setError('CPF do responsável inválido.');
    }
    setBusy(true);
    setError(undefined);
    try {
      const { legalName, cnpj, responsibleName, responsibleCpf, segmentId, ...rest } = form;
      const payload: Partial<CompanyFormValue> = { ...rest };
      if (!legalLocked) {
        Object.assign(payload, { legalName, cnpj, responsibleName, segmentId });
        if (responsibleCpf && !responsibleCpf.includes('*')) payload.responsibleCpf = responsibleCpf;
      }
      await onSubmit(payload);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <Input label="Razão social" required disabled={legalLocked} value={form.legalName} onChange={set('legalName')} />
      <Input label="Nome fantasia" required value={form.tradeName} onChange={set('tradeName')} />
      <Input label="CNPJ" required disabled={legalLocked} value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value.toUpperCase() })} />
      <Select
        label="Segmento"
        required
        disabled={legalLocked}
        value={form.segmentId}
        placeholder="Selecione"
        options={(segments ?? []).filter((s) => s.kind === 'MARKETPLACE').map((s) => ({ value: s.id, label: s.name }))}
        onChange={set('segmentId')}
      />
      <Input label="E-mail" type="email" required value={form.email} onChange={set('email')} />
      <Input label="Telefone" required value={form.phone} onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })} />
      <Input label="Responsável legal" required disabled={legalLocked} value={form.responsibleName} onChange={set('responsibleName')} />
      <Input
        label="CPF do responsável"
        required={!initial}
        disabled={legalLocked}
        value={form.responsibleCpf}
        onChange={(e) => setForm({ ...form, responsibleCpf: maskCpf(e.target.value) })}
      />
      <Textarea className="sm:col-span-2" label="Descrição (exibida aos clientes)" maxLength={1000} value={form.description} onChange={set('description')} />
      {legalLocked && <p className="text-xs text-muted sm:col-span-2">Dados jurídicos não podem ser alterados após o envio para análise. Para correções, fale com o suporte.</p>}
      {error && (
        <p className="text-sm text-danger sm:col-span-2" role="alert">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
