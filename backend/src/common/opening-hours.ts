import { BadRequestException } from '@nestjs/common';

export interface OpeningInterval {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Converte para intervalos absolutos na semana (em minutos), tratando turnos que cruzam a meia-noite. */
function toWeekRanges(interval: OpeningInterval): [number, number] {
  const start = interval.weekday * 1440 + toMinutes(interval.opensAt);
  let end = interval.weekday * 1440 + toMinutes(interval.closesAt);
  if (end <= start) end += 1440;
  return [start, end];
}

/** Valida turnos: início ≠ fim e sem sobreposição (inclusive entre dias, por turnos noturnos). */
export function validateOpeningHours(hours: OpeningInterval[]): void {
  const ranges = hours.map((interval) => {
    if (interval.opensAt === interval.closesAt) {
      throw new BadRequestException('Horário de abertura e fechamento não podem ser iguais.');
    }
    return toWeekRanges(interval);
  });
  const WEEK = 7 * 1440;
  const normalized = ranges.flatMap(([start, end]) => (end > WEEK ? [[start, WEEK], [0, end - WEEK]] : [[start, end]]));
  normalized.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < normalized.length; i++) {
    if (normalized[i][0] < normalized[i - 1][1]) throw new BadRequestException('Existem turnos sobrepostos.');
  }
}

/** Dia da semana e minutos do dia no fuso informado. */
export function localWeekMinute(date: Date, timeZone: string): { weekday: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { weekday, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** A loja está dentro do horário de funcionamento neste instante? */
export function isWithinOpeningHours(hours: OpeningInterval[], date: Date, timeZone: string): boolean {
  const { weekday, minute } = localWeekMinute(date, timeZone);
  const now = weekday * 1440 + minute;
  const WEEK = 7 * 1440;
  return hours.some((interval) => {
    const [start, end] = toWeekRanges(interval);
    return (now >= start && now < end) || (end > WEEK && now < end - WEEK);
  });
}
