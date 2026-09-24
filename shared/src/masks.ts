/** Máscaras de digitação (formatam enquanto o usuário digita). Compartilhadas entre web e apps. */

export function maskCpf(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function maskPhone(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
}

export function maskCep(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 8);
  return d.replace(/(\d{5})(\d)/, '$1-$2');
}

/** "DD/MM/AAAA" enquanto digita. */
export function maskDate(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 8);
  return d.replace(/(\d{2})(\d)/, '$1/$2').replace(/(\d{2})\/(\d{2})(\d)/, '$1/$2/$3');
}

/** "DD/MM/AAAA" → "AAAA-MM-DD" (ou null se inválida). */
export function brDateToIso(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(dd) || date.getUTCMonth() + 1 !== Number(mm)) return null;
  return `${yyyy}-${mm}-${dd}`;
}
