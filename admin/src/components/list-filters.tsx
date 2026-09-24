'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';

/** Estado de filtros sincronizado com a URL (links compartilháveis, voltar do navegador). */
export function useUrlFilters<T extends Record<string, string>>(defaults: T) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const values = Object.fromEntries(Object.keys(defaults).map((key) => [key, params.get(key) ?? defaults[key]])) as T;

  const set = (patch: Partial<T>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value as string);
      else next.delete(key);
    }
    if (!('page' in patch)) next.delete('page');
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return [values, set] as const;
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    const timer = setTimeout(() => text !== value && onChange(text), 350);
    return () => clearTimeout(timer);
  }, [text, value, onChange]);
  return (
    <label className="relative block w-full sm:max-w-xs">
      <span className="sr-only">{placeholder}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-fg placeholder:text-muted focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />
    </label>
  );
}
