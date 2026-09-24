import { useState } from 'react';
import { VEHICLE_TYPE_LABELS } from '@levoja/shared';
import { api, Badge, Button, errorMessage, ErrorView, Field, Loading, Row, Screen, Text, useApi, useToast } from '@levoja/mobile-kit';
import type { DriverProfile, Vehicle } from '@/lib/types';

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  APPROVED: { label: 'Aprovado', tone: 'success' },
  PENDING: { label: 'Em análise', tone: 'warning' },
  REJECTED: { label: 'Reprovado', tone: 'danger' },
};

export default function VehicleScreen() {
  const profile = useApi<DriverProfile>('drivers/me');
  if (profile.isLoading) return <Loading />;
  if (profile.error || !profile.data) return <ErrorView error={profile.error} onRetry={() => profile.refetch()} />;
  const vehicle = profile.data.vehicles.find((item) => item.id === profile.data!.activeVehicleId) ?? profile.data.vehicles[0];
  if (!vehicle) return <ErrorView error={new Error('Nenhum veículo cadastrado.')} />;
  return <VehicleForm vehicle={vehicle} editable={profile.data.status !== 'UNDER_REVIEW'} onSaved={() => profile.refetch()} />;
}

function VehicleForm({ vehicle, editable, onSaved }: { vehicle: Vehicle; editable: boolean; onSaved: () => void }) {
  const toast = useToast();
  const motorized = vehicle.type !== 'BICYCLE';
  const [form, setForm] = useState({ plate: vehicle.plate ?? '', brand: vehicle.brand ?? '', model: vehicle.model ?? '', year: vehicle.year ? String(vehicle.year) : '', color: vehicle.color ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = STATUS[vehicle.status] ?? { label: vehicle.status, tone: 'neutral' as const };

  const save = async () => {
    setError(null);
    if (motorized && !/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(form.plate.toUpperCase().replace(/[^A-Z0-9]/g, ''))) return setError('Placa inválida (padrão antigo ou Mercosul).');
    setBusy(true);
    try {
      await api.patch(`drivers/me/vehicles/${vehicle.id}`, {
        plate: motorized ? form.plate : undefined,
        brand: form.brand || undefined,
        model: form.model || undefined,
        year: form.year ? Number(form.year) : undefined,
        color: form.color || undefined,
      });
      toast.success('Veículo atualizado.');
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen footer={editable ? <Button title="Salvar" onPress={save} loading={busy} fullWidth /> : undefined}>
      <Row justify="space-between">
        <Text variant="heading">{VEHICLE_TYPE_LABELS[vehicle.type]}</Text>
        <Badge label={status.label} tone={status.tone} />
      </Row>
      {motorized ? <Field label="Placa" value={form.plate} onChangeText={(plate) => setForm({ ...form, plate: plate.toUpperCase() })} autoCapitalize="characters" maxLength={8} editable={editable} /> : null}
      <Field label="Marca" value={form.brand} onChangeText={(brand) => setForm({ ...form, brand })} editable={editable} />
      <Field label="Modelo" value={form.model} onChangeText={(model) => setForm({ ...form, model })} editable={editable} />
      <Row gap={3}>
        <Field label="Ano" value={form.year} onChangeText={(year) => setForm({ ...form, year: year.replace(/\D/g, '').slice(0, 4) })} keyboardType="number-pad" containerStyle={{ flex: 1 }} editable={editable} />
        <Field label="Cor" value={form.color} onChangeText={(color) => setForm({ ...form, color })} containerStyle={{ flex: 1 }} editable={editable} />
      </Row>
      {error ? <Text tone="danger">{error}</Text> : null}
    </Screen>
  );
}
