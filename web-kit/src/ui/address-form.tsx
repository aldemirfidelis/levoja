'use client';

import { FormEvent, useState } from 'react';
import { Button, Input } from './primitives';
import { errorMessage } from './feedback';

export interface AddressValue {
  label?: string | null;
  zipCode: string;
  street: string;
  number: string;
  complement?: string | null;
  district: string;
  city: string;
  state: string;
  reference?: string | null;
  lat?: number | null;
  lng?: number | null;
}

const EMPTY: AddressValue = { zipCode: '', street: '', number: '', complement: '', district: '', city: '', state: '', reference: '' };

const maskCep = (value: string) => value.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');

/** Consulta o CEP no ViaCEP (serviço público) para preencher logradouro, bairro, cidade e UF. */
async function lookupCep(cep: string): Promise<Partial<AddressValue> | null> {
  const digits = cep.replace(/\D/g, '');
  if (digits.length !== 8) return null;
  try {
    const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    const data = (await response.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
    if (data.erro) return null;
    return { street: data.logradouro ?? '', district: data.bairro ?? '', city: data.localidade ?? '', state: data.uf ?? '' };
  } catch {
    return null;
  }
}

export function AddressForm({
  initial,
  onSubmit,
  submitLabel = 'Salvar endereço',
  withLabel = false,
  onCancel,
}: {
  initial?: Partial<AddressValue> | null;
  onSubmit: (address: AddressValue) => Promise<void>;
  submitLabel?: string;
  withLabel?: boolean;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<AddressValue>({ ...EMPTY, ...initial, zipCode: maskCep(initial?.zipCode ?? '') } as AddressValue);
  const [cepHint, setCepHint] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (key: keyof AddressValue) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });

  const onCep = async (value: string) => {
    const masked = maskCep(value);
    setForm((current) => ({ ...current, zipCode: masked }));
    if (masked.length === 9) {
      setCepHint('Buscando CEP...');
      const found = await lookupCep(masked);
      setCepHint(found ? undefined : 'CEP não encontrado — preencha o endereço manualmente.');
      if (found) setForm((current) => ({ ...current, ...Object.fromEntries(Object.entries(found).filter(([, v]) => v)) }));
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return setError('Seu navegador não permite obter a localização.');
    navigator.geolocation.getCurrentPosition(
      (position) => setForm((current) => ({ ...current, lat: position.coords.latitude, lng: position.coords.longitude })),
      () => setError('Não foi possível obter sua localização.'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const { label, complement, reference, lat, lng, ...rest } = form;
      await onSubmit({
        ...rest,
        ...(withLabel && label ? { label } : {}),
        ...(complement ? { complement } : {}),
        ...(reference ? { reference } : {}),
        ...(lat != null && lng != null ? { lat, lng } : {}),
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-6">
      {withLabel && <Input className="sm:col-span-6" label="Identificação" placeholder="Casa, Trabalho..." value={form.label ?? ''} onChange={set('label')} />}
      <Input className="sm:col-span-2" label="CEP" inputMode="numeric" required value={form.zipCode} hint={cepHint} onChange={(e) => onCep(e.target.value)} />
      <Input className="sm:col-span-4" label="Logradouro" required value={form.street} onChange={set('street')} />
      <Input className="sm:col-span-2" label="Número" required value={form.number} onChange={set('number')} />
      <Input className="sm:col-span-4" label="Complemento" value={form.complement ?? ''} onChange={set('complement')} />
      <Input className="sm:col-span-2" label="Bairro" required value={form.district} onChange={set('district')} />
      <Input className="sm:col-span-3" label="Cidade" required value={form.city} onChange={set('city')} />
      <Input className="sm:col-span-1" label="UF" required maxLength={2} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })} />
      <Input className="sm:col-span-6" label="Ponto de referência" value={form.reference ?? ''} onChange={set('reference')} />
      <div className="flex flex-wrap items-center gap-3 text-sm sm:col-span-6">
        <Button type="button" variant="secondary" size="sm" onClick={useMyLocation}>
          Usar minha localização
        </Button>
        <span className="text-muted">
          {form.lat != null && form.lng != null ? `Localização: ${form.lat.toFixed(5)}, ${form.lng.toFixed(5)}` : 'A localização exata melhora o cálculo de rotas e fretes.'}
        </span>
      </div>
      {error && (
        <p className="text-sm text-danger sm:col-span-6" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-6">
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
