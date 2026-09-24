'use client';

import { ReactNode } from 'react';
import {
  DOCUMENT_STATUS_LABELS,
  DocumentStatus,
  PARTNER_STATUS_LABELS,
  PartnerStatus,
  USER_STATUS_LABELS,
  UserStatus,
} from '@levoja/shared';
import { Button, cn } from './primitives';

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted',
  brand: 'bg-brand-500/10 text-brand-600',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  info: 'bg-info/10 text-info',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', TONES[tone], className)}>
      {children}
    </span>
  );
}

const PARTNER_TONES: Record<PartnerStatus, Tone> = {
  DRAFT: 'neutral',
  PENDING_DOCUMENTS: 'warning',
  UNDER_REVIEW: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
  SUSPENDED: 'warning',
  BLOCKED: 'danger',
};

export const PartnerStatusBadge = ({ status }: { status: PartnerStatus }) => (
  <Badge tone={PARTNER_TONES[status]}>{PARTNER_STATUS_LABELS[status]}</Badge>
);

const DOCUMENT_TONES: Record<DocumentStatus, Tone> = { PENDING: 'info', APPROVED: 'success', REJECTED: 'danger' };
export const DocumentStatusBadge = ({ status }: { status: DocumentStatus }) => (
  <Badge tone={DOCUMENT_TONES[status]}>{DOCUMENT_STATUS_LABELS[status]}</Badge>
);

const USER_TONES: Record<UserStatus, Tone> = { ACTIVE: 'success', SUSPENDED: 'warning', BLOCKED: 'danger', DEACTIVATED: 'neutral' };
export const UserStatusBadge = ({ status }: { status: UserStatus }) => <Badge tone={USER_TONES[status]}>{USER_STATUS_LABELS[status]}</Badge>;

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Oculta a coluna em telas pequenas. */
  hideOnMobile?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-full text-left text-sm">
        <thead className="border-b border-border bg-surface-2 text-xs uppercase tracking-wide text-muted">
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cn('px-4 py-3 font-medium', column.hideOnMobile && 'hidden md:table-cell', column.className)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (event) => event.key === 'Enter' && onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cn(onRowClick && 'cursor-pointer hover:bg-surface-2 focus:bg-surface-2 focus:outline-none')}
            >
              {columns.map((column) => (
                <td key={column.key} className={cn('px-4 py-3 align-middle', column.hideOnMobile && 'hidden md:table-cell', column.className)}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (total === 0) return null;
  return (
    <nav className="mt-4 flex items-center justify-between gap-3 text-sm text-muted" aria-label="Paginação">
      <span>
        {total} {total === 1 ? 'registro' : 'registros'}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Anterior
        </Button>
        <span>
          {page} / {totalPages}
        </span>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          Próxima
        </Button>
      </div>
    </nav>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (value: T) => void;
  items: { value: T; label: ReactNode }[];
}) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {items.map((item) => (
        <button
          key={item.value}
          role="tab"
          aria-selected={item.value === value}
          onClick={() => onChange(item.value)}
          className={cn(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            item.value === value ? 'border-brand-500 text-brand-600' : 'border-transparent text-muted hover:text-fg',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{item.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-fg">{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatCard({ label, value, hint, tone = 'neutral' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums', tone === 'neutral' ? 'text-fg' : TONES[tone].split(' ')[1])}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' });

export const formatDateTime = (value?: string | Date | null) => (value ? dateTime.format(new Date(value)) : '—');
export const formatDate = (value?: string | Date | null) => (value ? dateOnly.format(new Date(value)) : '—');

export function formatPhone(value?: string | null): string {
  if (!value) return '—';
  const digits = value.replace(/\D/g, '').replace(/^55/, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return value;
}
