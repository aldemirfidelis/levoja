import { notFound } from 'next/navigation';
import { publicApi } from '@/lib/bff';
import { Markdown } from './markdown';

interface LegalDocument {
  title: string;
  version: string;
  content: string;
  publishedAt: string;
}

/** Documento legal vigente, sempre servido pela API (fonte única, versionada). */
export async function LegalPage({ type }: { type: string }) {
  const doc = await publicApi<LegalDocument>(`legal/${type}`, 600);
  if (!doc) notFound();
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <p className="mb-6 text-sm text-muted">
        Versão {doc.version} · publicada em {new Date(doc.publishedAt).toLocaleDateString('pt-BR')}
      </p>
      <Markdown content={doc.content} />
    </article>
  );
}
