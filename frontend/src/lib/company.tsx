'use client';

import { createContext, useContext } from 'react';
import type { PartnerAction, PartnerStatus } from '@levoja/shared';
import type { AddressValue } from '@levoja/web-kit/ui';
import type { BankAccountView, PartnerDoc, Requirement } from '@/components/partner-forms';

export interface CompanyView {
  id: string;
  legalName: string;
  tradeName: string;
  slug: string;
  cnpj: string;
  responsibleName: string;
  responsibleCpfMasked: string;
  email: string;
  phone: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  segment: { id: string; slug: string; name: string; isRegulated: boolean; requiredDocuments: string[] };
  address: (AddressValue & { id: string }) | null;
  openingHours: { weekday: number; opensAt: string; closesAt: string }[];
  status: PartnerStatus;
  statusReason: string | null;
  isOpen: boolean;
  isOpenNow: boolean;
  timezone: string;
  averagePrepMinutes: number;
  minimumOrderCents: number;
  fulfillmentMode: 'PLATFORM' | 'OWN_FLEET' | 'HYBRID';
  documents: PartnerDoc[];
  bankAccount: BankAccountView | null;
  requirements: Requirement[];
  ownerActions: PartnerAction[];
}

export const CompanyContext = createContext<{ company: CompanyView; reload: () => void; can: (permission: string) => boolean } | null>(null);

export function useCompany() {
  const value = useContext(CompanyContext);
  if (!value) throw new Error('useCompany fora do layout da empresa');
  return value;
}

/** Campos jurídicos só são editáveis antes do envio para análise (regra da API). */
export const legalEditable = (status: PartnerStatus) => ['DRAFT', 'PENDING_DOCUMENTS', 'REJECTED'].includes(status);
