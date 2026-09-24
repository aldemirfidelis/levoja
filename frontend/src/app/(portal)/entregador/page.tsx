'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { Smartphone, Wallet } from 'lucide-react';
import {
  DRIVER_DOCUMENT_LABELS,
  DRIVER_DOCUMENT_TYPES,
  PARTNER_STATUS_LABELS,
  PartnerAction,
  PartnerStatus,
  requiredDriverDocuments,
  VEHICLE_TYPE_LABELS,
  VehicleType,
} from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import {
  AddressForm,
  AddressValue,
  Button,
  Card,
  EmptyState,
  errorMessage,
  ErrorState,
  Input,
  PartnerStatusBadge,
  Select,
  SkeletonRows,
  SupportCenter,
  useToast,
} from '@levoja/web-kit/ui';
import { BankAccountForm, BankAccountView, Checklist, DocumentsManager, PartnerDoc, Requirement } from '@/components/partner-forms';
import { maskCpf } from '@/components/signup-fields';

interface Vehicle {
  id: string;
  type: VehicleType;
  plate: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  status: string;
}

interface DriverView {
  id: string;
  status: PartnerStatus;
  statusReason: string | null;
  user: { name: string; cpfMasked: string | null; birthDate: string | null };
  cnhNumberMasked: string | null;
  cnhCategory: string | null;
  cnhExpiresAt: string | null;
  address: AddressValue | null;
  activeVehicleId: string | null;
  vehicles: Vehicle[];
  documents: PartnerDoc[];
  bankAccount: BankAccountView | null;
  requirements: Requirement[];
  ownerActions: PartnerAction[];
}

const HELP: Record<PartnerStatus, string> = {
  DRAFT: 'Complete as etapas abaixo e envie seu cadastro para análise.',
  PENDING_DOCUMENTS: 'Precisamos de correções. Veja os itens indicados e envie novamente.',
  UNDER_REVIEW: 'Cadastro em análise. Avisaremos por e-mail e notificação (normalmente em até 2 dias úteis).',
  APPROVED: 'Cadastro aprovado! Baixe o app do entregador, entre com sua conta e toque em "Ficar online".',
  REJECTED: 'Cadastro reprovado. Veja o motivo, ajuste e envie novamente.',
  SUSPENDED: 'Sua conta de entregador está suspensa. Fale com o suporte.',
  BLOCKED: 'Sua conta de entregador está bloqueada.',
};

function PersonalData({ driver, motorized, onSaved }: { driver: DriverView; motorized: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ cpf: '', birthDate: driver.user.birthDate ?? '', cnhNumber: '', cnhCategory: driver.cnhCategory ?? '', cnhExpiresAt: driver.cnhExpiresAt ?? '' });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.patch('drivers/me', {
        cpf: form.cpf || undefined,
        birthDate: form.birthDate || undefined,
        cnhNumber: form.cnhNumber || undefined,
        cnhCategory: form.cnhCategory || undefined,
        cnhExpiresAt: form.cnhExpiresAt || undefined,
      });
      toast.success('Dados salvos.');
      setForm({ ...form, cnhNumber: '', cpf: '' });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Dados pessoais">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {driver.user.cpfMasked ? (
          <Input label="CPF" disabled value={driver.user.cpfMasked} />
        ) : (
          <Input label="CPF" required value={form.cpf} onChange={(e) => setForm({ ...form, cpf: maskCpf(e.target.value) })} />
        )}
        <Input label="Data de nascimento" type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} />
        {motorized && (
          <>
            <Input
              label="Número da CNH"
              inputMode="numeric"
              placeholder={driver.cnhNumberMasked ?? '11 dígitos'}
              hint={driver.cnhNumberMasked ? 'Já informado. Preencha apenas para alterar.' : undefined}
              value={form.cnhNumber}
              onChange={(e) => setForm({ ...form, cnhNumber: e.target.value.replace(/\D/g, '').slice(0, 11) })}
            />
            <Select
              label="Categoria da CNH"
              value={form.cnhCategory}
              placeholder="Selecione"
              options={['A', 'B', 'AB', 'C', 'D', 'E', 'AC', 'AD', 'AE'].map((value) => ({ value, label: value }))}
              onChange={(e) => setForm({ ...form, cnhCategory: e.target.value })}
            />
            <Input label="Validade da CNH" type="date" value={form.cnhExpiresAt} onChange={(e) => setForm({ ...form, cnhExpiresAt: e.target.value })} />
          </>
        )}
        {error && <p className="text-sm text-danger sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" loading={busy}>
            Salvar dados
          </Button>
        </div>
      </form>
    </Card>
  );
}

