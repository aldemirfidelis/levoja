import { computePrice, PriceRule, selectRule } from './pricing.engine';

const rule = (overrides: Partial<PriceRule> = {}): PriceRule => ({
  id: 'r1',
  name: 'Padrão',
  priority: 0,
  vehicleType: null,
  city: null,
  state: null,
  baseCents: 500,
  perKmCents: 150,
  includedKm: 2,
  perMinuteCents: 0,
  perKgCents: 0,
  includedKg: 0,
  minimumCents: 700,
  maximumCents: null,
  nightSurchargeBps: 0,
  rainSurchargeBps: 0,
  demandSurchargeMaxBps: 0,
  timeWindows: null,
  ...overrides,
});

const base = { distanceKm: 6, durationMin: 18, weekday: 2, minuteOfDay: 14 * 60 };

describe('Motor de precificação', () => {
  it('calcula base + km excedente', () => {
    const quote = computePrice(rule(), base);
    // 500 + (6 - 2) * 150 = 1100
    expect(quote.totalCents).toBe(1100);
    expect(quote.lines.map((line) => line.label)).toEqual(['Valor base', 'Distância (4.0 km)']);
  });

  it('aplica o valor mínimo e o máximo', () => {
    expect(computePrice(rule(), { ...base, distanceKm: 1 }).totalCents).toBe(700);
    expect(computePrice(rule({ maximumCents: 900 }), base).totalCents).toBe(900);
  });

  it('soma adicionais noturno, de chuva, de janela e de demanda sobre o subtotal', () => {
    const quote = computePrice(
      rule({
        nightSurchargeBps: 2000,
        rainSurchargeBps: 1000,
        demandSurchargeMaxBps: 5000,
        timeWindows: [{ weekdays: [5, 6], from: '18:00', to: '23:00', surchargeBps: 1500 }],
      }),
      { ...base, weekday: 5, minuteOfDay: 22 * 60 + 30, raining: true, demandPressure: 1 },
    );
    // subtotal 1100: noturno 220, janela 165, chuva 110, demanda 550
    expect(quote.totalCents).toBe(1100 + 220 + 165 + 110 + 550);
  });

  it('adicional de demanda só começa acima de 50% de pressão', () => {
    expect(computePrice(rule({ demandSurchargeMaxBps: 5000 }), { ...base, demandPressure: 0.5 }).totalCents).toBe(1100);
    expect(computePrice(rule({ demandSurchargeMaxBps: 5000 }), { ...base, demandPressure: 0.75 }).totalCents).toBe(1100 + 275);
  });

  it('adicional programado (pico previsto) incide sobre o subtotal', () => {
    const quote = computePrice(rule(), { ...base, scheduledSurchargeBps: 1500 });
    expect(quote.totalCents).toBe(1100 + 165);
    expect(quote.lines.at(-1)).toEqual({ label: 'Adicional de alta demanda', cents: 165 });
    expect(computePrice(rule(), { ...base, scheduledSurchargeBps: 0 }).totalCents).toBe(1100);
  });

  it('janelas que atravessam a meia-noite', () => {
    const quote = computePrice(rule({ timeWindows: [{ weekdays: [1], from: '23:00', to: '02:00', surchargeBps: 1000 }] }), {
      ...base,
      weekday: 1,
      minuteOfDay: 60,
    });
    expect(quote.totalCents).toBe(1210);
  });

  it('seleciona a regra mais específica e de maior prioridade', () => {
    const rules = [
      rule({ id: 'geral' }),
      rule({ id: 'moto', vehicleType: 'MOTORCYCLE' }),
      rule({ id: 'sp-moto', vehicleType: 'MOTORCYCLE', city: 'São Paulo', state: 'SP' }),
      rule({ id: 'carro', vehicleType: 'CAR', priority: 10 }),
    ];
    expect(selectRule(rules, { ...base, vehicleType: 'MOTORCYCLE', city: 'sao paulo', state: 'sp' })?.id).toBe('sp-moto');
    expect(selectRule(rules, { ...base, vehicleType: 'MOTORCYCLE', city: 'Campinas', state: 'SP' })?.id).toBe('moto');
    expect(selectRule(rules, { ...base, vehicleType: 'BICYCLE' })?.id).toBe('geral');
    expect(selectRule(rules, { ...base, vehicleType: 'CAR' })?.id).toBe('carro');
  });
});
