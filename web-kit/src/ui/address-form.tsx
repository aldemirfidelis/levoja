'use client';

import { FormEvent, lazy, Suspense, useState } from 'react';
import { Button, Input } from './primitives';
import { errorMessage } from './feedback';
import type { LatLngValue } from './location-picker';

// O mapa (Leaflet) só é carregado quando o formulário aparece.
const LocationPicker = lazy(() => import('./location-picker'));

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

const STATE_NAMES: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
  GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
  PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima',
  SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

/** "Av Goiás" → "Avenida Goiás": o mapa encontra melhor o nome por extenso. */
function expandStreet(street: string): string {
  const prefixes: [RegExp, string][] = [
    [/^av\.?\s+/i, 'Avenida '],
    [/^r\.?\s+/i, 'Rua '],
    [/^al\.?\s+/i, 'Alameda '],
    [/^tv\.?\s+/i, 'Travessa '],
    [/^p(ç|c)a?\.?\s+/i, 'Praça '],
    [/^rod\.?\s+/i, 'Rodovia '],
    [/^est\.?\s+/i, 'Estrada '],
  ];
  const trimmed = street.trim();
  for (const [pattern, full] of prefixes) if (pattern.test(trimmed)) return trimmed.replace(pattern, full);
  return trimmed;
}

const GEOCODER_URL = process.env.NEXT_PUBLIC_GEOCODER_URL ?? 'https://nominatim.openstreetmap.org';

/**
 * Localiza o endereço no mapa (Nominatim/OpenStreetMap, serviço público, como o ViaCEP).
 * Tenta a rua com o número; se não achar, a cidade (`exact: false`, para a pessoa ajustar o marcador).
 */
async function geocodeAddress(address: AddressValue): Promise<(LatLngValue & { exact: boolean }) | null> {
  const search = async (params: Record<string, string>) => {
    const query = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'br', 'accept-language': 'pt-BR', ...params });
    const response = await fetch(`${GEOCODER_URL}/search?${query}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const [first] = (await response.json()) as { lat: string; lon: string }[];
    return first ? { lat: Number(first.lat), lng: Number(first.lon) } : null;
  };
  const state = STATE_NAMES[address.state.toUpperCase()] ?? address.state;
  try {
    if (address.street && address.city) {
      const street = [address.number, expandStreet(address.street)].filter(Boolean).join(' ');
      const found = await search({ street, city: address.city, state });
      if (found) return { ...found, exact: true };
    }
    if (address.city) {
      const found = await search({ city: address.city, state });
      if (found) return { ...found, exact: false };
    }
  } catch {
    // Sem rede ou serviço fora do ar: a pessoa marca no mapa.
  }
  return null;
}

/** Só os campos que a API aceita (o endereço carregado da API traz também id, datas etc.). */
function toPayload(form: AddressValue, withLabel: boolean): AddressValue {
  return {
    zipCode: form.zipCode,
    street: form.street.trim(),
    number: form.number.trim(),
    district: form.district.trim(),
    city: form.city.trim(),
    state: form.state.trim().toUpperCase(),
    ...(withLabel && form.label ? { label: form.label } : {}),
    ...(form.complement ? { complement: form.complement } : {}),
    ...(form.reference ? { reference: form.reference } : {}),
    ...(form.lat != null && form.lng != null ? { lat: form.lat, lng: form.lng } : {}),
  };
}

export function AddressForm({
  initial,
  onSubmit,
  submitLabel = 'Salvar endereço',
  withLabel = false,
  requireLocation = false,
  onCancel,
}: {
  initial?: Partial<AddressValue> | null;
  onSubmit: (address: AddressValue) => Promise<void>;
  submitLabel?: string;
  withLabel?: boolean;
  /** Exige a localização no mapa antes de salvar (ex.: endereço de loja, usado para achar clientes próximos). */
  requireLocation?: boolean;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<AddressValue>({ ...EMPTY, ...initial, zipCode: maskCep(initial?.zipCode ?? '') } as AddressValue);
  const [cepHint, setCepHint] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string>();
  const [zoom, setZoom] = useState(17);
  const set = (key: keyof AddressValue) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });
  const point = form.lat != null && form.lng != null ? { lat: form.lat, lng: form.lng } : null;

  const setPoint = (value: LatLngValue, note?: string, nextZoom = 17) => {
    setZoom(nextZoom);
    setForm((current) => ({ ...current, lat: value.lat, lng: value.lng }));
    setLocationNote(note);
  };

  const locate = async (address: AddressValue) => {
    setLocating(true);
    setLocationNote(undefined);
    const found = await geocodeAddress(address);
    setLocating(false);
    if (!found) {
      setLocationNote('Não encontramos esse endereço no mapa. Clique no mapa para marcar a localização.');
      return null;
    }
    setPoint(
      found,
      found.exact ? 'Endereço localizado. Confira o marcador e arraste se precisar.' : 'Encontramos só a cidade: arraste o marcador até o local exato.',
      found.exact ? 17 : 14,
    );
    return found;
  };

  const onCep = async (value: string) => {
    const masked = maskCep(value);
    setForm((current) => ({ ...current, zipCode: masked }));
    if (masked.length === 9) {
      setCepHint('Buscando CEP...');
      const found = await lookupCep(masked);
      setCepHint(found ? undefined : 'CEP não encontrado — preencha o endereço manualmente.');
      if (found) {
        const filled = Object.fromEntries(Object.entries(found).filter(([, v]) => v));
        setForm((current) => ({ ...current, ...filled }));
        // Sem localização ainda: já aproxima o mapa da rua do CEP.
        if (!point) void locate({ ...form, ...filled, zipCode: masked } as AddressValue);
      }
    }
  };

  const useDeviceLocation = () => {
    if (!navigator.geolocation) return setError('Seu navegador não permite obter a localização.');
    navigator.geolocation.getCurrentPosition(
      (position) =>
        setPoint(
          { lat: position.coords.latitude, lng: position.coords.longitude },
          position.coords.accuracy > 100 ? `Localização aproximada (±${Math.round(position.coords.accuracy)} m): confira o marcador.` : 'Localização do aparelho marcada.',
        ),
      () => setError('Não foi possível obter a localização deste aparelho.'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      let current = form;
      // Salvando sem localização: tenta achar pelo endereço antes de desistir.
      if (current.lat == null || current.lng == null) {
        const found = await locate(current);
        if (found) current = { ...current, lat: found.lat, lng: found.lng };
      }
      if (requireLocation && (current.lat == null || current.lng == null)) {
        setError('Marque a localização no mapa antes de salvar: é por ela que os clientes próximos encontram você.');
        return;
      }
      await onSubmit(toPayload(current, withLabel));
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

      <div className="space-y-3 sm:col-span-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-fg">Localização no mapa{requireLocation && <span className="text-danger"> *</span>}</p>
            <p className="text-xs text-muted">Clique no mapa ou arraste o marcador até a porta do endereço. Ela define entregas, fretes e quem encontra você.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" loading={locating} onClick={() => void locate(form)} disabled={!form.city}>
              Localizar pelo endereço
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={useDeviceLocation}>
              Usar a localização deste aparelho
            </Button>
          </div>
        </div>
        <Suspense fallback={<div className="lj-skeleton h-[280px] w-full rounded-xl" />}>
          <LocationPicker value={point} zoom={zoom} onChange={(value) => setPoint(value, 'Localização ajustada no mapa.')} />
        </Suspense>
        <p className="text-xs text-muted" aria-live="polite">
          {locationNote ?? (point ? `Localização marcada: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : 'Nenhuma localização marcada ainda.')}
        </p>
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
