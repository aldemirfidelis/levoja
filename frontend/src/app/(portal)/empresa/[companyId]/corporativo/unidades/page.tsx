'use client';

import { FormEvent, useState } from 'react';
import { Building2, MapPin, Plus } from 'lucide-react';
import { api, useApi } from '@levoja/web-kit/client';
import { Badge, Button, Card, Checkbox, DataTable, Dialog, EmptyState, Input, SkeletonRows, useToast } from '@levoja/web-kit/ui';
import type { CompanyLocation } from '@/components/b2b';
import { useCompany } from '@/lib/company';
import { PlanAwareError } from '@/components/plan-gate';

type Form = {
  name: string;
  isUnit: boolean;
  contactName: string;
  contactPhone: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  reference: string;
  lat: string;
  lng: string;
};

const EMPTY: Form = { name: '', isUnit: true, contactName: '', contactPhone: '', zipCode: '', street: '', number: '', complement: '', district: '', city: '', state: '', reference: '', lat: '', lng: '' };

function toForm(location: CompanyLocation): Form {
  return {
    name: location.name,
    isUnit: location.isUnit,
    contactName: location.contactName ?? '',
    contactPhone: location.contactPhone ?? '',
    zipCode: location.zipCode ?? '',
    street: location.street,
    number: location.number,
    complement: location.complement ?? '',
    district: location.district ?? '',
    city: location.city,
    state: location.state,
    reference: location.reference ?? '',
    lat: String(location.lat),
    lng: String(location.lng),
  };
}

