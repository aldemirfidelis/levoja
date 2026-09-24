import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Termos do entregador' };

export default function DriverTermsPage() {
  return <LegalPage type="DRIVER_TERMS" />;
}
