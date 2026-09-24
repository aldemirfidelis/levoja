'use client';

import { useRouter } from 'next/navigation';
import { api } from '@levoja/web-kit/client';
import { Card, PageHeader } from '@levoja/web-kit/ui';
import { CompanyForm } from '@/components/company-form';
import { usePortal } from '@/lib/portal-session';

export default function NewCompanyPage() {
  const router = useRouter();
  const { refresh } = usePortal();
  return (
    <>
      <PageHeader title="Cadastrar nova empresa" description="Você será o proprietário e poderá convidar sua equipe depois." />
      <Card>
        <CompanyForm
          submitLabel="Cadastrar empresa"
          onSubmit={async (value) => {
            const company = await api.post<{ id: string }>('companies', value);
            refresh();
            router.replace(`/empresa/${company.id}`);
          }}
        />
      </Card>
    </>
  );
}
