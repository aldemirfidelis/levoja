'use client';

import { FormEvent, useState } from 'react';
import { COMPANY_DOCUMENT_LABELS, COMPANY_DOCUMENT_TYPES } from '@levoja/shared';
import { api, useApi, useApiMutation } from '@levoja/web-kit/client';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  ErrorState,
  errorMessage,
  formatDateTime,
  Input,
  PageHeader,
  Select,
  SkeletonRows,
  Tabs,
  Textarea,
  useToast,
} from '@levoja/web-kit/ui';

interface Segment {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  kind: 'MARKETPLACE' | 'ON_DEMAND';
  sortOrder: number;
  isActive: boolean;
  isRegulated: boolean;
  minimumAge: number | null;
  requiredDocuments: string[];
  _count: { companies: number };
}

interface LegalDoc {
  id: string;
  type: string;
  version: string;
  title: string;
  isCurrent: boolean;
  publishedAt: string;
}

const LEGAL_TYPES = [
  { value: 'TERMS_OF_USE', label: 'Termos de Uso' },
  { value: 'PRIVACY_POLICY', label: 'Política de Privacidade' },
  { value: 'DRIVER_TERMS', label: 'Termos do Entregador' },
  { value: 'COMPANY_TERMS', label: 'Termos para Empresas' },
];

