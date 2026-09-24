'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { BatchStatus } from '@levoja/shared';
import { cn, type Tone } from '@levoja/web-kit/ui';
import { useCompany } from '@/lib/company';

export interface B2bOverview {
  contract: {
    id: string;
    number: number;
    title: string;
    status: string;
    startsOn: string;
    endsOn: string | null;
    billingDay: number;
    paymentTermDays: number;
    creditLimitCents: number;
    minimumMonthlyCents: number;
    discountBps: number;
    requireCostCenter: boolean;
    notifyRecipients: boolean;
    priceRules: { name: string; vehicleType: string | null; city: string | null; baseCents: number; perKmCents: number; includedKm: number; minimumCents: number }[];
  } | null;
  contractStatus: string | null;
  exposureCents: number;
  availableCreditCents: number;
  openInvoices: number;
  overdueInvoices: number;
  canInvoice: boolean;
}

export interface CostCenter {
  id: string;
  code: string;
  name: string;
  monthlyBudgetCents: number | null;
  isActive: boolean;
  spentThisMonthCents: number;
  availableThisMonthCents: number | null;
}

export interface CompanyLocation {
  id: string;
  name: string;
  isUnit: boolean;
  contactName: string | null;
  contactPhone: string | null;
  zipCode: string | null;
  street: string;
  number: string;
  complement: string | null;
  district: string | null;
  city: string;
  state: string;
  reference: string | null;
  lat: number;
  lng: number;
  isActive: boolean;
}

const ITEMS = [
  { path: '', label: 'Visão geral', permissions: ['company.deliveries.request', 'company.finance.read'] },
  { path: '/lotes', label: 'Lotes', permissions: ['company.deliveries.request'] },
  { path: '/recorrentes', label: 'Recorrentes', permissions: ['company.deliveries.request'] },
  { path: '/unidades', label: 'Unidades', permissions: ['company.deliveries.request'] },
  { path: '/centros-de-custo', label: 'Centros de custo', permissions: ['company.deliveries.request'] },
  { path: '/faturas', label: 'Faturas', permissions: ['company.finance.read'] },
  { path: '/relatorio', label: 'Relatório', permissions: ['company.reports.read'] },
  { path: '/integracao', label: 'Integração (API)', permissions: ['company.b2b.manage'] },
];

/** Navegação da área corporativa (respeita as permissões do membro). */
export function B2bNav() {
  const pathname = usePathname();
  const { company, can } = useCompany();
  const base = `/empresa/${company.id}/corporativo`;
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1" aria-label="Corporativo">
      {ITEMS.filter((item) => item.permissions.some(can)).map((item) => {
        const href = `${base}${item.path}`;
        const active = item.path === '' ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={item.path}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn('whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium', active ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export interface BatchView {
  id: string;
  number: number;
  name: string | null;
  source: 'CSV' | 'XLSX' | 'API';
  fileName: string | null;
  status: BatchStatus;
  scheduledFor: string | null;
  paymentMethod: string;
  itemsCount: number;
  validCount: number;
  invalidCount: number;
  totalFeeCents: number;
  routesCount: number;
  createdAt: string;
  completedAt: string | null;
  canceledAt: string | null;
  progress: { finished: number; delivered: number; total: number } | null;
}

export const BATCH_TONE: Record<BatchStatus, Tone> = { VALIDATING: 'info', READY: 'warning', CONFIRMED: 'brand', CANCELED: 'neutral', FAILED: 'danger' };
