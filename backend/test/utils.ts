import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { MailService } from '../src/infra/mail/mail.service';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  mail: MailService;
  http: () => ReturnType<typeof request>;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    mail: app.get(MailService),
    http: () => request(app.getHttpServer()),
  };
}

let sequence = 0;
/** Gera dados únicos por teste (e-mail, telefone, CPF e CNPJ válidos). */
export function uniqueIdentity() {
  sequence += 1;
  const seed = `${Date.now()}${sequence}${Math.floor(Math.random() * 1000)}`;
  const digits = seed.slice(-8).padStart(8, '0');
  return {
    email: `teste.${seed}@levoja.test`,
    phone: `119${digits}`,
    cpf: generateCpf(`${digits}${sequence % 10}`),
    cnpj: generateCnpj(`${digits}0001`),
  };
}

function generateCpf(base9: string): string {
  const digits = base9.slice(0, 9).split('').map(Number);
  if (new Set(digits).size === 1) digits[0] = (digits[0] + 1) % 10;
  const calc = (length: number) => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += digits[i] * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  digits.push(calc(9));
  digits.push(calc(10));
  return digits.join('');
}

function generateCnpj(base12: string): string {
  const digits = base12.slice(0, 12).split('').map(Number);
  const calc = (weights: number[]) => {
    const sum = weights.reduce((total, weight, index) => total + digits[index] * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  digits.push(calc([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  digits.push(calc([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  return digits.join('');
}

export const ADMIN = { login: 'admin@levoja.test', password: 'AdminTeste123' };

export async function login(ctx: TestContext, credentials: { login: string; password: string }, app?: string) {
  const response = await ctx.http().post('/v1/auth/login').send({ ...credentials, app }).expect(200);
  return response.body.accessToken as string;
}

/** PDF mínimo válido (assinatura %PDF-) para testes de upload. */
export const SAMPLE_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
/** PNG 1x1 válido. */
export const SAMPLE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
