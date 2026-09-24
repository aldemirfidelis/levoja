'use client';

import { useState } from 'react';
import { CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import { PARTNER_ACTION_LABELS, PARTNER_STATUS_LABELS, PARTNER_TRANSITIONS, PartnerAction } from '@levoja/shared';
import { api } from '@levoja/web-kit/client';
import { Badge, Button, Card, ConfirmDialog, DocumentStatusBadge, formatDateTime, useToast } from '@levoja/web-kit/ui';
import type { HistoryEntry, PartnerDocument, Requirement } from '@/lib/types';

const ACTION_TONE: Partial<Record<PartnerAction, 'primary' | 'danger' | 'success'>> = {
  APPROVE: 'success',
  REJECT: 'danger',
  BLOCK: 'danger',
  SUSPEND: 'danger',
};

/** Botões de ação administrativa (aprovar, reprovar, solicitar correção, suspender, bloquear, reativar). */
export function PartnerActions({
  actions,
  basePath,
  onDone,
  subject,
}: {
  actions: PartnerAction[];
  basePath: string;
  onDone: () => void;
  subject: string;
}) {
  const toast = useToast();
  const [pending, setPending] = useState<PartnerAction | null>(null);
  if (!actions.length) return null;

  const run = async (action: PartnerAction, reason: string) => {
    await api.post(`${basePath}/actions`, { action, reason: reason || undefined });
    toast.success(`${PARTNER_ACTION_LABELS[action]}: concluído.`);
    onDone();
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action}
            size="sm"
            variant={ACTION_TONE[action] ?? 'secondary'}
            onClick={() => setPending(action)}
          >
            {PARTNER_ACTION_LABELS[action]}
          </Button>
        ))}
      </div>
      {pending && (
        <ConfirmDialog
          open
          onClose={() => setPending(null)}
          onConfirm={(reason) => run(pending, reason)}
          title={`${PARTNER_ACTION_LABELS[pending]} — ${subject}`}
          description={`O cadastro passará para "${PARTNER_STATUS_LABELS[PARTNER_TRANSITIONS[pending].to]}". O titular será notificado.`}
          confirmLabel={PARTNER_ACTION_LABELS[pending]}
          tone={ACTION_TONE[pending] ?? 'primary'}
          reason={{
            label: PARTNER_TRANSITIONS[pending].requiresReason ? 'Motivo (enviado ao titular)' : 'Observação (opcional)',
            required: PARTNER_TRANSITIONS[pending].requiresReason,
          }}
        />
      )}
    </>
  );
}

/** Lista de documentos com visualização protegida e revisão individual. */
export function DocumentsReview({
  documents,
  basePath,
  canReview,
  onChange,
}: {
  documents: PartnerDocument[];
  basePath: string;
  canReview: boolean;
  onChange: () => void;
}) {
  const toast = useToast();
  const [rejecting, setRejecting] = useState<PartnerDocument | null>(null);
  const [busy, setBusy] = useState<string>();

  const review = async (document: PartnerDocument, status: 'APPROVED' | 'REJECTED', note?: string) => {
    setBusy(document.id);
    try {
      await api.post(`${basePath}/documents/${document.id}/review`, { status, note });
      toast.success(status === 'APPROVED' ? 'Documento aprovado.' : 'Documento reprovado.');
      onChange();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(undefined);
    }
  };

  if (!documents.length) return <p className="text-sm text-muted">Nenhum documento enviado.</p>;

  return (
    <>
      <ul className="divide-y divide-border">
        {documents.map((document) => (
          <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">{document.label}</p>
              <p className="truncate text-xs text-muted">
                {document.fileName} · enviado em {formatDateTime(document.createdAt)}
              </p>
              {document.reviewNote && <p className="mt-1 text-xs text-danger">Motivo: {document.reviewNote}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DocumentStatusBadge status={document.status} />
              <a
                href={api.fileUrl(`${basePath}/documents/${document.id}/file`)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-brand-600 hover:bg-surface-2"
              >
                Abrir <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
              {canReview && document.status === 'PENDING' && (
                <>
                  <Button size="sm" variant="success" loading={busy === document.id} onClick={() => review(document, 'APPROVED')}>
                    Aprovar
                  </Button>
                  <Button size="sm" variant="secondary" disabled={busy === document.id} onClick={() => setRejecting(document)}>
                    Reprovar
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {rejecting && (
        <ConfirmDialog
          open
          onClose={() => setRejecting(null)}
          onConfirm={(note) => review(rejecting, 'REJECTED', note)}
          title={`Reprovar: ${rejecting.label}`}
          confirmLabel="Reprovar documento"
          tone="danger"
          reason={{ label: 'Motivo (o titular verá esta mensagem)', required: true, placeholder: 'Ex.: imagem ilegível, documento vencido...' }}
        />
      )}
    </>
  );
}

export function RequirementsList({ items }: { items: Requirement[] }) {
  const done = items.filter((item) => item.done).length;
  return (
    <Card title={`Checklist do cadastro (${done}/${items.length})`}>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-2 text-sm">
            {item.done ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Concluído" />
            ) : (
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-label="Pendente" />
            )}
            <span>
              <span className={item.done ? 'text-fg' : 'text-muted'}>{item.label}</span>
              {item.detail && <span className="block text-xs text-danger">{item.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function StatusHistory({ entries }: { entries: HistoryEntry[] }) {
  return (
    <Card title="Histórico de status">
      <ol className="relative space-y-4 border-l border-border pl-5">
        {entries.map((entry) => (
          <li key={entry.id}>
            <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-surface bg-brand-500" aria-hidden />
            <p className="text-sm font-medium text-fg">
              {entry.action === 'CREATE' ? 'Cadastro iniciado' : PARTNER_ACTION_LABELS[entry.action as PartnerAction] ?? entry.action}{' '}
              <Badge tone="neutral">{PARTNER_STATUS_LABELS[entry.toStatus]}</Badge>
            </p>
            <p className="text-xs text-muted">
              {formatDateTime(entry.createdAt)}
              {entry.changedByName && ` · ${entry.changedByName}`}
            </p>
            {entry.reason && <p className="mt-1 text-sm text-fg">“{entry.reason}”</p>}
          </li>
        ))}
      </ol>
    </Card>
  );
}
