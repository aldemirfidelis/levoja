'use client';

import { COMPANY_DOCUMENT_LABELS, COMPANY_DOCUMENT_TYPES } from '@levoja/shared';
import { DocumentsManager } from '@/components/partner-forms';
import { useCompany } from '@/lib/company';

const BASE_REQUIRED = ['CNPJ_CARD', 'RESPONSIBLE_ID', 'ADDRESS_PROOF'];

export default function CompanyDocumentsPage() {
  const { company, reload } = useCompany();
  const required = [...new Set([...BASE_REQUIRED, ...company.segment.requiredDocuments])];
  return (
    <DocumentsManager
      basePath={`companies/${company.id}`}
      documents={company.documents}
      required={required}
      types={COMPANY_DOCUMENT_TYPES.map((type) => ({ value: type, label: COMPANY_DOCUMENT_LABELS[type] }))}
      locked={company.status === 'UNDER_REVIEW' ? 'Cadastro em análise: aguarde o resultado para enviar novos documentos.' : company.status === 'BLOCKED' ? 'Empresa bloqueada.' : undefined}
      onChange={reload}
    />
  );
}
