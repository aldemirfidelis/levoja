'use client';

import { Suspense, useState } from 'react';
import { Star } from 'lucide-react';
import { REVIEW_SENTIMENT_LABELS, REVIEW_THEME_LABELS, REVIEW_THEMES, type ReviewSentiment, type ReviewTheme } from '@levoja/shared';
import { api, Paginated, useApi } from '@levoja/web-kit/client';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, formatDateTime, PageHeader, Pagination, Select, SkeletonRows, useToast } from '@levoja/web-kit/ui';
import { SENTIMENT_TONE } from '@/components/intelligence-nav';
import { useUrlFilters } from '@/components/list-filters';

interface Review {
  id: string;
  authorType: string;
  subjectType: 'COMPANY' | 'DRIVER' | 'CUSTOMER';
  subjectId: string;
  rating: number;
  comment: string | null;
  tags: string[];
  isHidden: boolean;
  hiddenReason: string | null;
  sentiment: ReviewSentiment | null;
  themes: ReviewTheme[];
  analysisSource: 'lexicon' | 'ai' | null;
  createdAt: string;
}

const SUBJECT = { COMPANY: 'Loja', DRIVER: 'Entregador', CUSTOMER: 'Cliente' };
const AUTHOR: Record<string, string> = { CUSTOMER: 'cliente', COMPANY: 'loja', DRIVER: 'entregador' };

function ReviewsView() {
  const toast = useToast();
  const [filters, setFilters] = useUrlFilters({ maxRating: '', sentiment: '', theme: '', page: '1' });
  const [hiding, setHiding] = useState<Review | null>(null);
  const { data, error, isLoading, refetch } = useApi<Paginated<Review>>('admin/reviews', { ...filters, pageSize: 20 });

  const show = async (review: Review) => {
    try {
      await api.post(`admin/reviews/${review.id}/show`);
      toast.success('Avaliação restaurada.');
      await refetch();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <PageHeader title="Avaliações" description="Moderação: avaliações ocultadas deixam de contar na média do avaliado." />
      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          className="sm:w-48"
          aria-label="Filtrar por nota"
          value={filters.maxRating}
          placeholder="Todas as notas"
          options={[
            { value: '2', label: 'Até 2 estrelas' },
            { value: '3', label: 'Até 3 estrelas' },
          ]}
          onChange={(e) => setFilters({ maxRating: e.target.value })}
        />
        <Select
          className="sm:w-48"
          aria-label="Filtrar por sentimento"
          value={filters.sentiment}
          placeholder="Qualquer sentimento"
          options={Object.entries(REVIEW_SENTIMENT_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(e) => setFilters({ sentiment: e.target.value })}
        />
        <Select
          className="sm:w-56"
          aria-label="Filtrar por tema"
          value={filters.theme}
          placeholder="Qualquer tema"
          options={REVIEW_THEMES.map((theme) => ({ value: theme, label: REVIEW_THEME_LABELS[theme] }))}
          onChange={(e) => setFilters({ theme: e.target.value })}
        />
      </div>
      {isLoading && <SkeletonRows />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data?.data.length === 0 && <EmptyState icon={<Star className="h-8 w-8" />} title="Nenhuma avaliação" />}
      <div className="space-y-3">
        {data?.data.map((review) => (
          <article key={review.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm">
                <span className="text-warning" aria-label={`${review.rating} estrelas`}>
                  {'★'.repeat(review.rating)}
                  <span className="text-muted">{'★'.repeat(5 - review.rating)}</span>
                </span>
                <Badge>{SUBJECT[review.subjectType]}</Badge>
                <span className="text-muted">por {AUTHOR[review.authorType] ?? review.authorType} · {formatDateTime(review.createdAt)}</span>
                {review.sentiment && (
                  <Badge tone={SENTIMENT_TONE[review.sentiment]}>
                    {REVIEW_SENTIMENT_LABELS[review.sentiment]}
                    {review.analysisSource === 'ai' ? ' (IA)' : ''}
                  </Badge>
                )}
                {review.isHidden && <Badge tone="danger">Oculta</Badge>}
              </p>
              {review.isHidden ? (
                <Button size="sm" variant="secondary" onClick={() => show(review)}>
                  Restaurar
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setHiding(review)}>
                  Ocultar
                </Button>
              )}
            </div>
            {review.comment && <p className="mt-2 text-sm">{review.comment}</p>}
            {review.tags.length > 0 && <p className="mt-1 text-xs text-muted">{review.tags.join(' · ')}</p>}
            {review.themes.length > 0 && (
              <p className="mt-2 flex flex-wrap gap-1">
                {review.themes.map((theme) => (
                  <Badge key={theme}>{REVIEW_THEME_LABELS[theme] ?? theme}</Badge>
                ))}
              </p>
            )}
            {review.hiddenReason && <p className="mt-1 text-xs text-danger">Motivo da ocultação: {review.hiddenReason}</p>}
          </article>
        ))}
      </div>
      {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={(page) => setFilters({ page: String(page) })} />}
      {hiding && (
        <ConfirmDialog
          open
          onClose={() => setHiding(null)}
          onConfirm={async (reason) => {
            await api.post(`admin/reviews/${hiding.id}/hide`, { reason });
            toast.success('Avaliação ocultada.');
            await refetch();
          }}
          title="Ocultar avaliação"
          description="Use para conteúdo ofensivo, discriminatório ou comprovadamente falso."
          confirmLabel="Ocultar"
          tone="danger"
          reason={{ label: 'Motivo', required: true }}
        />
      )}
    </>
  );
}

export default function ReviewsPage() {
  return (
    <Suspense>
      <ReviewsView />
    </Suspense>
  );
}
