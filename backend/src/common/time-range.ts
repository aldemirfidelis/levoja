import { BadRequestException } from '@nestjs/common';

const DAY_MS = 86_400_000;

/** Diferença (ms) entre o horário local do fuso e o UTC no instante informado. */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Meia-noite local (no fuso) de um dia de calendário, como instante UTC. */
function localMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const naive = Date.UTC(year, month, day);
  // Duas passadas cobrem a troca de horário de verão.
  const first = naive - timeZoneOffsetMs(new Date(naive), timeZone);
  return new Date(naive - timeZoneOffsetMs(new Date(first), timeZone));
}

/** Início do dia local que contém o instante. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const local = new Date(date.getTime() + timeZoneOffsetMs(date, timeZone));
  return localMidnight(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), timeZone);
}

/** Converte "AAAA-MM-DD" (data local) no início daquele dia no fuso. */
export function parseLocalDate(value: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new BadRequestException(`Data inválida: ${value}. Use AAAA-MM-DD.`);
  return localMidnight(Number(match[1]), Number(match[2]) - 1, Number(match[3]), timeZone);
}

/** Data local "AAAA-MM-DD" do instante no fuso. */
export function formatLocalDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export type Period = 'today' | 'week' | 'month';

/** Períodos móveis: hoje, últimos 7 dias e últimos 30 dias (dias completos no fuso, incluindo hoje). */
export function periodRange(period: Period, timeZone: string, now = new Date()): { from: Date; to: Date } {
  const days = period === 'today' ? 0 : period === 'week' ? 6 : 29;
  return { from: startOfLocalDay(new Date(now.getTime() - days * DAY_MS), timeZone), to: now };
}

/**
 * Intervalo de relatório a partir de datas locais (fim inclusivo).
 * Sem datas: últimos 30 dias. Limite de 400 dias para proteger o banco.
 */
export function reportRange(from: string | undefined, to: string | undefined, timeZone: string, now = new Date()): { from: Date; to: Date; fromDate: string; toDate: string } {
  const end = to ? new Date(parseLocalDate(to, timeZone).getTime() + DAY_MS + 3 * 3_600_000) : now;
  // Fim exclusivo: início do dia seguinte (recalculado no fuso para respeitar horário de verão).
  const toExclusive = to ? startOfLocalDay(end, timeZone) : now;
  const fromDate = from ? parseLocalDate(from, timeZone) : startOfLocalDay(new Date(now.getTime() - 29 * DAY_MS), timeZone);
  if (fromDate >= toExclusive) throw new BadRequestException('A data inicial deve ser anterior à final.');
  if (toExclusive.getTime() - fromDate.getTime() > 400 * DAY_MS) throw new BadRequestException('Período máximo de 400 dias.');
  return {
    from: fromDate,
    to: toExclusive,
    fromDate: formatLocalDate(fromDate, timeZone),
    toDate: formatLocalDate(new Date(toExclusive.getTime() - 1), timeZone),
  };
}
