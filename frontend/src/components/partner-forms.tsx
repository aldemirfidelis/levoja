'use client';

import { FormEvent, useRef, useState } from 'react';
import { CheckCircle2, Circle, ExternalLink, Trash2, Upload } from 'lucide-react';
import { api } from '@levoja/web-kit/client';
import { Button, Card, DocumentStatusBadge, errorMessage, formatDateTime, Input, Select, useToast } from '@levoja/web-kit/ui';
import type { DocumentStatus } from '@levoja/shared';

export interface PartnerDoc {
  id: string;
  type: string;
  label: string;
  fileName: string;
  status: DocumentStatus;
  reviewNote: string | null;
  createdAt: string;
}

export interface Requirement {
  key: string;
  label: string;
  done: boolean;
  detail?: string;
}

export function Checklist({ items }: { items: Requirement[] }) {
  const done = items.filter((item) => item.done).length;
  const percent = items.length ? Math.round((done / items.length) * 100) : 0;
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${percent}%` }} />
        </div>
        <span className="text-sm font-semibold tabular-nums">
          {done}/{items.length}
        </span>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-2 text-sm">
            {item.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Concluído" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-label="Pendente" />}
            <span>
              <span className={item.done ? 'text-fg' : 'text-muted'}>{item.label}</span>
              {item.detail && <span className="block text-xs text-danger">{item.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Envio e acompanhamento de documentos. Aceita PDF, PNG, JPEG ou WEBP (validados pelo conteúdo na API).
 * `basePath` ex.: "companies/<id>" ou "drivers/me".
 */
export function DocumentsManager({
  basePath,
  documents,
  types,
  required,
  locked,
  onChange,
}: {
  basePath: string;
  documents: PartnerDoc[];
  types: { value: string; label: string }[];
  required: string[];
  locked?: string;
  onChange: () => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState(required.find((t) => !documents.some((d) => d.type === t && d.status !== 'REJECTED')) ?? types[0]?.value ?? '');
  const [busy, setBusy] = useState(false);

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return toast.error(new Error('Selecione um arquivo.'));
    const form = new FormData();
    form.set('type', type);
    form.set('file', file);
    setBusy(true);
    try {
      await api.upload(`${basePath}/documents`, form);
      toast.success('Documento enviado.');
      if (fileRef.current) fileRef.current.value = '';
      onChange();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (doc: PartnerDoc) => {
    try {
      await api.delete(`${basePath}/documents/${doc.id}`);
      toast.success('Documento removido.');
      onChange();
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <div className="space-y-6">
      {locked ? (
        <p className="rounded-lg bg-info/10 px-4 py-3 text-sm text-fg">{locked}</p>
      ) : (
        <Card title="Enviar documento">
          <form onSubmit={upload} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Select
              label="Tipo"
              value={type}
              onChange={(e) => setType(e.target.value)}
              options={types.map((item) => ({ ...item, label: required.includes(item.value) ? `${item.label} (obrigatório)` : item.label }))}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="doc-file" className="text-sm font-medium">
                Arquivo
              </label>
              <input
                id="doc-file"
                ref={fileRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                className="block w-full rounded-lg border border-border bg-surface text-sm file:mr-3 file:h-10 file:border-0 file:bg-surface-2 file:px-3 file:text-sm file:font-medium"
              />
            </div>
            <Button type="submit" loading={busy} icon={<Upload className="h-4 w-4" />}>
              Enviar
            </Button>
          </form>
          <p className="mt-3 text-xs text-muted">PDF ou imagem (PNG, JPEG, WEBP), até 10 MB. Garanta que o documento esteja legível e dentro da validade.</p>
        </Card>
      )}
      <Card title="Documentos enviados">
        {documents.length === 0 ? (
          <p className="text-sm text-muted">Nenhum documento enviado ainda.</p>
        ) : (
          <ul className="divide-y divide-border">
            {documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{doc.label}</p>
                  <p className="truncate text-xs text-muted">
                    {doc.fileName} · {formatDateTime(doc.createdAt)}
                  </p>
                  {doc.status === 'REJECTED' && doc.reviewNote && <p className="mt-1 text-xs text-danger">Motivo: {doc.reviewNote}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <DocumentStatusBadge status={doc.status} />
                  <a href={api.fileUrl(`${basePath}/documents/${doc.id}/file`)} target="_blank" rel="noopener noreferrer" className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label="Abrir">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  {!locked && doc.status !== 'APPROVED' && (
                    <button onClick={() => remove(doc)} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-danger" aria-label="Remover">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export interface BankAccountView {
  holderName: string;
  bankCode: string;
  branch: string;
  accountLast4: string;
  accountType: string;
  pixKeyType: string | null;
  pixKeyMasked: string | null;
}

const PIX_TYPES = [
  { value: 'CPF', label: 'CPF' },
  { value: 'CNPJ', label: 'CNPJ' },
  { value: 'EMAIL', label: 'E-mail' },
  { value: 'PHONE', label: 'Celular' },
  { value: 'RANDOM', label: 'Chave aleatória' },
];

/** Dados bancários/PIX. Os valores gravados nunca voltam completos da API (apenas mascarados). */
export function BankAccountForm({ path, current, onSaved, defaultHolder }: { path: string; current: BankAccountView | null; onSaved: () => void; defaultHolder?: string }) {
  const toast = useToast();
  const [form, setForm] = useState({
    holderName: current?.holderName ?? defaultHolder ?? '',
    holderDocument: '',
    bankCode: current?.bankCode ?? '',
    branch: current?.branch ?? '',
    accountNumber: '',
    accountType: current?.accountType ?? 'CHECKING',
    pixKeyType: current?.pixKeyType ?? 'CPF',
    pixKey: '',
  });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.put(path, { ...form, pixKeyType: form.pixKey ? form.pixKeyType : undefined, pixKey: form.pixKey || undefined });
      toast.success('Dados bancários salvos.');
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {current && (
        <p className="rounded-lg bg-surface-2 px-4 py-3 text-sm sm:col-span-2">
          Cadastrado: banco {current.bankCode}, ag. {current.branch}, conta ••••{current.accountLast4}
          {current.pixKeyMasked && ` · PIX ${current.pixKeyType}: ${current.pixKeyMasked}`}. Para alterar, preencha novamente.
        </p>
      )}
      <Input label="Nome do titular" required value={form.holderName} onChange={set('holderName')} />
      <Input label="CPF/CNPJ do titular" required value={form.holderDocument} onChange={set('holderDocument')} />
      <Input label="Código do banco" placeholder="Ex.: 260" hint="3 dígitos (código COMPE)" required maxLength={3} value={form.bankCode} onChange={set('bankCode')} />
      <Input label="Agência" required value={form.branch} onChange={set('branch')} />
      <Input label="Conta (com dígito)" required value={form.accountNumber} onChange={set('accountNumber')} />
      <Select
        label="Tipo de conta"
        value={form.accountType}
        onChange={set('accountType')}
        options={[
          { value: 'CHECKING', label: 'Corrente' },
          { value: 'SAVINGS', label: 'Poupança' },
          { value: 'PAYMENT', label: 'Conta de pagamento' },
        ]}
      />
      <Select label="Tipo de chave PIX" value={form.pixKeyType} onChange={set('pixKeyType')} options={PIX_TYPES} />
      <Input label="Chave PIX" value={form.pixKey} onChange={set('pixKey')} />
      {error && <p className="text-sm text-danger sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2">
        <Button type="submit" loading={busy}>
          Salvar dados bancários
        </Button>
      </div>
    </form>
  );
}