function SegmentForm({ segment, onClose }: { segment: Segment | null; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    slug: segment?.slug ?? '',
    name: segment?.name ?? '',
    description: segment?.description ?? '',
    icon: segment?.icon ?? '',
    kind: segment?.kind ?? 'MARKETPLACE',
    sortOrder: segment?.sortOrder ?? 100,
    isActive: segment?.isActive ?? true,
    isRegulated: segment?.isRegulated ?? false,
    minimumAge: segment?.minimumAge ?? '',
    requiredDocuments: segment?.requiredDocuments ?? [],
  });
  const [error, setError] = useState<string>();
  const save = useApiMutation(
    () => {
      const body = { ...form, minimumAge: form.minimumAge === '' ? undefined : Number(form.minimumAge), sortOrder: Number(form.sortOrder) };
      return segment ? api.patch(`admin/segments/${segment.id}`, body) : api.post('admin/segments', body);
    },
    ['admin/segments'],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await save.mutateAsync(undefined);
      toast.success('Segmento salvo.');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open onClose={onClose} title={segment ? `Editar ${segment.name}` : 'Novo segmento'} size="lg">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Input label="Nome" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="Identificador" required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} />
        <Input className="sm:col-span-2" label="Descrição" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <Select
          label="Tipo"
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value as Segment['kind'] })}
          options={[
            { value: 'MARKETPLACE', label: 'Marketplace (lojas)' },
            { value: 'ON_DEMAND', label: 'Entrega avulsa' },
          ]}
        />
        <Input label="Ícone (lucide)" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} />
        <Input label="Ordem" type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />
        <Input label="Idade mínima" type="number" min={0} max={21} value={form.minimumAge} onChange={(e) => setForm({ ...form, minimumAge: e.target.value as never })} />
        <div className="space-y-2 sm:col-span-2">
          <Checkbox label="Ativo (visível na Home)" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
          <Checkbox label="Produtos regulados (regras específicas, ex.: medicamentos)" checked={form.isRegulated} onChange={(e) => setForm({ ...form, isRegulated: e.target.checked })} />
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium">Documentos adicionais exigidos das empresas</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {COMPANY_DOCUMENT_TYPES.filter((type) => !['CNPJ_CARD', 'RESPONSIBLE_ID', 'ADDRESS_PROOF', 'OTHER'].includes(type)).map((type) => (
              <Checkbox
                key={type}
                label={COMPANY_DOCUMENT_LABELS[type]}
                checked={form.requiredDocuments.includes(type)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    requiredDocuments: e.target.checked ? [...form.requiredDocuments, type] : form.requiredDocuments.filter((item) => item !== type),
                  })
                }
              />
            ))}
          </div>
        </fieldset>
        {error && <p className="text-sm text-danger sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Segments() {
  const { data, error, isLoading, refetch } = useApi<Segment[]>('admin/segments');
  const [editing, setEditing] = useState<Segment | null | 'new'>(null);
  if (isLoading) return <SkeletonRows />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  return (
    <Card title="Segmentos da Home" actions={<Button size="sm" onClick={() => setEditing('new')}>Novo segmento</Button>}>
      <ul className="divide-y divide-border">
        {data.map((segment) => (
          <li key={segment.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {segment.name}
                <Badge tone={segment.kind === 'ON_DEMAND' ? 'info' : 'brand'}>{segment.kind === 'ON_DEMAND' ? 'Entrega avulsa' : 'Marketplace'}</Badge>
                {segment.isRegulated && <Badge tone="warning">Regulado</Badge>}
                {!segment.isActive && <Badge>Inativo</Badge>}
              </p>
              <p className="text-xs text-muted">
                {segment.description} · {segment._count.companies} empresa(s)
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setEditing(segment)}>
              Editar
            </Button>
          </li>
        ))}
      </ul>
      {editing && <SegmentForm segment={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function LegalDocuments() {
  const toast = useToast();
  const { data, error, isLoading, refetch } = useApi<LegalDoc[]>('admin/legal-documents');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: 'TERMS_OF_USE', version: '', title: '', content: '' });
  const [formError, setFormError] = useState<string>();
  const publish = useApiMutation(() => api.post('admin/legal-documents', form), ['admin/legal-documents']);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await publish.mutateAsync(undefined);
      toast.success('Nova versão publicada. Os usuários precisarão aceitá-la.');
      setOpen(false);
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  if (isLoading) return <SkeletonRows />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  return (
    <Card title="Documentos legais" actions={<Button size="sm" onClick={() => setOpen(true)}>Publicar nova versão</Button>}>
      <ul className="divide-y divide-border">
        {data.map((doc) => (
          <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <span>
              {doc.title} <span className="text-muted">v{doc.version}</span>
            </span>
            <span className="flex items-center gap-2">
              {doc.isCurrent && <Badge tone="success">Vigente</Badge>}
              <span className="text-xs text-muted">{formatDateTime(doc.publishedAt)}</span>
            </span>
          </li>
        ))}
      </ul>
      <Dialog open={open} onClose={() => setOpen(false)} title="Publicar nova versão" description="Revisão jurídica recomendada antes da publicação." size="lg">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Select label="Documento" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={LEGAL_TYPES} />
            <Input label="Versão" placeholder="2.0" required value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
            <Input label="Título" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <Textarea label="Conteúdo (Markdown)" rows={14} required value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={publish.isPending}>
              Publicar
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}

interface PlatformSetting {
  key: string;
  description: string;
  value: unknown;
  isDefault: boolean;
  updatedAt: string | null;
}

/** Parâmetros tipados (validados no servidor com o schema de cada chave). */
function Parameters() {
  const toast = useToast();
  const { data, error, isLoading, refetch } = useApi<PlatformSetting[]>('admin/settings');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (isLoading) return <SkeletonRows />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  const save = async (setting: PlatformSetting) => {
    try {
      const value = JSON.parse(drafts[setting.key] ?? JSON.stringify(setting.value));
      await api.put(`admin/settings/${setting.key}`, { value });
      toast.success('Parâmetro salvo.');
      setDrafts((current) => {
        const { [setting.key]: _removed, ...rest } = current;
        return rest;
      });
      await refetch();
    } catch (err) {
      toast.error(err instanceof SyntaxError ? new Error('JSON inválido.') : err);
    }
  };

  return (
    <Card title="Parâmetros da plataforma">
      <ul className="divide-y divide-border">
        {data.map((setting) => (
          <li key={setting.key} className="grid gap-3 py-4 md:grid-cols-[1fr_20rem_auto] md:items-start">
            <div>
              <p className="text-sm font-medium">{setting.description}</p>
              <p className="text-xs text-muted">
                <code>{setting.key}</code> {setting.isDefault ? '· valor padrão' : `· alterado em ${formatDateTime(setting.updatedAt)}`}
              </p>
            </div>
            <Textarea
              aria-label={setting.key}
              rows={2}
              className="font-mono"
              value={drafts[setting.key] ?? JSON.stringify(setting.value)}
              onChange={(e) => setDrafts({ ...drafts, [setting.key]: e.target.value })}
            />
            <Button size="sm" variant="secondary" disabled={drafts[setting.key] === undefined} onClick={() => save(setting)}>
              Salvar
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState<'segments' | 'legal' | 'parameters'>('segments');
  return (
    <>
      <PageHeader title="Configurações" description="Parâmetros gerais da plataforma." />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'segments', label: 'Segmentos' },
          { value: 'parameters', label: 'Parâmetros' },
          { value: 'legal', label: 'Documentos legais' },
        ]}
      />
      {tab === 'segments' && <Segments />}
      {tab === 'parameters' && <Parameters />}
      {tab === 'legal' && <LegalDocuments />}
    </>
  );
}
