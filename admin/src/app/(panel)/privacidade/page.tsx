'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
import { api, useApi } from '@levoja/web-kit/client';
import { Badge, Button, ConfirmDialog, DataTable, EmptyState, ErrorState, formatDateTime, PageHeader, Select, SkeletonRows, useToast } from '@levoja/web-kit/ui';

interface PrivacyRequest {
  id: string;
  type: 'EXPORT' | 'DELETION' | 'CORRECTION';
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED';
  reason: string | null;
  response: string | null;
  createdAt: string;
  completedAt: string | null;
  user: { id: string; name: string; email: string; anonymizedAt: string | null };
}

const TYPE_LABELS = { EXPORT: 'Exportação', DELETION: 'Exclusão', CORRECTION: 'Correção' };
const STATUS = {
  OPEN: { label: 'Aberta', tone: 'warning' as const },
  IN_PROGRESS: { label: 'Em andamento', tone: 'info' as const },
  COMPLETED: { label: 'Concluída', tone: 'success' as const },
  REJECTED: { label: 'Recusada', tone: 'danger' as const },
};

export default function PrivacyPage() {
  const toast = useToast();
  const [status, setStatus] = useState('OPEN');
  const { data, error, isLoading, refetch } = useApi<PrivacyRequest[]>('admin/privacy-requests', { status });
  const [resolving, setResolving] = useState<{ request: PrivacyRequest; approve: boolean } | null>(null);

  const resolve = async (response: string) => {
    if (!resolving) return;
    await api.post(`admin/privacy-requests/${resolving.request.id}/resolve`, { approve: resolving.approve, response });
    toast.success(resolving.approve ? 'Solicitação concluída.' : 'Solicitação recusada.');
    await refetch();
  };

  return (
    <>
      <PageHeader
        title="Privacidade (LGPD)"
        description="Solicitações dos titulares. A exclusão é feita por anonimização; registros com obrigação legal de guarda são preservados. Prazo recomendado: 15 dias."
      />
      <Select
        className="mb-4 sm:w-56"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        placeholder="Todas"
        options={Object.entries(STATUS).map(([value, item]) => ({ value, label: item.label }))}
        aria-label="Status"
      />
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && data.length === 0 && <EmptyState icon={<Lock className="h-8 w-8" />} title="Nenhuma solicitação" />}
      {data && data.length > 0 && (
        <DataTable
          rows={data}
          rowKey={(row) => row.id}
          columns={[
            {
              key: 'user',
              header: 'Titular',
              cell: (row) => (
                <div>
                  <p className="font-medium">{row.user.name}</p>
                  <p className="text-xs text-muted">{row.user.email}</p>
                </div>
              ),
            },
            { key: 'type', header: 'Tipo', cell: (row) => TYPE_LABELS[row.type] },
            { key: 'reason', header: 'Motivo', hideOnMobile: true, cell: (row) => row.reason ?? '—' },
            { key: 'created', header: 'Aberta em', hideOnMobile: true, cell: (row) => formatDateTime(row.createdAt) },
            { key: 'status', header: 'Status', cell: (row) => <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge> },
            {
              key: 'actions',
              header: '',
              cell: (row) =>
                (row.status === 'OPEN' || row.status === 'IN_PROGRESS') && (
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant={row.type === 'DELETION' ? 'danger' : 'success'} onClick={() => setResolving({ request: row, approve: true })}>
                      {row.type === 'DELETION' ? 'Anonimizar' : 'Concluir'}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setResolving({ request: row, approve: false })}>
                      Recusar
                    </Button>
                  </div>
                ),
            },
          ]}
        />
      )}
      {resolving && (
        <ConfirmDialog
          open
          onClose={() => setResolving(null)}
          onConfirm={resolve}
          title={resolving.approve ? (resolving.request.type === 'DELETION' ? 'Anonimizar conta' : 'Concluir solicitação') : 'Recusar solicitação'}
          description={
            resolving.approve && resolving.request.type === 'DELETION'
              ? `Os dados pessoais de ${resolving.request.user.name} serão removidos de forma irreversível e todas as sessões encerradas.`
              : undefined
          }
          confirmLabel={resolving.approve ? 'Confirmar' : 'Recusar'}
          tone={resolving.approve && resolving.request.type === 'DELETION' ? 'danger' : 'primary'}
          reason={{ label: 'Resposta ao titular (registrada)', required: true }}
        />
      )}
    </>
  );
}
