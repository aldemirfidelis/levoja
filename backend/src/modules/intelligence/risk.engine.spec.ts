import { addressKey, decayedScore, impossibleJumps, rateOutliers, riskLevel } from './risk.engine';

const now = new Date('2026-09-24T12:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe('motor de risco', () => {
  it('pontos decaem pela meia-vida e o score fica entre 0 e 100', () => {
    expect(decayedScore([{ points: 40, at: now }], now, 14)).toBe(40);
    expect(decayedScore([{ points: 40, at: daysAgo(14) }], now, 14)).toBe(20);
    expect(decayedScore([{ points: 40, at: daysAgo(28) }], now, 14)).toBe(10);
    expect(decayedScore([{ points: 80, at: now }, { points: 80, at: now }], now, 14)).toBe(100);
    expect(decayedScore([], now, 14)).toBe(0);
  });

  it('níveis seguem os limites configurados', () => {
    const thresholds = { medium: 30, high: 60 };
    expect(riskLevel(10, thresholds)).toBe('LOW');
    expect(riskLevel(30, thresholds)).toBe('MEDIUM');
    expect(riskLevel(75, thresholds)).toBe('HIGH');
  });

  it('detecta salto impossível no GPS e ignora oscilações e trajetos normais', () => {
    const t0 = new Date('2026-09-24T12:00:00Z');
    const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);
    const normal = [
      { lat: -23.55, lng: -46.63, at: at(0) },
      { lat: -23.552, lng: -46.632, at: at(30) },
      { lat: -23.556, lng: -46.636, at: at(90) },
    ];
    expect(impossibleJumps(normal, 150)).toHaveLength(0);
    // ~25 km em 60 s (1500 km/h).
    const teleport = [...normal, { lat: -23.78, lng: -46.7, at: at(150) }];
    const violations = impossibleJumps(teleport, 150);
    expect(violations).toHaveLength(1);
    expect(violations[0].kmh).toBeGreaterThan(1000);
    // Leitura imprecisa (2 km de margem) não conta como salto.
    expect(impossibleJumps([{ lat: 0, lng: 0, at: at(0), accuracy: 1500 }, { lat: 0.012, lng: 0, at: at(5), accuracy: 1500 }], 150)).toHaveLength(0);
  });

  it('taxa de cancelamento fora do padrão exige volume mínimo', () => {
    const subjects = [
      ...Array.from({ length: 30 }, (_, index) => ({ id: `ok${index}`, total: 40, events: 2 })),
      { id: 'abusivo', total: 20, events: 12 },
      { id: 'pouco-volume', total: 2, events: 2 },
    ];
    const outliers = rateOutliers(subjects, { minTotal: 5, minEvents: 3, zThreshold: 3 });
    expect(outliers.map((outlier) => outlier.id)).toEqual(['abusivo']);
    expect(outliers[0].rate).toBeCloseTo(0.6);
  });

  it('chave de endereço ignora acentos, prefixos e pontuação', () => {
    expect(addressKey({ street: 'Rua São João', number: '100', zipCode: '01000-000' })).toBe(addressKey({ street: 'r. sao joao', number: '100', zipCode: '01000000' }));
    expect(addressKey({ street: 'Av. Paulista', number: '1', zipCode: '01310-100' })).not.toBe(addressKey({ street: 'Av. Paulista', number: '2', zipCode: '01310-100' }));
    expect(addressKey(null)).toBeNull();
  });
});
