'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Palette } from 'lucide-react';
import { brandPalette, isHexColor } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { Button, Card, EmptyState, ErrorState, Input, PageHeader, Skeleton, useToast } from '@levoja/web-kit/ui';
import { useCompany } from '@/lib/company';

interface BrandView {
  available: boolean;
  brandColor: string | null;
  customDomain: string | null;
  logoUrl: string | null;
  pageUrl: string;
}

export default function CompanyBrandPage() {
  const { company, can } = useCompany();
  const toast = useToast();
  const { data, error, isLoading, refetch } = useApi<BrandView>(`companies/${company.id}/brand`);
  const [color, setColor] = useState('#FF5A1F');
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) {
      setColor(data.brandColor ?? '#FF5A1F');
      setDomain(data.customDomain ?? '');
    }
  }, [data]);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-80" />;

  if (!data.available) {
    return (
      <>
        <PageHeader title="Marca própria" description="Página da sua loja com as suas cores e o seu domínio (ex.: pedidos.sualoja.com.br)." />
        <EmptyState
          icon={<Palette className="h-8 w-8" />}
          title="Recurso do plano Enterprise"
          description="Contrate um plano com marca própria para publicar a página da loja com a sua identidade."
          action={
            <Link href={`/empresa/${company.id}/plano`} className="font-medium text-brand-600 hover:underline">
              Ver planos
            </Link>
          }
        />
      </>
    );
  }

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.put(`companies/${company.id}/brand`, { brandColor: color, customDomain: domain.trim() || null });
      toast.success('Marca salva.');
      await refetch();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const palette = isHexColor(color) ? brandPalette(color) : null;
  return (
    <>
      <PageHeader title="Marca própria" description="Página da sua loja com as suas cores e o seu domínio. Os clientes pedem pelo app com os mesmos preços e cardápio." />
      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={save}>
          <Card title="Identidade da página">
            <div className="space-y-4">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-fg">Cor da marca</span>
                <span className="flex items-center gap-2">
                  <input type="color" aria-label="Cor da marca" value={palette ? color : '#FF5A1F'} onChange={(event) => setColor(event.target.value.toUpperCase())} className="h-10 w-14 rounded border border-border bg-surface" />
                  <Input aria-label="Cor em hexadecimal" value={color} onChange={(event) => setColor(event.target.value)} />
                </span>
              </label>
              <Input
                label="Domínio próprio (opcional)"
                value={domain}
                onChange={(event) => setDomain(event.target.value.toLowerCase())}
                placeholder="pedidos.sualoja.com.br"
                hint="Crie um registro CNAME desse endereço apontando para o portal da plataforma. Sem domínio, a página fica no endereço da plataforma."
              />
              <p className="text-sm text-muted">O logotipo é o mesmo cadastrado em Dados da empresa.</p>
              <div className="flex justify-end">
                <Button type="submit" loading={busy} disabled={!can('company.profile.manage') || !palette}>
                  Salvar
                </Button>
              </div>
            </div>
          </Card>
        </form>
        <Card title="Prévia">
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center gap-3 p-4 text-white" style={{ background: palette?.[500] ?? '#FF5A1F' }}>
              {data.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.logoUrl} alt="" className="h-10 w-10 rounded-full bg-white object-cover" />
              )}
              <span className="text-lg font-bold">{company.tradeName}</span>
            </div>
            <div className="p-4 text-sm text-muted">Cardápio, horários e botão para pedir pelo app.</div>
          </div>
          <a href={data.pageUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
            Abrir página da loja <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        </Card>
      </div>
    </>
  );
}
