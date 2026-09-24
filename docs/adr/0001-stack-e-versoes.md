# ADR 0001 — Stack e versões

- **Status:** aceito
- **Data:** 2026-09-23

## Contexto

O produto precisa começar pequeno (1 cidade) e crescer para múltiplos estados sem reescrita.
A equipe precisa de um ecossistema maduro, com boa oferta de profissionais e bibliotecas.

Em setembro de 2026 havia versões "major" muito recentes no ecossistema:

| Pacote | Última major | Situação |
|---|---|---|
| NestJS | 12 (lançado em 27/08/2026, **ESM-only**) | ecossistema (pino, throttler, swagger plugins) ainda migrando |
| TypeScript | 7 (compilador nativo em Go) | API do compilador incompatível com ts-jest / Nest CLI |
| Prisma | 8 (release candidate) | não estável |

## Decisão

| Camada | Escolha |
|---|---|
| API | **NestJS 11.2** (CommonJS) + **TypeScript 5.9** |
| Banco | **PostgreSQL 17** |
| ORM | **Prisma 7.10** com driver adapter `@prisma/adapter-pg` e gerador `prisma-client` |
| Cache / filas / rate limit | **Redis 7** + **BullMQ** (opcionais em desenvolvimento) |
| Tempo real | **Socket.IO** (adapter Redis para múltiplas instâncias) |
| Arquivos | **S3 compatível** (AWS S3, MinIO, Cloudflare R2) — driver local em dev |
| Web | **Next.js 16** + React 19 |
| Apps | **React Native + Expo** (Android primeiro, iOS preparado) |
| Testes | Jest 30 + Supertest (E2E contra PostgreSQL real) |

## Consequências

- Linhas de versão estáveis e amplamente documentadas, com suporte ativo (NestJS 11 segue recebendo correções).
- **Migração planejada:** avaliar NestJS 12 (ESM) e TypeScript 7 quando `nestjs-pino`, `@nestjs/throttler`,
  `ts-jest` e o CLI do Nest estiverem estáveis nas novas versões. O código evita padrões que dificultem a
  migração para ESM (sem `require` dinâmico, sem `__dirname` em código de domínio).
- Redis é opcional em desenvolvimento (implementações em memória), mas **obrigatório em produção** — validado
  na inicialização (`env.ts`).
