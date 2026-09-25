'use client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { ApiError } from '@levoja/web-kit/client';
import { ErrorState } from '@levoja/web-kit/ui';
import { useCompany } from '@/lib/company';

/** Erro de recurso fora do plano (403 com `details.feature`). */
export function isPlanError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 403 && !!(error.details as { feature?: string } | undefined)?.feature;
}

/**
 * Erro de carregamento nas telas da empresa: recurso fora do plano vira convite para trocar de
 * plano; os demais erros seguem o padrão (com "tentar novamente").
 */
export function PlanAwareError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { company } = useCompany();
  if (!isPlanError(error)) return <ErrorState error={error} onRetry={onRetry} />;
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface p-8 text-center" role="status">
      <Sparkles className="h-8 w-8 text-brand-500" aria-hidden />
      <p className="max-w-md text-sm text-fg">{error.message}</p>
      <Link href={`/empresa/${company.id}/plano`} className="font-medium text-brand-600 hover:underline">
        Ver planos
      </Link>
    </div>
  );
}
