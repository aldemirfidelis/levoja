import { isOpenAt, scheduleSlots } from '../schedule';

const at = (iso: string) => new Date(iso);

describe('agendamento de pedidos', () => {
  const weekdays = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opensAt: '10:00', closesAt: '22:00' }));

  it('respeita o horário de funcionamento', () => {
    expect(isOpenAt(weekdays, at('2026-09-23T12:00:00'))).toBe(true); // quarta
    expect(isOpenAt(weekdays, at('2026-09-23T22:00:00'))).toBe(false);
    expect(isOpenAt(weekdays, at('2026-09-26T12:00:00'))).toBe(false); // sábado
  });

  it('turno que atravessa a meia-noite', () => {
    const night = [{ weekday: 5, opensAt: '18:00', closesAt: '02:00' }]; // sexta 18h → sábado 2h
    expect(isOpenAt(night, at('2026-09-25T23:30:00'))).toBe(true);
    expect(isOpenAt(night, at('2026-09-26T01:30:00'))).toBe(true);
    expect(isOpenAt(night, at('2026-09-26T02:30:00'))).toBe(false);
  });

  it('gera horários a cada 30 min com antecedência mínima e dentro do funcionamento', () => {
    const slots = scheduleSlots(weekdays, at('2026-09-23T20:10:00'), 50);
    expect(slots[0].getHours()).toBe(21);
    expect(slots[0].getMinutes()).toBe(0);
    expect(slots.every((slot) => slot.getMinutes() % 30 === 0)).toBe(true);
    expect(slots.every((slot) => isOpenAt(weekdays, slot))).toBe(true);
    // Depois das 21:30 a loja fecha; o próximo horário é quinta às 10:00.
    expect(slots[2].getDay()).toBe(4);
    expect(slots[2].getHours()).toBe(10);
  });

  it('loja sem horários: nenhum agendamento', () => {
    expect(scheduleSlots([], at('2026-09-23T12:00:00'))).toEqual([]);
  });
});
