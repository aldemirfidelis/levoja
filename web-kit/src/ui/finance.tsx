'use client';

import { useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import { Check, Copy } from 'lucide-react';
import { formatBRL, LEDGER_ENTRY_LABELS, LedgerEntryType, WITHDRAWAL_STATUS_LABELS, WithdrawalStatus } from '@levoja/shared';
import { useApi } from '../client/hooks';
import type { Paginated } from '../client/api';
import { Button, cn } from './primitives';
import { EmptyState, ErrorState, SkeletonRows } from './feedback';
import { Badge, DataTable, formatDateTime, Pagination, Tone } from './data';

export interface StatementEntry {
  id: string;
  type: LedgerEntryType;
  label: string;
  amountCents: number;
  status: 'PENDING' | 'AVAILABLE' | 'CANCELED';
  availableAt: string | null;
  description: string;
  createdAt: string;
}

/** Valor com sinal e cor (crédito verde, débito vermelho). */
export function SignedAmount({ cents, className }: { cents: number; className?: string }) {
  return <span className={cn('tabular-nums font-medium', cents < 0 ? 'text-danger' : 'text-success', className)}>{`${cents > 0 ? '+' : ''}${formatBRL(cents)}`}</span>;
}

/** Extrato paginado de uma carteira (lançamentos do razão). */
export function WalletStatement({ path, emptyText = 'Nenhuma movimentação ainda.' }: { path: string; emptyText?: string }) {
  const [page, setPage] = useState(1);
  const { data, error, isLoading, refetch } = useApi<Paginated<StatementEntry>>(path, { page, pageSize: 20 });
  if (isLoading) return <SkeletonRows />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data?.data.length) return <EmptyState title={emptyText} />;
  return (
    <>
      <DataTable
        rows={data.data}
        rowKey={(row) => row.id}
        columns={[
          { key: 'date', header: 'Data', cell: (row) => formatDateTime(row.createdAt) },
          {
            key: 'description',
            header: 'Descrição',
            cell: (row) => (
              <span>
                {row.description}
                <span className="block text-xs text-muted">{LEDGER_ENTRY_LABELS[row.type] ?? row.label}</span>
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Situação',
            hideOnMobile: true,
            cell: (row) => (row.status === 'PENDING' ? <Badge tone="warning">{`Libera em ${formatDateTime(row.availableAt)}`}</Badge> : <Badge tone="success">Disponível</Badge>),
          },
          { key: 'amount', header: 'Valor', className: 'text-right', cell: (row) => <SignedAmount cents={row.amountCents} /> },
        ]}
      />
      <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={setPage} />
    </>
  );
}

export interface WithdrawalView {
  id: string;
  amountCents: number;
  feeCents: number;
  status: WithdrawalStatus;
  destination: string;
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
}

export const WITHDRAWAL_TONE: Record<WithdrawalStatus, Tone> = {
  REQUESTED: 'warning',
  PROCESSING: 'info',
  PAID: 'success',
  REJECTED: 'danger',
  FAILED: 'danger',
  CANCELED: 'neutral',
};

/** Histórico de saques com cancelamento enquanto aguardam análise. */
export function WithdrawalHistory({ path, onCancel }: { path: string; onCancel?: (withdrawal: WithdrawalView) => void }) {
  const [page, setPage] = useState(1);
  const { data, error, isLoading, refetch } = useApi<Paginated<WithdrawalView>>(path, { page, pageSize: 10 });
  if (isLoading) return <SkeletonRows rows={3} />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data?.data.length) return <p className="text-sm text-muted">Nenhum saque solicitado.</p>;
  return (
    <>
      <DataTable
        rows={data.data}
        rowKey={(row) => row.id}
        columns={[
          { key: 'date', header: 'Solicitado', cell: (row) => formatDateTime(row.createdAt) },
          { key: 'destination', header: 'Destino', hideOnMobile: true, cell: (row) => row.destination },
          {
            key: 'status',
            header: 'Status',
            cell: (row) => (
              <span>
                <Badge tone={WITHDRAWAL_TONE[row.status]}>{WITHDRAWAL_STATUS_LABELS[row.status]}</Badge>
                {row.failureReason && row.status !== 'CANCELED' && <span className="mt-1 block text-xs text-muted">{row.failureReason}</span>}
              </span>
            ),
          },
          { key: 'amount', header: 'Valor', className: 'text-right', cell: (row) => formatBRL(row.amountCents) },
          {
            key: 'actions',
            header: '',
            className: 'text-right',
            cell: (row) =>
              onCancel && row.status === 'REQUESTED' ? (
                <Button size="sm" variant="ghost" onClick={() => onCancel(row)}>
                  Cancelar
                </Button>
              ) : null,
          },
        ]}
      />
      <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={setPage} />
    </>
  );
}

function useCountdown(until: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  if (!until) return null;
  const seconds = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  return { seconds, label: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` };
}

/** Cobrança PIX: QR Code, "copia e cola" e contagem regressiva até expirar. */
export function PixCharge({ copyPaste, expiresAt, amountCents }: { copyPaste: string; expiresAt: string | null; amountCents: number }) {
  const [copied, setCopied] = useState(false);
  const countdown = useCountdown(expiresAt);
  const expired = countdown?.seconds === 0;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyPaste);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="text-2xl font-bold tabular-nums">{formatBRL(amountCents)}</p>
      <div className={cn('rounded-lg bg-white p-3', expired && 'opacity-30')}>
        <QRCode value={copyPaste} size={184} aria-label="QR Code PIX" />
      </div>
      {countdown && (
        <p className={cn('text-sm', expired ? 'text-danger' : 'text-muted')} aria-live="polite">
          {expired ? 'Este PIX expirou.' : `Expira em ${countdown.label}`}
        </p>
      )}
      <div className="w-full">
        <label className="mb-1 block text-left text-xs font-medium text-muted" htmlFor="pix-copy-paste">
          PIX copia e cola
        </label>
        <div className="flex gap-2">
          <input id="pix-copy-paste" readOnly value={copyPaste} className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 text-xs text-fg" onFocus={(e) => e.target.select()} />
          <Button type="button" variant="secondary" onClick={copy} icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} disabled={expired}>
            {copied ? 'Copiado' : 'Copiar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
