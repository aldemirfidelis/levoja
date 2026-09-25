import { redirect } from 'next/navigation';

/** As integrações (chaves de API, webhooks e uso) ficam na aba própria da empresa. */
export default async function LegacyIntegrationPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  redirect(`/empresa/${companyId}/integracoes`);
}
