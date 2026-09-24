import { redactPersonalData } from './support-assist.service';

describe('dados pessoais antes da IA', () => {
  it('remove telefone, CPF, e-mail e cartão e mantém o restante do texto', () => {
    const text = 'Sou a Ana, CPF 123.456.789-09, fone (11) 98888-7777 ou +55 11 3333-4444, e-mail ana.silva@exemplo.com, cartão 4111 1111 1111 1111. Pedido #120 atrasou.';
    const redacted = redactPersonalData(text);
    expect(redacted).not.toMatch(/98888|3333-4444|123\.456|ana\.silva|4111/);
    expect(redacted).toContain('[cpf]');
    expect(redacted).toContain('[telefone]');
    expect(redacted).toContain('[e-mail]');
    expect(redacted).toContain('[cartão]');
    expect(redacted).toContain('Pedido #120 atrasou.');
  });
});
