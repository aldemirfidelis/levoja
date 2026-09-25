'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { Star, UserPlus } from 'lucide-react';
import { FLEET_INVITATION_STATUS_LABELS, VEHICLE_TYPE_LABELS, type FleetInvitationStatus, type VehicleType } from '@levoja/shared';
import { api, useApi, useApiMutation } from '@levoja/web-kit/client';
import { Badge, Button, Card, ConfirmDialog, DataTable, Dialog, EmptyState, errorMessage, formatDateTime, Input, SkeletonRows, Textarea, useToast, type Tone } from '@levoja/web-kit/ui';
import { useCompany } from '@/lib/company';
import { PlanAwareError } from '@/components/plan-gate';

interface FleetDriver {
  driverId: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  status: string;
  availability: 'OFFLINE' | 'ONLINE' | 'BUSY' | string;
  ratingAvg: number;
  ratingCount: number;
  vehicle: { type: VehicleType; plate: string | null; model: string | null } | null;
  deliveriesLast30Days: number;
}

interface FleetInvitation {
  id: string;
  driverName: string;
  status: FleetInvitationStatus;
  message: string | null;
  expiresAt: string;
  createdAt: string;
  respondedAt: string | null;
}

interface FleetView {
  fulfillmentMode: 'PLATFORM' | 'OWN_FLEET' | 'HYBRID';
  drivers: FleetDriver[];
  invitations: FleetInvitation[];
}

const MODE_TEXT: Record<FleetView['fulfillmentMode'], string> = {
  PLATFORM: 'Suas entregas usam só a rede de entregadores da plataforma — a frota própria não recebe pedidos neste modo.',
  OWN_FLEET: 'Suas entregas vão só para os entregadores da sua frota.',
  HYBRID: 'Suas entregas são oferecidas à sua frota e à rede da plataforma, com preferência para os entregadores da sua frota.',
};

const INVITE_TONE: Record<FleetInvitationStatus, Tone> = { PENDING: 'warning', ACCEPTED: 'success', DECLINED: 'danger', CANCELED: 'neutral', EXPIRED: 'neutral' };
const AVAILABILITY: Record<string, { label: string; tone: Tone }> = {
  ONLINE: { label: 'Disponível', tone: 'success' },
  BUSY: { label: 'Em entrega', tone: 'info' },
  OFFLINE: { label: 'Offline', tone: 'neutral' },
};

