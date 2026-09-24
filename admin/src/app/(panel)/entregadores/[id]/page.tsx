'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { VEHICLE_TYPE_LABELS } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DescriptionList,
  DocumentStatusBadge,
  ErrorState,
  formatDate,
  formatDateTime,
  formatPhone,
  PageHeader,
  PartnerStatusBadge,
  SkeletonRows,
  useToast,
} from '@levoja/web-kit/ui';
import { DocumentsReview, PartnerActions, RequirementsList, StatusHistory } from '@/components/partner-review';
import { useSession } from '@/lib/session';
import type { DriverDetail, Vehicle } from '@/lib/types';

export default function DriverDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useSession();
  const toast = useToast();
  const { data, error, isLoading, refetch } = useApi<DriverDetail>(`admin/drivers/${id}`);
  const [rejectingVehicle, setRejectingVehicle] = useState<Vehicle | null>(null);
  const basePath = `admin/drivers/${id}`;

  const reviewVehicle = async (vehicle: Vehicle, status: 'APPROVED' | 'REJECTED', note?: string) => {
    await api.post(`${basePath}/vehicles/${vehicle.id}/review`, { status, note });
    toast.success(status === 'APPROVED' ? 'Veículo aprovado.' : 'Veículo reprovado.');
    await refetch();
  };

  if (isLoading) return <SkeletonRows rows={8} />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <>
      <PageHeader
        back={
          <Link href="/entregadores" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" /> Entregadores
          </Link>
        }
        title={data.user.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <PartnerStatusBadge status={data.status} />
            {data.ratingAvg > 0 && <span>★ {data.ratingAvg.toFixed(2)}</span>}
          </span>
        }
        actions={<PartnerActions actions={data.adminActions} basePath={basePath} onDone={() => refetch()} subject={data.user.name} />}
      />

      {data.statusReason && (
        <p className="mb-6 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-fg">
          <strong>Motivo registrado:</strong> {data.statusReason}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Documentos">
            <DocumentsReview documents={data.documents} basePath={basePath} canReview={can('drivers.review')} onChange={() => refetch()} />
          </Card>

          <Card title="Dados pessoais">
            <DescriptionList
              items={[
                { label: 'E-mail', value: data.user.email },
                { label: 'Telefone', value: formatPhone(data.user.phone) },
                { label: 'CPF', value: data.user.cpfMasked },
                { label: 'Nascimento', value: formatDate(data.user.birthDate) },
                { label: 'CNH', value: data.cnhNumberMasked ? `${data.cnhNumberMasked} · cat. ${data.cnhCategory ?? '—'}` : null },
                { label: 'Validade da CNH', value: formatDate(data.cnhExpiresAt) },
                {
                  label: 'Endereço',
                  value: data.address ? `${data.address.street}, ${data.address.number} — ${data.address.district}, ${data.address.city}/${data.address.state}` : null,
                },
                { label: 'PIX', value: data.bankAccount?.pixKeyMasked ? `${data.bankAccount.pixKeyType}: ${data.bankAccount.pixKeyMasked}` : null },
                { label: 'Cadastro iniciado', value: formatDateTime(data.createdAt) },
                { label: 'Aprovado em', value: formatDateTime(data.approvedAt) },
              ]}
            />
          </Card>

          <Card title="Veículos">
            <ul className="divide-y divide-border">
              {data.vehicles.map((vehicle) => (
                <li key={vehicle.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-fg">
                      {VEHICLE_TYPE_LABELS[vehicle.type]} {vehicle.brand} {vehicle.model} {vehicle.year}
                      {vehicle.id === data.activeVehicleId && <Badge tone="brand" className="ml-2">Ativo</Badge>}
                    </p>
                    <p className="text-xs text-muted">{vehicle.plate ? `Placa ${vehicle.plate}` : 'Sem placa'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <DocumentStatusBadge status={vehicle.status} />
                    {can('drivers.review') && vehicle.status === 'PENDING' && data.status === 'APPROVED' && (
                      <>
                        <Button size="sm" variant="success" onClick={() => reviewVehicle(vehicle, 'APPROVED').catch(toast.error)}>
                          Aprovar
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setRejectingVehicle(vehicle)}>
                          Reprovar
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <RequirementsList items={data.requirements} />
          <StatusHistory entries={data.history} />
        </div>
      </div>

      {rejectingVehicle && (
        <ConfirmDialog
          open
          onClose={() => setRejectingVehicle(null)}
          onConfirm={(note) => reviewVehicle(rejectingVehicle, 'REJECTED', note)}
          title="Reprovar veículo"
          confirmLabel="Reprovar"
          tone="danger"
          reason={{ label: 'Motivo', required: true }}
        />
      )}
    </>
  );
}
