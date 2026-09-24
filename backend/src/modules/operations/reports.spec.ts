import { formatLocalDate, parseLocalDate, periodRange, reportRange, startOfLocalDay } from '../../common/time-range';
import { bucketKeys, ReportsService } from './reports.service';

const TZ = 'America/Sao_Paulo';

describe('Períodos no fuso da operação', () => {
  it('início do dia local e datas locais', () => {
    // 02:30 UTC de 24/09 ainda é 23:30 de 23/09 em São Paulo.
    const instant = new Date('2026-09-24T02:30:00Z');
    expect(startOfLocalDay(instant, TZ).toISOString()).toBe('2026-09-23T03:00:00.000Z');
    expect(formatLocalDate(instant, TZ)).toBe('2026-09-23');
    expect(parseLocalDate('2026-09-01', TZ).toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(() => parseLocalDate('01/09/2026', TZ)).toThrow();
  });

  it('respeita horário de verão em outros fusos', () => {
    // Nova York: 08/03/2026 começa o horário de verão (meia-noite ainda é UTC-5).
    expect(parseLocalDate('2026-03-08', 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(parseLocalDate('2026-03-09', 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('períodos móveis e intervalo de relatório (fim inclusivo, limites)', () => {
    const now = new Date('2026-09-24T15:00:00Z');
    expect(periodRange('today', TZ, now).from.toISOString()).toBe('2026-09-24T03:00:00.000Z');
    expect(periodRange('week', TZ, now).from.toISOString()).toBe('2026-09-18T03:00:00.000Z');
    expect(periodRange('month', TZ, now).from.toISOString()).toBe('2026-08-26T03:00:00.000Z');

    const range = reportRange('2026-09-01', '2026-09-30', TZ, now);
    expect(range.from.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect([range.fromDate, range.toDate]).toEqual(['2026-09-01', '2026-09-30']);
    const fallback = reportRange(undefined, undefined, TZ, now);
    expect([fallback.fromDate, fallback.toDate]).toEqual(['2026-08-26', '2026-09-24']);
    expect(() => reportRange('2026-09-10', '2026-09-01', TZ, now)).toThrow();
    expect(() => reportRange('2024-01-01', '2026-09-01', TZ, now)).toThrow();
  });
});

describe('Períodos dos gráficos', () => {
  it('dias, semanas (segunda-feira) e meses', () => {
    expect(bucketKeys('2026-09-28', '2026-10-02', 'day')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    // 24/09/2026 é quinta: a primeira semana começa na segunda, 21/09.
    expect(bucketKeys('2026-09-24', '2026-10-06', 'week')).toEqual(['2026-09-21', '2026-09-28', '2026-10-05']);
    expect(bucketKeys('2026-01-31', '2026-04-01', 'month')).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
  });
});

describe('CSV dos relatórios', () => {
  const service = new ReportsService({} as never, {} as never);

  it('usa ";" e BOM, formata valores e protege contra fórmulas', () => {
    const csv = service.toCsv({
      title: 'Teste',
      columns: [
        { key: 'name', label: 'Nome; "loja"', type: 'text' },
        { key: 'amount', label: 'Valor', type: 'money' },
        { key: 'rate', label: 'Taxa', type: 'percent' },
        { key: 'count', label: 'Qtd', type: 'int' },
      ],
      rows: [
        { name: 'Pizzaria', amount: 123456, rate: 12.345, count: 3 },
        { name: '=HYPERLINK("x")', amount: -500, rate: null, count: 0 },
      ],
    });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe('"Nome; ""loja""";Valor;Taxa;Qtd');
    expect(lines[1]).toBe('Pizzaria;1234,56;12,3;3');
    expect(lines[2]).toBe(`"'=HYPERLINK(""x"")";-5,00;;0`);
  });
});
