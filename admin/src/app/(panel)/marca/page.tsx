'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { ImageUp } from 'lucide-react';
import { brandPalette, isHexColor } from '@levoja/shared';
import { api, useApi } from '@levoja/web-kit/client';
import { Button, Card, ErrorState, Input, PageHeader, Skeleton, useToast } from '@levoja/web-kit/ui';

interface Branding {
  slug: string;
  name: string;
  appName: string;
  logoUrl: string | null;
  primaryColor: string;
  supportEmail: string | null;
  supportPhone: string | null;
  webUrl: string;
  adminUrl: string;
}

export default function BrandingPage() {
  const toast = useToast();
  const { data, error, isLoading, refetch } = useApi<Branding>('admin/branding');
  const [form, setForm] = useState({ appName: '', primaryColor: '#FF5A1F', supportEmail: '', supportPhone: '', webUrl: '', adminUrl: '' });
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (data) {
      setForm({
        appName: data.appName,
        primaryColor: data.primaryColor,
        supportEmail: data.supportEmail ?? '',
        supportPhone: data.supportPhone ?? '',
        webUrl: data.webUrl,
        adminUrl: data.adminUrl,
      });
    }
  }, [data]);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-96" />;
  const palette = isHexColor(form.primaryColor) ? brandPalette(form.primaryColor) : null;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.patch('admin/branding', form);
      toast.success('Marca atualizada. Portais e e-mails passam a usar a nova identidade em alguns minutos.');
      await refetch();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (selected: File | undefined) => {
    if (!selected) return;
    const body = new FormData();
    body.append('file', selected);
    try {
      await api.upload('admin/branding/logo', body, 'PUT');
      toast.success('Logotipo atualizado.');
      await refetch();
    } catch (err) {
      toast.error(err);
    } finally {
      if (file.current) file.current.value = '';
    }
  };

  return (
    <>
      <PageHeader title="Marca" description={`Identidade desta plataforma (tenant ${data.slug}): nome, cores, logotipo e contatos usados nos portais, e-mails e apps.`} />
      <div className="grid gap-6 xl:grid-cols-3">
        <form onSubmit={save} className="xl:col-span-2">
          <Card title="Identidade">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Nome do app/marca" required minLength={2} maxLength={40} value={form.appName} onChange={(event) => setForm({ ...form, appName: event.target.value })} />
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-fg">Cor principal</span>
                <span className="flex items-center gap-2">
                  <input type="color" aria-label="Cor principal" value={palette ? form.primaryColor : '#FF5A1F'} onChange={(event) => setForm({ ...form, primaryColor: event.target.value.toUpperCase() })} className="h-10 w-14 rounded border border-border bg-surface" />
                  <Input aria-label="Cor em hexadecimal" value={form.primaryColor} onChange={(event) => setForm({ ...form, primaryColor: event.target.value })} />
                </span>
              </label>
              <Input label="E-mail de suporte" type="email" value={form.supportEmail} onChange={(event) => setForm({ ...form, supportEmail: event.target.value })} />
              <Input label="Telefone de suporte" value={form.supportPhone} onChange={(event) => setForm({ ...form, supportPhone: event.target.value })} />
              <Input label="Endereço do portal" type="url" value={form.webUrl} onChange={(event) => setForm({ ...form, webUrl: event.target.value })} hint="Usado nos links dos e-mails." />
              <Input label="Endereço do painel" type="url" value={form.adminUrl} onChange={(event) => setForm({ ...form, adminUrl: event.target.value })} />
            </div>
            <div className="mt-4 flex justify-end">
              <Button type="submit" loading={busy}>
                Salvar marca
              </Button>
            </div>
          </Card>
        </form>
        <div className="space-y-6">
          <Card title="Logotipo">
            <div className="flex flex-col items-start gap-3">
              {data.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.logoUrl} alt={data.appName} className="h-12 w-auto" />
              ) : (
                <p className="text-sm text-muted">Sem logotipo: o nome da marca aparece em destaque.</p>
              )}
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => void upload(event.target.files?.[0])} />
              <Button variant="secondary" icon={<ImageUp className="h-4 w-4" />} onClick={() => file.current?.click()}>
                Enviar logotipo
              </Button>
            </div>
          </Card>
          <Card title="Prévia">
            {palette ? (
              <div className="space-y-3">
                <div className="flex overflow-hidden rounded-lg border border-border" aria-label="Tons gerados a partir da cor principal">
                  {Object.entries(palette).map(([step, color]) => (
                    <span key={step} className="h-8 flex-1" style={{ background: color }} title={`${step}: ${color}`} />
                  ))}
                </div>
                <span className="inline-flex rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: palette[500] }}>
                  {form.appName || 'Botão principal'}
                </span>
              </div>
            ) : (
              <p className="text-sm text-danger">Use a cor no formato #RRGGBB.</p>
            )}
            <p className="mt-3 text-xs text-muted">Os apps Android/iOS com a marca são gerados com APP_DISPLAY_NAME, APP_BRAND_COLOR e EXPO_PUBLIC_TENANT (veja o README).</p>
          </Card>
        </div>
      </div>
    </>
  );
}
