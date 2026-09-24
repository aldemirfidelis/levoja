import { useEffect, useState } from 'react';
import { centsToInput, parseMoney } from '../format';
import { Field } from './primitives';

/** Campo de valor em reais que trabalha com centavos. */
export function MoneyField({ label, value, onChange, hint, error, placeholder = '0,00' }: { label: string; value: number | null; onChange: (cents: number | null) => void; hint?: string; error?: string | null; placeholder?: string }) {
  const [text, setText] = useState(centsToInput(value));
  useEffect(() => setText(centsToInput(value)), [value]);
  const invalid = text !== '' && parseMoney(text) === null;
  return (
    <Field
      label={label}
      value={text}
      placeholder={placeholder}
      keyboardType="decimal-pad"
      hint={hint}
      error={invalid ? 'Valor inválido.' : error}
      onChangeText={setText}
      onBlur={() => {
        const cents = parseMoney(text);
        onChange(cents);
        setText(centsToInput(cents));
      }}
    />
  );
}
