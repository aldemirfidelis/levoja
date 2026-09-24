import { formatBRL } from '@levoja/shared';

export { formatBRL };

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const day = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

export const formatDateTime = (value?: string | Date | null) => (value ? dateTime.format(new Date(value)) : '—');
export const formatTime = (value?: string | Date | null) => (value ? time.format(new Date(value)) : '—');
export const formatDay = (value?: string | Date | null) => (value ? day.format(new Date(value)) : '—');

/** "há 5 min", "há 2 h", ou a data. */
export function formatRelative(value?: string | Date | null): string {
  if (!value) return '—';
  const diff = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (diff < 1) return 'agora';
  if (diff < 60) return `há ${diff} min`;
  if (diff < 24 * 60) return `há ${Math.round(diff / 60)} h`;
  return formatDateTime(value);
}

export const formatKm = (km?: number | null) => (km == null ? '—' : `${km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`);

/** Converte "12,50" / "12.50" / "1.234,56" em centavos; null se vazio ou inválido. */
export function parseMoney(value: string): number | null {
  const clean = value.trim().replace(/\s|R\$/g, '');
  if (!clean) return null;
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : null;
}

export const centsToInput = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2).replace('.', ','));