function LocationDialog({ location, onClose, onSaved }: { location: CompanyLocation | null; onClose: () => void; onSaved: () => void }) {
  const { company } = useCompany();
  const toast = useToast();
  const [form, setForm] = useState<Form>(location ? toForm(location) : EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof Form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });

  const lookupCep = async (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 8) return;
    try {
      const data = await (await fetch(`https://viacep.com.br/ws/${digits}/json/`)).json();
      if (!data.erro) setForm((current) => ({ ...current, street: data.logradouro || current.street, district: data.bairro || current.district, city: data.localidade || current.city, state: data.uf || current.state }));
    } catch {
      // Preenchimento manual.
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = {
      name: form.name,
      isUnit: form.isUnit,
      contactName: form.contactName || null,
      contactPhone: form.contactPhone || null,
      zipCode: form.zipCode || null,
      street: form.street,
      number: form.number,
      complement: form.complement || null,
      district: form.district || null,
      city: form.city,
      state: form.state.toUpperCase(),
      reference: form.reference || null,
      ...(form.lat && form.lng ? { lat: Number(form.lat.replace(',', '.')), lng: Number(form.lng.replace(',', '.')) } : {}),
    };
    setBusy(true);
    try {
      if (location) await api.patch(`companies/${company.id}/b2b/locations/${location.id}`, body);
      else await api.post(`companies/${company.id}/b2b/locations`, body);
      toast.success('Local salvo.');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} size="lg" title={location ? `Editar ${location.name}` : 'Nova unidade ou local'} description="Use para coletas, transferências entre unidades e entregas recorrentes.">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-6">
        <Input className="sm:col-span-4" label="Nome" required minLength={2} maxLength={80} value={form.name} onChange={set('name')} placeholder="Ex.: Filial Centro, CD Guarulhos" />
        <div className="flex items-end pb-2 sm:col-span-2">
          <Checkbox label="Unidade própria" checked={form.isUnit} onChange={(event) => setForm({ ...form, isUnit: event.target.checked })} />
        </div>
        <Input className="sm:col-span-3" label="Contato no local" value={form.contactName} onChange={set('contactName')} maxLength={120} />
        <Input className="sm:col-span-3" label="Telefone do local" value={form.contactPhone} onChange={set('contactPhone')} maxLength={20} inputMode="tel" />
        <Input className="sm:col-span-2" label="CEP" value={form.zipCode} onChange={(event) => { set('zipCode')(event); void lookupCep(event.target.value); }} maxLength={9} />
        <Input className="sm:col-span-4" label="Rua" required value={form.street} onChange={set('street')} />
        <Input className="sm:col-span-2" label="Número" required value={form.number} onChange={set('number')} />
        <Input className="sm:col-span-4" label="Complemento" value={form.complement} onChange={set('complement')} />
        <Input className="sm:col-span-2" label="Bairro" value={form.district} onChange={set('district')} />
        <Input className="sm:col-span-3" label="Cidade" required value={form.city} onChange={set('city')} />
        <Input className="sm:col-span-1" label="UF" required maxLength={2} value={form.state} onChange={set('state')} />
        <Input className="sm:col-span-6" label="Ponto de referência" value={form.reference} onChange={set('reference')} maxLength={150} />
        <Input className="sm:col-span-2" label="Latitude" inputMode="decimal" value={form.lat} onChange={set('lat')} />
        <Input className="sm:col-span-2" label="Longitude" inputMode="decimal" value={form.lng} onChange={set('lng')} />
        <div className="flex items-end pb-1 sm:col-span-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<MapPin className="h-4 w-4" />}
            onClick={() => navigator.geolocation?.getCurrentPosition((position) => setForm((current) => ({ ...current, lat: String(position.coords.latitude), lng: String(position.coords.longitude) })))}
          >
            Estou no local
          </Button>
        </div>
        <p className="text-xs text-muted sm:col-span-6">Sem coordenadas, localizamos o endereço automaticamente quando o mapa estiver disponível.</p>
        <div className="flex justify-end gap-2 sm:col-span-6">
          <Button type="button" variant="ghost" onClick={onClose}>
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

export default function LocationsPage() {
  const { company, can } = useCompany();
  const toast = useToast();
  const manage = can('company.b2b.manage');
  const { data, error, isLoading, refetch } = useApi<CompanyLocation[]>(`companies/${company.id}/b2b/locations`, { all: manage ? 'true' : undefined });
  const [editing, setEditing] = useState<CompanyLocation | 'new' | null>(null);

  const toggle = async (location: CompanyLocation) => {
    try {
      await api.patch(`companies/${company.id}/b2b/locations/${location.id}`, { isActive: !location.isActive });
      toast.success(location.isActive ? 'Local desativado.' : 'Local reativado.');
      await refetch();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Card title="Unidades e locais" actions={manage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Novo local</Button>}>
      <p className="mb-4 text-sm text-muted">Filiais, centros de distribuição e endereços frequentes. Escolha-os como coleta ou destino — uma entrega entre duas unidades é uma transferência.</p>
      {isLoading && <SkeletonRows rows={3} />}
      {error && <PlanAwareError error={error} onRetry={() => refetch()} />}
      {data?.length === 0 && <EmptyState icon={<Building2 className="h-8 w-8" />} title="Nenhum local cadastrado" />}
      {data && data.length > 0 && (
        <DataTable
          rows={data}
          rowKey={(row) => row.id}
          columns={[
            {
              key: 'name',
              header: 'Local',
              cell: (row) => (
                <div>
                  <p className="font-medium">{row.name}</p>
                  <p className="text-xs text-muted">
                    {row.street}, {row.number} — {row.city}/{row.state}
                  </p>
                </div>
              ),
            },
            { key: 'type', header: 'Tipo', cell: (row) => <Badge tone={row.isUnit ? 'brand' : 'neutral'}>{row.isUnit ? 'Unidade' : 'Endereço frequente'}</Badge>, hideOnMobile: true },
            { key: 'contact', header: 'Contato', cell: (row) => row.contactName ?? '—', hideOnMobile: true },
            { key: 'status', header: 'Situação', cell: (row) => <Badge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'Ativo' : 'Inativo'}</Badge> },
            ...(manage
              ? [
                  {
                    key: 'actions',
                    header: '',
                    className: 'text-right',
                    cell: (row: CompanyLocation) => (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                          Editar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void toggle(row)}>
                          {row.isActive ? 'Desativar' : 'Reativar'}
                        </Button>
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
      {editing && (
        <LocationDialog
          location={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refetch();
          }}
        />
      )}
    </Card>
  );
}
