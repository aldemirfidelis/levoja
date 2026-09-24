'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@levoja/web-kit/client';
import { AddressForm, Button, Card, errorMessage, useToast } from '@levoja/web-kit/ui';
import { useCompany } from '@/lib/company';

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

interface Shift {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

function OpeningHoursEditor() {
  const { company, reload } = useCompany();
  const toast = useToast();
  const [shifts, setShifts] = useState<Shift[]>(company.openingHours.length ? company.openingHours : [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opensAt: '09:00', closesAt: '18:00' })));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const update = (index: number, patch: Partial<Shift>) => setShifts(shifts.map((shift, i) => (i === index ? { ...shift, ...patch } : shift)));
  const copyToAll = (weekday: number) => {
    const source = shifts.filter((shift) => shift.weekday === weekday);
    setShifts([0, 1, 2, 3, 4, 5, 6].flatMap((day) => source.map((shift) => ({ ...shift, weekday: day }))));
  };

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.put(`companies/${company.id}/opening-hours`, { hours: shifts });
      toast.success('Horários salvos.');
      reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Horário de funcionamento" actions={<span className="text-xs text-muted">Fuso: {company.timezone}</span>}>
      <div className="space-y-4">
        {WEEKDAYS.map((label, weekday) => {
          const dayShifts = shifts.map((shift, index) => ({ shift, index })).filter(({ shift }) => shift.weekday === weekday);
          return (
            <div key={weekday} className="flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-start">
              <p className="w-24 pt-2 text-sm font-medium">{label}</p>
              <div className="flex-1 space-y-2">
                {dayShifts.length === 0 && <p className="pt-2 text-sm text-muted">Fechado</p>}
                {dayShifts.map(({ shift, index }) => (
                  <div key={index} className="flex items-center gap-2">
                    <input type="time" aria-label={`${label}: abre`} value={shift.opensAt} onChange={(e) => update(index, { opensAt: e.target.value })} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm" />
                    <span className="text-muted">até</span>
                    <input type="time" aria-label={`${label}: fecha`} value={shift.closesAt} onChange={(e) => update(index, { closesAt: e.target.value })} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm" />
                    <button onClick={() => setShifts(shifts.filter((_, i) => i !== index))} className="rounded-lg p-2 text-muted hover:text-danger" aria-label="Remover turno">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setShifts([...shifts, { weekday, opensAt: '09:00', closesAt: '18:00' }])}>
                  Turno
                </Button>
                {dayShifts.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => copyToAll(weekday)}>
                    Copiar p/ todos
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        <p className="text-xs text-muted">Turnos que terminam depois da meia-noite são aceitos (ex.: 18:00 até 02:00).</p>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button onClick={save} loading={busy}>
          Salvar horários
        </Button>
      </div>
    </Card>
  );
}

export default function CompanyAddressPage() {
  const { company, reload } = useCompany();
  const toast = useToast();
  return (
    <div className="space-y-6">
      <Card title="Endereço do estabelecimento">
        <AddressForm
          initial={company.address}
          onSubmit={async (address) => {
            await api.put(`companies/${company.id}/address`, address);
            toast.success('Endereço salvo.');
            reload();
          }}
        />
      </Card>
      <OpeningHoursEditor />
    </div>
  );
}