function VehicleData({ vehicle, onSaved }: { vehicle: Vehicle; onSaved: () => void }) {
  const toast = useToast();
  const motorized = vehicle.type !== 'BICYCLE';
  const [form, setForm] = useState({ plate: vehicle.plate ?? '', brand: vehicle.brand ?? '', model: vehicle.model ?? '', year: vehicle.year ? String(vehicle.year) : '', color: vehicle.color ?? '' });
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.patch(`drivers/me/vehicles/${vehicle.id}`, {
        ...(motorized && form.plate ? { plate: form.plate } : {}),
        brand: form.brand || undefined,
        model: form.model || undefined,
        year: form.year ? Number(form.year) : undefined,
        color: form.color || undefined,
      });
      toast.success('Veículo salvo.');
      onSaved();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={`Veículo: ${VEHICLE_TYPE_LABELS[vehicle.type]}`}>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
        {motorized && <Input label="Placa" placeholder="ABC1D23" value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })} />}
        <Input label="Marca" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
        <Input label="Modelo" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        <Input label="Ano" inputMode="numeric" maxLength={4} value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value.replace(/\D/g, '') })} />
        <Input label="Cor" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
        <div className="sm:col-span-3">
          <Button type="submit" loading={busy}>
            Salvar veículo
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function DriverOnboardingPage() {
  const toast = useToast();
  const { data: driver, error, isLoading, refetch } = useApi<DriverView>('drivers/me', undefined, { retry: false });
  const [busy, setBusy] = useState(false);

  if (isLoading) return <SkeletonRows rows={6} />;
  if (error?.status === 404) {
    return (
      <EmptyState
        title="Você ainda não é entregador"
        description="Crie seu cadastro de entregador com a mesma conta."
        action={
          <Link href="/cadastro/entregador" className="font-semibold text-brand-600 hover:underline">
            Quero ser entregador
          </Link>
        }
      />
    );
  }
  if (error || !driver) return <ErrorState error={error} onRetry={() => refetch()} />;

  const vehicle = driver.vehicles.find((item) => item.id === driver.activeVehicleId) ?? driver.vehicles[0];
  const motorized = !!vehicle && vehicle.type !== 'BICYCLE';
  const required = vehicle ? requiredDriverDocuments(vehicle.type) : [];
  const editable = !['UNDER_REVIEW', 'BLOCKED'].includes(driver.status);
  const pending = driver.requirements.filter((item) => !item.done);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('drivers/me/submit');
      toast.success('Cadastro enviado para análise!');
      await refetch();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Cadastro de entregador</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted">
            <PartnerStatusBadge status={driver.status} /> {PARTNER_STATUS_LABELS[driver.status]}
          </div>
        </div>
        {driver.ownerActions.includes('SUBMIT') && (
          <Button size="lg" onClick={submit} loading={busy} disabled={pending.length > 0}>
            Enviar para análise
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <p className="text-sm">{HELP[driver.status]}</p>
            {driver.statusReason && (
              <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
                <strong>Mensagem da análise:</strong> {driver.statusReason}
              </p>
            )}
            {driver.status === 'APPROVED' && (
              <>
                <p className="mt-3 flex items-center gap-2 text-sm text-muted">
                  <Smartphone className="h-4 w-4" aria-hidden /> Use o app LevoJá Entregador para ficar online, receber ofertas e fazer as entregas.
                </p>
                <Link href="/entregador/ganhos" className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:underline">
                  <Wallet className="h-4 w-4" aria-hidden /> Ganhos, saques e chave PIX
                </Link>
              </>
            )}
          </Card>
          {editable && (
            <>
              <PersonalData driver={driver} motorized={motorized} onSaved={() => refetch()} />
              {vehicle && <VehicleData key={vehicle.id} vehicle={vehicle} onSaved={() => refetch()} />}
              <Card title="Endereço">
                <AddressForm
                  initial={driver.address}
                  onSubmit={async (address) => {
                    await api.put('drivers/me/address', address);
                    toast.success('Endereço salvo.');
                    await refetch();
                  }}
                />
              </Card>
              <Card title="Chave PIX para receber seus ganhos">
                <BankAccountForm path="drivers/me/bank-account" current={driver.bankAccount} onSaved={() => refetch()} defaultHolder={driver.user.name} />
              </Card>
            </>
          )}
          <DocumentsManager
            basePath="drivers/me"
            documents={driver.documents}
            required={required}
            types={DRIVER_DOCUMENT_TYPES.map((type) => ({ value: type, label: DRIVER_DOCUMENT_LABELS[type] }))}
            locked={editable ? undefined : 'Cadastro em análise: aguarde o resultado para enviar novos documentos.'}
            onChange={() => refetch()}
          />
          <Card title="Atendimento">
            <SupportCenter as="DRIVER" />
          </Card>
        </div>
        <Card title="Checklist">
          <Checklist items={driver.requirements} />
        </Card>
      </div>
    </div>
  );
}
