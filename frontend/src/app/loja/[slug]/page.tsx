import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchTenantBranding } from '@levoja/web-kit/brand';
import { publicApi } from '@/lib/bff';
import { PublicStore, StorePage } from '@/components/store-page';

const APP_SCHEME = process.env.NEXT_PUBLIC_APP_SCHEME ?? 'levoja';
const brand = () => fetchTenantBranding(process.env.API_URL ?? 'http://localhost:3333', process.env.TENANT_SLUG ?? 'levoja');

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const store = await publicApi<PublicStore>(`stores/${encodeURIComponent(slug)}`, 120);
  return { title: store ? store.tradeName : 'Loja', description: store?.description ?? undefined };
}

/** Página pública da loja no endereço da plataforma (/loja/<slug>). */
export default async function StoreBySlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [store, branding] = await Promise.all([publicApi<PublicStore>(`stores/${encodeURIComponent(slug)}`, 120), brand()]);
  if (!store) notFound();
  return <StorePage store={store} appName={branding.appName} appScheme={APP_SCHEME} />;
}
