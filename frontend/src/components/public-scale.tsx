'use client';

import { FormEvent, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { api } from '@levoja/web-kit/client';
import { Button, Input, Select, useToast } from '@levoja/web-kit/ui';

/** "Avise-me quando chegar": entrada na lista de espera de uma cidade. */
export function WaitlistForm({ defaultProfile = 'CUSTOMER' }: { defaultProfile?: 'CUSTOMER' | 'COMPANY' | 'DRIVER' }) {
  const toast = useToast();
  const [form, setForm] = useState({ city: '', state: '', name: '', email: '', profile: defaultProfile });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ operating: boolean; city: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.post<{ joined: boolean; operating: boolean; city: { name: string; state: string } }>('cities/waitlist', form);
      setDone({ operating: result.operating, city: `${result.city.name}/${result.city.state}` });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/5 p-4 text-sm text-fg" role="status">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
        {done.operating ? `Boa notícia: já atendemos ${done.city}! Cadastre-se e comece agora.` : `Pronto! Avisaremos por e-mail assim que chegarmos em ${done.city}.`}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-6">
      <Input className="sm:col-span-4" label="Cidade" required minLength={2} value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
      <Input className="sm:col-span-2" label="UF" required maxLength={2} minLength={2} value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value.toUpperCase() })} />
      <Input className="sm:col-span-3" label="Nome" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      <Input className="sm:col-span-3" label="E-mail" type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
      <Select
        className="sm:col-span-3"
        label="Quero"
        value={form.profile}
        onChange={(event) => setForm({ ...form, profile: event.target.value as typeof form.profile })}
        options={[
          { value: 'CUSTOMER', label: 'Pedir e enviar entregas' },
          { value: 'COMPANY', label: 'Vender com a minha empresa' },
          { value: 'DRIVER', label: 'Fazer entregas' },
        ]}
      />
      <div className="flex items-end sm:col-span-3">
        <Button type="submit" className="w-full" loading={busy}>
          Avise-me quando chegar
        </Button>
      </div>
      <p className="text-xs text-muted sm:col-span-6">Usamos o e-mail apenas para avisar sobre o lançamento na sua cidade.</p>
    </form>
  );
}
