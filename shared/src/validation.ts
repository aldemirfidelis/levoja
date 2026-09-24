/**
 * Validações de documentos e contatos brasileiros.
 * Usadas no backend (fonte da verdade) e nas interfaces (feedback imediato).
 */

export const onlyDigits = (value: string): string => value.replace(/\D/g, '');

/** CPF: 11 dígitos com dois dígitos verificadores (módulo 11). */
export function isValidCpf(input: string): boolean {
  const cpf = onlyDigits(input);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const digit = (length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

/** Normaliza CNPJ: remove pontuação e converte letras para maiúsculas. */
export const normalizeCnpj = (value: string): string => value.toUpperCase().replace(/[^0-9A-Z]/g, '');

/**
 * CNPJ numérico ou alfanumérico (IN RFB nº 2.229/2024, vigente desde jul/2026).
 * As 12 primeiras posições aceitam [0-9A-Z]; os 2 dígitos verificadores são numéricos.
 * Cada caractere vale (código ASCII − 48), e os pesos seguem o algoritmo do módulo 11.
 */
export function isValidCnpj(input: string): boolean {
  const cnpj = normalizeCnpj(input);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const value = (char: string) => char.charCodeAt(0) - 48;
  const digit = (length: number): number => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < length; i++) sum += value(cnpj[i]) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return digit(12) === Number(cnpj[12]) && digit(13) === Number(cnpj[13]);
}

/**
 * Normaliza telefone brasileiro para E.164 (+55DDNNNNNNNNN).
 * Retorna null quando o número não é um celular/fixo brasileiro plausível.
 */
export function normalizeBrazilianPhone(input: string): string | null {
  let digits = onlyDigits(input);
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length !== 10 && digits.length !== 11) return null;
  const ddd = Number(digits.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;
  if (digits.length === 11 && digits[2] !== '9') return null;
  return `+55${digits}`;
}

export const isValidCep = (input: string): boolean => /^\d{8}$/.test(onlyDigits(input));

export const isValidEmail = (input: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.trim()) && input.length <= 254;

/** Regras mínimas de senha: 8+ caracteres, com letra e número. */
export function passwordIssues(password: string): string[] {
  const issues: string[] = [];
  if (password.length < 8) issues.push('A senha deve ter pelo menos 8 caracteres.');
  if (password.length > 128) issues.push('A senha deve ter no máximo 128 caracteres.');
  if (!/[A-Za-z]/.test(password)) issues.push('A senha deve conter ao menos uma letra.');
  if (!/\d/.test(password)) issues.push('A senha deve conter ao menos um número.');
  return issues;
}

export function formatCpf(value: string): string {
  const d = onlyDigits(value).padEnd(11, ' ').slice(0, 11);
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`.trim();
}

export function formatCnpj(value: string): string {
  const c = normalizeCnpj(value);
  if (c.length !== 14) return value;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

/** Mascara documento para exibição (LGPD: minimização). */
export function maskDocument(value: string): string {
  const d = normalizeCnpj(value);
  if (d.length <= 4) return '****';
  return `${'*'.repeat(d.length - 4)}${d.slice(-4)}`;
}

export function isAdult(birthDate: Date, reference = new Date(), minAge = 18): boolean {
  const limit = new Date(birthDate);
  limit.setFullYear(limit.getFullYear() + minAge);
  return limit.getTime() <= reference.getTime();
}
