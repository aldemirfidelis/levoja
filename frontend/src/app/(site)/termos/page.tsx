import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Termos de uso' };

export default function TermsPage() {
  return <LegalPage type="TERMS_OF_USE" />;
}
