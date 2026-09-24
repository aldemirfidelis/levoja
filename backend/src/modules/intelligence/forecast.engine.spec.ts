import { binomialZ, demandDeviation, driversNeeded, forecastAccuracy, median, seasonalForecast, trendFactor } from './forecast.engine';

describe('previsão de demanda', () => {
  it('média sazonal pondera as semanas recentes', () => {
    const flat = seasonalForecast([10, 10, 10, 10]);
    expect(flat.predicted).toBe(10);
    expect(flat.low).toBeLessThan(10);
    expect(flat.high).toBeGreaterThan(10);
    // Semana mais recente maior puxa a previsão para cima, mas não até ela.
    const rising = seasonalForecast([20, 10, 10, 10]);
    expect(rising.predicted).toBeGreaterThan(12);
    expect(rising.predicted).toBeLessThan(20);
    expect(seasonalForecast([]).predicted).toBe(0);
  });

  it('tendência é limitada e ignora volumes pequenos', () => {
    expect(trendFactor(120, 100)).toBeCloseTo(1.2);
    expect(trendFactor(500, 100)).toBe(1.4);
    expect(trendFactor(10, 100)).toBe(0.7);
    expect(trendFactor(30, 5)).toBe(1);
    expect(seasonalForecast([10, 10, 10], 1.2).predicted).toBe(12);
  });

  it('entregadores necessários e precisão (WAPE e viés)', () => {
    expect(driversNeeded(0, 2.5)).toBe(0);
    expect(driversNeeded(5, 2.5)).toBe(2);
    expect(driversNeeded(5.1, 2.5)).toBe(3);
    const accuracy = forecastAccuracy([
      { predicted: 10, actual: 8 },
      { predicted: 5, actual: 7 },
      { predicted: 0, actual: 0 },
    ]);
    expect(accuracy.wape).toBeCloseTo(4 / 15, 3);
    expect(accuracy.bias).toBe(0);
    expect(forecastAccuracy([{ predicted: 1, actual: 0 }]).wape).toBeNull();
  });

  it('anomalias de volume respeitam o intervalo e o volume mínimo', () => {
    const forecast = seasonalForecast([10, 11, 9, 10]);
    expect(demandDeviation(11, forecast, { minVolume: 5, zThreshold: 2 })).toBeNull();
    expect(demandDeviation(30, forecast, { minVolume: 5, zThreshold: 2 })).toMatchObject({ kind: 'SPIKE' });
    expect(demandDeviation(0, forecast, { minVolume: 5, zThreshold: 2 })).toMatchObject({ kind: 'DROP' });
    // Previsão baixa: hora vazia não é queda.
    expect(demandDeviation(0, seasonalForecast([2, 1, 2]), { minVolume: 5, zThreshold: 2 })).toBeNull();
  });

  it('z binomial e mediana', () => {
    expect(binomialZ(5, 100, 0.05)).toBe(0);
    expect(binomialZ(30, 100, 0.05)).toBeGreaterThan(10);
    expect(binomialZ(0, 0, 0.05)).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
