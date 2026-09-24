import { analyzeReview } from './sentiment';

describe('análise de avaliações (léxico)', () => {
  it('combina nota e texto', () => {
    expect(analyzeReview(5, 'Muito bom, chegou rápido e quentinho!')).toMatchObject({ sentiment: 'POSITIVE' });
    expect(analyzeReview(1, 'Péssimo, atrasou mais de uma hora e veio frio')).toMatchObject({ sentiment: 'NEGATIVE' });
    expect(analyzeReview(3, null)).toMatchObject({ sentiment: 'NEUTRAL', themes: [] });
    expect(analyzeReview(5, null).sentiment).toBe('POSITIVE');
  });

  it('negação inverte a polaridade', () => {
    expect(analyzeReview(3, 'não gostei, não recomendo').sentiment).toBe('NEGATIVE');
    expect(analyzeReview(3, 'não demorou nada, entregador educado').sentiment).toBe('POSITIVE');
  });

  it('texto negativo pesa mesmo com nota alta', () => {
    const analysis = analyzeReview(4, 'Entregador mal educado e a pizza chegou fria');
    expect(analysis.sentiment).toBe('NEGATIVE');
    expect(analysis.themes).toEqual(expect.arrayContaining(['rudeness', 'temperature', 'food_quality']));
    expect(analysis.themes).not.toContain('courtesy');
  });

  it('identifica temas da lista fechada', () => {
    expect(analyzeReview(2, 'Faltou o refrigerante e a embalagem vazou').themes).toEqual(expect.arrayContaining(['missing_item', 'packaging']));
    expect(analyzeReview(5, 'Super rápido, antes do previsto').themes).toContain('speed');
    expect(analyzeReview(2, 'O entregador não achou o endereço').themes).toContain('location');
  });
});
