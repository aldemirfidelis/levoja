'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import { api, Paginated, useApi } from '@levoja/web-kit/client';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, formatDateTime, PageHeader, Pagination, Select, SkeletonRows, useToast } from '@levoja/web-kit/ui';

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
  createdAt: string;
}

const SUBJECT = { COMPANY: 'Loja', DRIVER: 'Entregador', CUSTOMER: 'Cliente' };
const AUTHOR: Record<string, string> = { CUSTOMER: 'cliente', COMPANY: 'loja', DRIVER: 'entregador' };

export default function ReviewsPage() {
  const toast = useToast();
  const [maxRating, setMaxRating] = useState('');
  const [page, setPage] = useState(1);
  const [hiding, setHiding] = useState<Review | null>(null);
  const { data, error, isLoading, refetch } = useApi<Paginated<Review>>('admin/reviews', { maxRating, page, pageSize: 20 });

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
      <Select
        className="mb-4 sm:w-56"
        aria-label="Filtrar por nota"
        value={maxRating}
        placeholder="Todas as notas"
        options={[
          { value: '2', label: 'Até 2 estrelas' },
          { value: '3', label: 'Até 3 estrelas' },
        ]}
        onChange={(e) => {
          setMaxRating(e.target.value);
          setPage(1);
        }}
      />
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
            {review.hiddenReason && <p className="mt-1 text-xs text-danger">Motivo da ocultação: {review.hiddenReason}</p>}
          </article>
        ))}
      </div>
      {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onChange={setPage} />}
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
