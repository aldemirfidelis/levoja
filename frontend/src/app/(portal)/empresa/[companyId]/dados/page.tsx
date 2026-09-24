'use client';

import { FormEvent, useRef, useState } from 'react';
import { api } from '@levoja/web-kit/client';
import { Button, Card, Input, Select, useToast } from '@levoja/web-kit/ui';
import { CompanyForm } from '@/components/company-form';
import { legalEditable, useCompany } from '@/lib/company';

function LogoUpload() {
  const { company, reload } = useCompany();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (kind: 'logo' | 'banner', file?: File) => {
    if (!file) return;
    const form = new FormData();
    form.set('file', file);
    setBusy(true);
    try {
      await api.upload(`companies/${company.id}/${kind}`, form, 'PUT');
      toast.success('Imagem atualizada.');
      reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <Card title="Logo">
      <div className="flex items-center gap-4">
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={company.logoUrl} alt="Logo atual" className="h-20 w-20 rounded-xl object-cover" />
        ) : (
          <span className="flex h-20 w-20 items-center justify-center rounded-xl bg-surface-2 text-2xl font-bold text-muted">{company.tradeName[0]}</span>
        )}
        <div>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => upload('logo', e.target.files?.[0])} />
          <Button variant="secondary" loading={busy} onClick={() => input.current?.click()}>
            Trocar logo
          </Button>
          <p className="mt-1 text-xs text-muted">PNG, JPEG ou WEBP, até 5 MB. Formato quadrado.</p>
        </div>
      </div>
    </Card>
  );
}

function OperationSettings() {
  const { company, reload } = useCompany();
  const toast = useToast();
  const [form, setForm] = useState({
    averagePrepMinutes: company.averagePrepMinutes,
    minimumOrder: (company.minimumOrderCents / 100).toFixed(2),
    fulfillmentMode: company.fulfillmentMode,
  });
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.patch(`companies/${company.id}`, {
        averagePrepMinutes: Number(form.averagePrepMinutes),
        minimumOrderCents: Math.round(Number(form.minimumOrder.replace(',', '.')) * 100),
        fulfillmentMode: form.fulfillmentMode,
      });
      toast.success('Configurações salvas.');
      reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Operação">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
        <Input label="Tempo médio de preparo (min)" type="number" min={1} max={240} value={form.averagePrepMinutes} onChange={(e) => setForm({ ...form, averagePrepMinutes: Number(e.target.value) })} />
        <Input label="Pedido mínimo (R$)" inputMode="decimal" value={form.minimumOrder} onChange={(e) => setForm({ ...form, minimumOrder: e.target.value })} />
        <Select
          label="Quem faz as entregas"
          value={form.fulfillmentMode}
          onChange={(e) => setForm({ ...form, fulfillmentMode: e.target.value as typeof form.fulfillmentMode })}
          options={[
            { value: 'PLATFORM', label: 'Entregadores da plataforma' },
            { value: 'OWN_FLEET', label: 'Frota própria' },
            { value: 'HYBRID', label: 'Plataforma + frota própria' },
          ]}
        />
        <div className="sm:col-span-3">
          <Button type="submit" loading={busy}>
            Salvar
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function CompanyDataPage() {
  const { company, reload } = useCompany();
  const toast = useToast();
  return (
    <div className="space-y-6">
      <Card title="Dados da empresa">
        <CompanyForm
          legalLocked={!legalEditable(company.status)}
          submitLabel="Salvar alterações"
          initial={{
            legalName: company.legalName,
            tradeName: company.tradeName,
            cnpj: company.cnpj,
            segmentId: company.segment.id,
            email: company.email,
            phone: company.phone,
            responsibleName: company.responsibleName,
            responsibleCpf: company.responsibleCpfMasked,
            description: company.description ?? '',
          }}
          onSubmit={async (value) => {
            await api.patch(`companies/${company.id}`, value);
            toast.success('Dados atualizados.');
            reload();
          }}
        />
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <LogoUpload />
        <OperationSettings />
      </div>
    </div>
  );
}
