'use client';

import { FormEvent, useState } from 'react';
import { MapPinned, Plus } from 'lucide-react';
import { CITY_STATUS_LABELS, WAITLIST_PROFILE_LABELS, type CityStatus, type WaitlistProfile } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { Badge, Button, Card, DataTable, Dialog, EmptyState, ErrorState, formatDate, formatDateTime, Input, PageHeader, Select, SkeletonRows, Textarea, useToast } from '@levoja/web-kit/ui';
import { cityLabel } from '@/components/intelligence-nav';
import { CITY_TONE } from '@/components/saas-nav';
import { useSession } from '@/lib/session';

interface CityRow {
  id: string;
  key: string;
  name: string;
  state: string;
  status: CityStatus;
  timeZone: string;
  message: string | null;
  launchedAt: string | null;
  pausedAt: string | null;
  companies: number;
  drivers: number;
  deliveries30d: number;
  orders30d: number;
  waitlist: number;
}

interface CitiesView {
  cities: CityRow[];
  unregistered: { key: string; companies: number; drivers: number; deliveries30d: number; orders30d: number }[];
}

interface Waitlist {
  total: number;
  byProfile: Partial<Record<WaitlistProfile, number>>;
  entries: { id: string; name: string | null; email: string; profile: WaitlistProfile; notifiedAt: string | null; createdAt: string }[];
}

const STATUS_HELP: Record<CityStatus, string> = {
  PREPARING: 'Sem operação: pedidos e entregas recusados; interessados entram na lista de espera.',
  ACTIVE: 'Em operação. Ativar avisa por e-mail quem está na lista de espera.',
  PAUSED: 'Operação suspensa: novos pedidos e entregas são recusados com a mensagem abaixo.',
};

