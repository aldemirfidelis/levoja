import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Termos para empresas' };

export default function CompanyTermsPage() {
  return <LegalPage type="COMPANY_TERMS" />;
}
