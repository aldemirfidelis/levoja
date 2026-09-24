export interface OpeningHour {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** A loja está aberta neste instante (hora local do aparelho)? Turnos podem atravessar a meia-noite. */
export function isOpenAt(hours: OpeningHour[], at: Date): boolean {
  const minute = at.getHours() * 60 + at.getMinutes();
  const weekday = at.getDay();
  return hours.some((hour) => {
    const opens = toMinutes(hour.opensAt);
    const closes = toMinutes(hour.closesAt);
    if (closes > opens) return hour.weekday === weekday && minute >= opens && minute < closes;
    return (hour.weekday === weekday && minute >= opens) || (hour.weekday === (weekday + 6) % 7 && minute < closes);
  });
}

/**
 * Horários de agendamento a cada 30 min, a partir de 45 min à frente (a API exige 30 min de
 * antecedência), dentro do funcionamento da loja, nas próximas 48 h.
 */
export function scheduleSlots(hours: OpeningHour[], now = new Date(), limit = 16): Date[] {
  const slots: Date[] = [];
  const start = new Date(now.getTime() + 45 * 60_000);
  start.setSeconds(0, 0);
  if (start.getMinutes() !== 0 && start.getMinutes() !== 30) start.setMinutes(start.getMinutes() < 30 ? 30 : 60);
  for (let at = start; at.getTime() < now.getTime() + 48 * 3_600_000 && slots.length < limit; at = new Date(at.getTime() + 30 * 60_000)) {
    if (isOpenAt(hours, at)) slots.push(at);
  }
  return slots;
}
