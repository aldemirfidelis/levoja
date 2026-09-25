import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchTenantBranding } from '@levoja/web-kit/brand';
import { PublicStore, StorePage } from '@/components/store-page';

const API_URL = (process.env.API_URL ?? 'http://localhost:3333').replace(/\/+$/, '');
const APP_SCHEME = process.env.NEXT_PUBLIC_APP_SCHEME ?? 'levoja';

interface Resolved {
  tenant: { slug: string; appName: string };
  store: { slug: string; tradeName: string };
}

async function load(host: string): Promise<{ store: PublicStore; tenant: Resolved['tenant'] } | null> {
  try {
    const resolved = await fetch(`${API_URL}/v1/brands/resolve?host=${encodeURIComponent(host)}`, { next: { revalidate: 300 } });
    if (!resolved.ok) return null;
    const brand = (await resolved.json()) as Resolved;
    const store = await fetch(`${API_URL}/v1/stores/${encodeURIComponent(brand.store.slug)}`, { headers: { 'X-Tenant': brand.tenant.slug }, next: { revalidate: 120 } });
    return store.ok ? { store: (await store.json()) as PublicStore, tenant: brand.tenant } : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }): Promise<Metadata> {
  const { host } = await params;
  const data = await load(decodeURIComponent(host));
  return { title: { absolute: data?.store.tradeName ?? 'Loja' }, description: data?.store.description ?? undefined };
}

/**
 * Domínio próprio da empresa (marca própria): o proxy reescreve a raiz do domínio para cá e a
 * loja é resolvida pela API (somente com o recurso de marca própria ativo no plano).
 */
export default async function CustomDomainStorePage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params;
  const data = await load(decodeURIComponent(host));
  if (!data) notFound();
  const branding = await fetchTenantBranding(API_URL, data.tenant.slug);
  return <StorePage store={data.store} appName={branding.appName} appScheme={APP_SCHEME} />;
}
