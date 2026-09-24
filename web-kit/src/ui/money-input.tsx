'use client';

import { useEffect, useState } from 'react';
import { Input } from './primitives';

/** Converte "12,50" / "12.50" / "1.234,56" em centavos. Retorna null quando vazio ou inválido. */
export function parseMoney(value: string): number | null {
  const clean = value.trim().replace(/\s|R\$/g, '');
  if (!clean) return null;
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : null;
}

export const centsToInput = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2).replace('.', ','));

/** Campo de valor em reais que trabalha com centavos. */
export function MoneyInput({
  label,
  value,
  onChange,
  required,
  hint,
  className,
}: {
  label: string;
  value: number | null;
  onChange: (cents: number | null) => void;
  required?: boolean;
  hint?: string;
  className?: string;
}) {
  const [text, setText] = useState(centsToInput(value));
  useEffect(() => setText(centsToInput(value)), [value]);
  const invalid = text !== '' && parseMoney(text) === null;
  return (
    <Input
      className={className}
      label={label}
      inputMode="decimal"
      placeholder="0,00"
      required={required}
      hint={hint}
      value={text}
      error={invalid ? 'Valor inválido.' : undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const cents = parseMoney(text);
        onChange(cents);
        setText(centsToInput(cents));
      }}
    />
  );
}