function CityDialog({ city, initial, onClose, onSaved }: { city: CityRow | null; initial?: { name: string; state: string }; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: city?.name ?? initial?.name ?? '',
    state: city?.state ?? initial?.state ?? '',
    status: city?.status ?? ('PREPARING' as CityStatus),
    timeZone: city?.timeZone ?? 'America/Sao_Paulo',
    message: city?.message ?? '',
  });
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (city) await api.patch(`admin/cities/${city.id}`, { status: form.status, timeZone: form.timeZone, message: form.message });
      else await api.post('admin/cities', form);
      toast.success(city && form.status === 'ACTIVE' && city.status !== 'ACTIVE' ? 'Cidade em operação. A lista de espera será avisada.' : 'Cidade salva.');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={city ? `${city.name}/${city.state}` : 'Nova cidade'}>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
        <Input className="sm:col-span-2" label="Cidade" required disabled={!!city} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <Input label="UF" required maxLength={2} disabled={!!city} value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value.toUpperCase() })} />
        <Select
          className="sm:col-span-3"
          label="Situação"
          value={form.status}
          onChange={(event) => setForm({ ...form, status: event.target.value as CityStatus })}
          options={Object.entries(CITY_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          hint={STATUS_HELP[form.status]}
        />
        <Input className="sm:col-span-3" label="Fuso horário (IANA)" value={form.timeZone} onChange={(event) => setForm({ ...form, timeZone: event.target.value })} />
        <Textarea className="sm:col-span-3" label="Mensagem para quem tenta usar a plataforma sem operação (opcional)" maxLength={300} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} />
        <div className="flex justify-end gap-2 sm:col-span-3">
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

function WaitlistDialog({ city, onClose }: { city: CityRow; onClose: () => void }) {
  const { data } = useApi<Waitlist>(`admin/cities/${city.id}/waitlist`);
  return (
    <Dialog open onClose={onClose} size="lg" title={`Lista de espera · ${city.name}/${city.state}`} description={data ? Object.entries(data.byProfile).map(([profile, count]) => `${WAITLIST_PROFILE_LABELS[profile as WaitlistProfile]}: ${count}`).join(' · ') || 'Vazia' : undefined}>
      {!data ? (
        <SkeletonRows rows={3} />
      ) : data.entries.length === 0 ? (
        <p className="text-sm text-muted">Ninguém na lista de espera.</p>
      ) : (
        <ul className="max-h-96 divide-y divide-border overflow-y-auto text-sm">
          {data.entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>
                {entry.name ?? entry.email} <span className="text-muted">· {WAITLIST_PROFILE_LABELS[entry.profile]}</span>
              </span>
              <span className="text-xs text-muted">{entry.notifiedAt ? `Avisado em ${formatDateTime(entry.notifiedAt)}` : `Desde ${formatDate(entry.createdAt)}`}</span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

export default function CitiesPage() {
  const { can } = useSession();
  const manage = can('service_areas.manage');
  const { data, error, isLoading, refetch } = useApi<CitiesView>('admin/cities');
  const [editing, setEditing] = useState<{ city: CityRow | null; initial?: { name: string; state: string } } | null>(null);
  const [waitlist, setWaitlist] = useState<CityRow | null>(null);

  return (
    <>
      <PageHeader
        title="Cidades"
        description="Onde a plataforma opera. Cidades em preparação e pausadas recusam novos pedidos e entregas; a lista de espera mostra onde expandir."
        actions={
          manage && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ city: null })}>
              Nova cidade
            </Button>
          )
        }
      />
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && data.cities.length === 0 && <EmptyState icon={<MapPinned className="h-8 w-8" />} title="Nenhuma cidade cadastrada" description="Sem cadastro, a plataforma atende qualquer cidade (configuração cities)." />}
      {data && data.cities.length > 0 && (
        <DataTable
          rows={data.cities}
          rowKey={(row) => row.id}
          onRowClick={manage ? (row) => setEditing({ city: row }) : undefined}
          columns={[
            {
              key: 'city',
              header: 'Cidade',
              cell: (row) => (
                <div>
                  <p className="font-medium">
                    {row.name}/{row.state}
                  </p>
                  {row.launchedAt && <p className="text-xs text-muted">Em operação desde {formatDate(row.launchedAt)}</p>}
                </div>
              ),
            },
            { key: 'status', header: 'Situação', cell: (row) => <Badge tone={CITY_TONE[row.status]}>{CITY_STATUS_LABELS[row.status]}</Badge> },
            { key: 'companies', header: 'Empresas', className: 'text-right tabular-nums', cell: (row) => row.companies, hideOnMobile: true },
            { key: 'drivers', header: 'Entregadores', className: 'text-right tabular-nums', cell: (row) => row.drivers, hideOnMobile: true },
            { key: 'demand', header: 'Pedidos + entregas (30 d)', className: 'text-right tabular-nums', cell: (row) => (row.orders30d + row.deliveries30d).toLocaleString('pt-BR'), hideOnMobile: true },
            {
              key: 'waitlist',
              header: 'Lista de espera',
              className: 'text-right',
              cell: (row) => (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    setWaitlist(row);
                  }}
                >
                  {row.waitlist}
                </Button>
              ),
            },
          ]}
        />
      )}
      {data && data.unregistered.length > 0 && (
        <Card title="Cidades com movimento e sem cadastro" className="mt-6">
          <ul className="divide-y divide-border text-sm">
            {data.unregistered.map((city) => {
              const [name, state] = cityLabel(city.key).split('/');
              return (
                <li key={city.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-fg">{cityLabel(city.key)}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-muted">
                      {city.companies} empresa(s) · {city.orders30d + city.deliveries30d} pedidos/entregas em 30 dias
                    </span>
                    {manage && (
                      <Button size="sm" variant="secondary" onClick={() => setEditing({ city: null, initial: { name, state: (state ?? '').toUpperCase() } })}>
                        Cadastrar
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {editing && (
        <CityDialog
          city={editing.city}
          initial={editing.initial}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refetch();
          }}
        />
      )}
      {waitlist && <WaitlistDialog city={waitlist} onClose={() => setWaitlist(null)} />}
    </>
  );
}
