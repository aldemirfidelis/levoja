'use client';

import { FormEvent, useState } from 'react';
import { MapPinned, Pencil, Plus, Trash2 } from 'lucide-react';
import { formatBRL } from '@levoja/shared';
import { api, useApi, useApiMutation } from '@levoja/web-kit/client';
import { Badge, Button, Card, Checkbox, ConfirmDialog, Dialog, EmptyState, errorMessage, Input, Select, SkeletonRows, Textarea, useToast } from '@levoja/web-kit/ui';
import { MoneyInput } from '@/components/money-input';
import { useCompany } from '@/lib/company';

type AreaType = 'RADIUS' | 'POLYGON' | 'DISTRICTS' | 'CITIES';

interface ServiceArea {
  id: string;
  name: string;
  type: AreaType;
  radiusKm: number | null;
  polygon: [number, number][] | null;
  districts: string[];
  cities: string[];
  feeAdjustmentCents: number;
  minimumOrderCents: number | null;
  extraMinutes: number;
  isActive: boolean;
}

const TYPE_LABELS: Record<AreaType, string> = { RADIUS: 'Raio', POLYGON: 'Polígono', DISTRICTS: 'Bairros', CITIES: 'Cidades' };

function AreaForm({ area, onClose }: { area: ServiceArea | null; onClose: () => void }) {
  const { company } = useCompany();
  const toast = useToast();
  const base = `companies/${company.id}/service-areas`;
  const [form, setForm] = useState({
    name: area?.name ?? '',
    type: (area?.type ?? 'RADIUS') as AreaType,
    radiusKm: area?.radiusKm?.toString() ?? '5',
    polygon: area?.polygon?.map(([lng, lat]) => `${lat}, ${lng}`).join('\n') ?? '',
    districts: area?.districts.join('\n') ?? '',
    cities: area?.cities.join('\n') ?? (company.address ? `${company.address.city}/${company.address.state}` : ''),
    feeAdjustmentCents: area?.feeAdjustmentCents ?? 0,
    minimumOrderCents: area?.minimumOrderCents ?? null,
    extraMinutes: area?.extraMinutes ?? 0,
    isActive: area?.isActive ?? true,
  });
  const [error, setError] = useState<string>();
  const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);

  const save = useApiMutation(() => {
    const body = {
      name: form.name,
      type: form.type,
      radiusKm: form.type === 'RADIUS' ? Number(form.radiusKm.replace(',', '.')) : undefined,
      polygon:
        form.type === 'POLYGON'
          ? lines(form.polygon).map((line) => {
              const [lat, lng] = line.split(/[,;\s]+/).map(Number);
              return [lng, lat] as [number, number];
            })
          : undefined,
      districts: form.type === 'DISTRICTS' ? lines(form.districts) : undefined,
      cities: form.type === 'CITIES' ? lines(form.cities) : undefined,
      feeAdjustmentCents: form.feeAdjustmentCents,
      minimumOrderCents: form.minimumOrderCents ?? undefined,
      extraMinutes: Number(form.extraMinutes) || 0,
      isActive: form.isActive,
    };
    return area ? api.put(`${base}/${area.id}`, body) : api.post(base, body);
  }, [base]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await save.mutateAsync(undefined);
      toast.success('Área salva.');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onClose={onClose} title={area ? 'Editar área' : 'Nova área de entrega'} size="lg">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Input label="Nome" required placeholder="Ex.: Centro expandido" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Select
          label="Tipo"
          value={form.type}
          options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(e) => setForm({ ...form, type: e.target.value as AreaType })}
        />
        {form.type === 'RADIUS' && (
          <Input label="Raio (km)" inputMode="decimal" required value={form.radiusKm} onChange={(e) => setForm({ ...form, radiusKm: e.target.value })} hint="Medido em linha reta a partir do endereço da loja." />
        )}
        {form.type === 'DISTRICTS' && (
          <Textarea className="sm:col-span-2" label="Bairros (um por linha)" rows={6} value={form.districts} onChange={(e) => setForm({ ...form, districts: e.target.value })} />
        )}
        {form.type === 'CITIES' && (
          <Textarea className="sm:col-span-2" label="Cidades (uma por linha, formato Cidade/UF)" rows={4} value={form.cities} onChange={(e) => setForm({ ...form, cities: e.target.value })} />
        )}
        {form.type === 'POLYGON' && (
          <Textarea
            className="sm:col-span-2"
            label="Vértices do polígono (latitude, longitude — um por linha)"
            rows={6}
            placeholder={'-23.5505, -46.6333\n-23.5600, -46.6400\n-23.5700, -46.6200'}
            value={form.polygon}
            onChange={(e) => setForm({ ...form, polygon: e.target.value })}
          />
        )}
        <MoneyInput label="Ajuste no frete (R$)" value={Math.abs(form.feeAdjustmentCents)} onChange={(cents) => setForm({ ...form, feeAdjustmentCents: cents ?? 0 })} hint="Acréscimo aplicado ao frete nesta área." />
        <MoneyInput label="Pedido mínimo (R$)" value={form.minimumOrderCents} onChange={(cents) => setForm({ ...form, minimumOrderCents: cents })} hint="Vazio = pedido mínimo da loja." />
        <Input label="Minutos extras no prazo" type="number" min={0} max={240} value={form.extraMinutes} onChange={(e) => setForm({ ...form, extraMinutes: Number(e.target.value) })} />
        <Checkbox className="sm:col-span-2" label="Área ativa" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
        {error && <p className="text-sm text-danger sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function DeliveryAreaPage() {
  const { company } = useCompany();
  const toast = useToast();
  const base = `companies/${company.id}/service-areas`;
  const { data, isLoading, refetch } = useApi<ServiceArea[]>(base);
  const [editing, setEditing] = useState<ServiceArea | 'new' | null>(null);
  const [removing, setRemoving] = useState<ServiceArea | null>(null);

  const summary = (area: ServiceArea) =>
    area.type === 'RADIUS'
      ? `${area.radiusKm} km a partir da loja`
      : area.type === 'DISTRICTS'
        ? `${area.districts.length} bairro(s)`
        : area.type === 'CITIES'
          ? area.cities.join(', ')
          : `${area.polygon?.length ?? 0} vértices`;

  return (
    <div className="space-y-6">
      {!company.address?.lat && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          A loja ainda não tem localização no mapa. Atualize o endereço em “Endereço e horários” usando “Usar minha localização” para que o frete seja calculado.
        </p>
      )}
      <Card title="Áreas de entrega" actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Nova área</Button>}>
        {isLoading ? (
          <SkeletonRows rows={2} />
        ) : !data?.length ? (
          <EmptyState icon={<MapPinned className="h-8 w-8" />} title="Nenhuma área configurada" description="Sem áreas, a loja atende o raio padrão da plataforma a partir do seu endereço." />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((area) => (
              <li key={area.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="flex items-center gap-2 font-medium">
                    {area.name} <Badge>{TYPE_LABELS[area.type]}</Badge> {!area.isActive && <Badge tone="warning">Inativa</Badge>}
                  </p>
                  <p className="text-sm text-muted">
                    {summary(area)}
                    {area.feeAdjustmentCents ? ` · frete +${formatBRL(area.feeAdjustmentCents)}` : ''}
                    {area.minimumOrderCents != null ? ` · mínimo ${formatBRL(area.minimumOrderCents)}` : ''}
                    {area.extraMinutes ? ` · +${area.extraMinutes} min` : ''}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setEditing(area)} className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label="Editar">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => setRemoving(area)} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-danger" aria-label="Remover">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <AreaForm area={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {removing && (
        <ConfirmDialog
          open
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api.delete(`${base}/${removing.id}`);
            toast.success('Área removida.');
            await refetch();
          }}
          title={`Remover "${removing.name}"?`}
          confirmLabel="Remover"
          tone="danger"
        />
      )}
    </div>
  );
}
