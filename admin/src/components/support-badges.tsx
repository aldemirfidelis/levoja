'use client';

import { AlertOctagon, CheckCircle2, Clock, TimerReset } from 'lucide-react';
import { SLA_STATE_LABELS, TICKET_PRIORITY_LABELS, TICKET_STATUS_STAFF_LABELS } from '@levoja/shared';
import { Badge, Tone, formatDateTime } from '@levoja/web-kit/ui';
import type { SlaState, TicketPriority, TicketStatus } from '@/lib/types';

const PRIORITY_TONE: Record<TicketPriority, Tone> = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', URGENT: 'danger' };
const STATUS_TONE: Record<TicketStatus, Tone> = { OPEN: 'brand', IN_PROGRESS: 'info', WAITING_REQUESTER: 'warning', RESOLVED: 'success', CLOSED: 'neutral' };

export const PriorityBadge = ({ priority }: { priority: TicketPriority }) => <Badge tone={PRIORITY_TONE[priority]}>{TICKET_PRIORITY_LABELS[priority]}</Badge>;
export const TicketStatusBadge = ({ status }: { status: TicketStatus }) => <Badge tone={STATUS_TONE[status]}>{TICKET_STATUS_STAFF_LABELS[status]}</Badge>;

/** Situação do SLA sempre com ícone + texto (nunca só a cor). */
export function SlaIndicator({ state, dueAt }: { state: SlaState; dueAt?: string }) {
  const config = {
    ok: { icon: Clock, className: 'text-muted' },
    risk: { icon: TimerReset, className: 'text-warning' },
    breached: { icon: AlertOctagon, className: 'text-danger' },
    done: { icon: CheckCircle2, className: 'text-success' },
  }[state];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${config.className}`}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        {SLA_STATE_LABELS[state]}
        {dueAt && state !== 'done' && <span className="block text-xs text-muted">até {formatDateTime(dueAt)}</span>}
      </span>
    </span>
  );
}
