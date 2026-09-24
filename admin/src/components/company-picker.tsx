'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Paginated, useApi } from '@levoja/web-kit/client';
import { Field } from '@levoja/web-kit/ui';
import type { CompanyListItem } from '@/lib/types';

/** Busca de empresa por nome/CNPJ para vincular regras (comissão, cupons). */
export function CompanyPicker({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: { id: string; name: string } | null;
  onChange: (value: { id: string; name: string } | null) => void;
  hint?: string;
}) {
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const { data, isFetching } = useApi<Paginated<CompanyListItem>>(term.length >= 2 && !value ? 'admin/companies' : null, { search: term, pageSize: 8 });

  if (value) {
    return (
      <Field label={label} hint={hint}>
        {(id) => (
          <div id={id} className="flex h-10 items-center justify-between rounded-lg border border-border bg-surface-2 px-3 text-sm">
            <span className="truncate">{value.name}</span>
            <button type="button" className="rounded p-1 text-muted hover:text-fg" onClick={() => onChange(null)} aria-label="Remover empresa">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </Field>
    );
  }

  return (
    <Field label={label} hint={hint ?? 'Deixe em branco para todas as empresas.'}>
      {(id) => (
      <div className="relative">
        <input
          id={id}
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Buscar por nome ou CNPJ"
          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg placeholder:text-muted focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        {term.length >= 2 && (
          <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg" role="listbox">
            {isFetching && <li className="px-3 py-2 text-sm text-muted">Buscando…</li>}
            {!isFetching && data?.data.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nenhuma empresa encontrada.</li>}
            {data?.data.map((company) => (
              <li key={company.id}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2"
                  onClick={() => {
                    onChange({ id: company.id, name: company.tradeName });
                    setText('');
                  }}
                >
                  {company.tradeName}
                  <span className="block text-xs text-muted">{company.legalName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}
    </Field>
  );
}