export default function CompanyFleetPage() {
  const { company } = useCompany();
  const toast = useToast();
  const base = `companies/${company.id}/fleet`;
  const fleet = useApi<FleetView>(base);
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({ login: '', message: '' });
  const [error, setError] = useState<string>();
  const [removing, setRemoving] = useState<FleetDriver | null>(null);

  const invite = useApiMutation(() => api.post(`${base}/invitations`, { login: form.login, message: form.message || undefined }), [base]);
  const cancel = useApiMutation((id: string) => api.post(`${base}/invitations/${id}/cancel`), [base]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    try {
      await invite.mutateAsync(undefined);
      toast.success('Convite enviado. O entregador responde pelo app.');
      setInviting(false);
      setForm({ login: '', message: '' });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (fleet.isLoading) return <SkeletonRows />;
  if (fleet.error || !fleet.data) return <PlanAwareError error={fleet.error} onRetry={() => fleet.refetch()} />;
  const data = fleet.data;

  return (
    <div className="space-y-6">
      <Card title="Modo de entrega">
        <p className="text-sm text-fg">{MODE_TEXT[data.fulfillmentMode]}</p>
        <p className="mt-2 text-sm text-muted">
          Os ganhos das entregas feitas pela sua frota entram na carteira da empresa, e vocês acertam o pagamento diretamente.{' '}
          <Link href={`/empresa/${company.id}/dados`} className="font-medium text-brand-600 hover:underline">
            Alterar o modo de entrega
          </Link>
        </p>
      </Card>

      <Card
        title={`Entregadores da frota (${data.drivers.length})`}
        actions={
          <Button size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviting(true)}>
            Convidar entregador
          </Button>
        }
      >
        {data.drivers.length === 0 ? (
          <EmptyState title="Nenhum entregador na frota" description="Convide entregadores já cadastrados no app pelo e-mail ou celular deles." />
        ) : (
          <DataTable
            rows={data.drivers}
            rowKey={(row) => row.driverId}
            columns={[
              {
                key: 'name',
                header: 'Entregador',
                cell: (row) => (
                  <span>
                    <span className="font-medium">{row.name}</span>
                    <span className="block text-xs text-muted">{row.phone ?? '—'}</span>
                  </span>
                ),
              },
              {
                key: 'vehicle',
                header: 'Veículo',
                cell: (row) => (row.vehicle ? `${VEHICLE_TYPE_LABELS[row.vehicle.type]}${row.vehicle.plate ? ` · ${row.vehicle.plate}` : ''}` : '—'),
              },
              {
                key: 'status',
                header: 'Agora',
                cell: (row) => {
                  const state = AVAILABILITY[row.availability] ?? AVAILABILITY.OFFLINE;
                  return row.status === 'APPROVED' ? <Badge tone={state.tone}>{state.label}</Badge> : <Badge tone="warning">Cadastro em análise</Badge>;
                },
              },
              {
                key: 'rating',
                header: 'Avaliação',
                cell: (row) =>
                  row.ratingCount ? (
                    <span className="inline-flex items-center gap-1">
                      <Star className="h-3.5 w-3.5 text-warning" aria-hidden /> {row.ratingAvg.toFixed(1)} ({row.ratingCount})
                    </span>
                  ) : (
                    '—'
                  ),
              },
              { key: 'deliveries', header: 'Entregas (30 dias)', cell: (row) => row.deliveriesLast30Days },
              {
                key: 'actions',
                header: '',
                cell: (row) => (
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(row)}>
                    Remover
                  </Button>
                ),
              },
            ]}
          />
        )}
        <p className="mt-3 text-xs text-muted">Por privacidade, o celular aparece parcialmente. Para falar com o entregador durante uma entrega, use as mensagens do pedido.</p>
      </Card>

      <Card title="Convites (últimos 30 dias)">
        {data.invitations.length === 0 ? (
          <p className="text-sm text-muted">Nenhum convite enviado.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{invitation.driverName}</p>
                  <p className="text-sm text-muted">
                    Enviado em {formatDateTime(invitation.createdAt)}
                    {invitation.status === 'PENDING' ? ` · vale até ${formatDateTime(invitation.expiresAt)}` : invitation.respondedAt ? ` · respondido em ${formatDateTime(invitation.respondedAt)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={INVITE_TONE[invitation.status]}>{FLEET_INVITATION_STATUS_LABELS[invitation.status]}</Badge>
                  {invitation.status === 'PENDING' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={cancel.isPending && cancel.variables === invitation.id}
                      onClick={() =>
                        cancel
                          .mutateAsync(invitation.id)
                          .then(() => toast.success('Convite cancelado.'))
                          .catch(toast.error)
                      }
                    >
                      Cancelar
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog open={inviting} onClose={() => setInviting(false)} title="Convidar para a frota" description="O entregador precisa ter cadastro no app do entregador. Ele recebe o convite no app e decide se aceita.">
        <form onSubmit={submit} className="space-y-4">
          <Input label="E-mail ou celular do entregador" required value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
          <Textarea label="Mensagem (opcional)" maxLength={300} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setInviting(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={invite.isPending}>
              Enviar convite
            </Button>
          </div>
        </form>
      </Dialog>

      {removing && (
        <ConfirmDialog
          open
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api.delete(`${base}/drivers/${removing.driverId}`);
            toast.success(`${removing.name} saiu da frota.`);
            await fleet.refetch();
          }}
          title={`Remover ${removing.name} da frota?`}
          description="O entregador volta para a rede da plataforma e deixa de receber as entregas da sua empresa. Entregas em andamento continuam normalmente."
          confirmLabel="Remover"
          tone="danger"
        />
      )}
    </div>
  );
}
