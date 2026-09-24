'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useApi } from '@levoja/web-kit/client';
import { ErrorState, PageHeader, Skeleton } from '@levoja/web-kit/ui';
import { RiskSubjectData, RiskSubjectView } from '@/components/risk-subject';

export default function RiskAccountPage() {
  const { userId } = useParams<{ userId: string }>();
  const { data, error, isLoading, refetch } = useApi<RiskSubjectData>(`admin/intelligence/fraud/users/${userId}`);
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-96" />;
  return (
    <>
      <PageHeader
        back={
          <Link href="/antifraude" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" /> Antifraude
          </Link>
        }
        title={`Perfil de risco · ${data.user.name}`}
        description="Evidências, aparelhos e contas relacionadas desta conta."
      />
      <RiskSubjectView data={data} onChanged={() => void refetch()} />
    </>
  );
}
