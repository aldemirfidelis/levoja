# LevoJá

Plataforma de **marketplace + delivery + logística sob demanda + SaaS B2B**. Conecta clientes, empresas
(restaurantes, farmácias, mercados, lojas...) e entregadores, e também atende entregas avulsas
(pessoa → pessoa, empresa → cliente) e corporativas.

> Status: **Fases 1 a 5 concluídas** — fundação (API, autenticação, RBAC, LGPD, auditoria), marketplace,
> logística, financeiro e os aplicativos Android/iOS do cliente e do entregador. Veja o [roadmap](docs/roadmap.md).

## Estrutura

```
backend/          API REST + WebSocket (NestJS 11, Prisma 7, PostgreSQL 17)
frontend/         Portal web (Next.js 16): site, cadastros, área do cliente, portal da empresa, onboarding do entregador
admin/            Painel administrativo (Next.js 16): Super Admin, operação, análise de cadastros, auditoria
mobile-client/    App do cliente (Expo SDK 57): lojas, sacola, PIX/cartão/créditos, rastreio ao vivo, envios avulsos
mobile-driver/    App do entregador (Expo SDK 57): ofertas, rota, prova de entrega, GPS em segundo plano, fila offline, ganhos
mobile-kit/       Kit dos apps: cliente HTTP com tokens no Keychain/Keystore, autenticação, tempo real, push, UI, telas de conta
shared/           Contratos compartilhados: permissões, status, máquinas de estado, validações (CPF/CNPJ), dinheiro, geo
web-kit/          Kit dos apps web: BFF (sessão em cookie httpOnly), cliente HTTP, componentes de UI
docs/             Arquitetura, ADRs e roadmap
infrastructure/   Docker Compose (Postgres, Redis, MinIO, Mailpit) e Dockerfiles
scripts/          Utilitários (PostgreSQL embutido para desenvolvimento sem Docker)
```

## Pré-requisitos

- Node.js 22+ (recomendado 24) e pnpm 9 (`corepack enable`)
- **Uma** das opções de banco:
  - Docker: `docker compose -f infrastructure/docker-compose.yml up -d` (Postgres, Redis, MinIO, Mailpit)
  - Sem Docker: `pnpm db:embedded` (PostgreSQL embutido, mantém o terminal aberto)

> O banco de desenvolvimento usa a porta **5433** para não conflitar com um PostgreSQL já instalado na 5432.

## Primeiros passos

```bash
pnpm install

# 1. Banco (escolha um)
docker compose -f infrastructure/docker-compose.yml up -d
# ou
pnpm db:embedded            # em outro terminal

# 2. API
cd backend
cp .env.example .env        # gere as chaves (instruções no arquivo)
pnpm prisma:deploy          # aplica as migrations
pnpm db:seed                # dados essenciais + Super Admin (senha exibida uma vez)
pnpm db:seed:dev            # opcional: 10 empresas, 30 clientes, 20 entregadores fictícios
pnpm dev                    # http://localhost:3333  (docs: /docs)

# 3. Web
pnpm dev:web                # portal     http://localhost:3000
pnpm dev:admin              # admin      http://localhost:3001
```

Credenciais do Super Admin: `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` do `.env` (se a senha ficar vazia,
o seed gera uma aleatória e a exibe uma única vez).

## Aplicativos (Android e iOS)

```bash
cd mobile-client            # ou mobile-driver
cp .env.example .env        # EXPO_PUBLIC_API_URL: http://10.0.2.2:3333 no emulador Android; IP da máquina no aparelho
pnpm start                  # Metro; "a" abre no emulador Android
npx expo run:android        # build de desenvolvimento local (necessário para push e GPS em segundo plano)
```

| Recurso | Expo Go | Build de desenvolvimento/produção |
|---|---|---|
| Telas, pedidos, pagamentos, mapa, câmera/QR | ✅ | ✅ |
| Push (Expo Push Service) | ❌ (Android, desde o SDK 53) | ✅ com `EAS_PROJECT_ID` |
| GPS em segundo plano do entregador | ❌ (o app usa o GPS com a tela aberta) | ✅ serviço com notificação fixa |

- Builds na nuvem: `npx eas-cli@latest build --profile preview|production` (perfis em `eas.json`; as variáveis
  `EXPO_PUBLIC_*` de cada ambiente ficam nas *environments* do EAS, nunca no repositório).
- Ícones: `python scripts/app-icons.py` regenera os ícones dos dois apps.
- Sessão: somente o refresh token é gravado (Keychain/Keystore); o access token fica em memória.
- Cartão: os dados são digitados nos campos seguros do provedor (Mercado Pago) e o app recebe só o token;
  no sandbox o app oferece cartões de teste identificados.

## Testes

```bash
pnpm --filter @levoja/shared test          # contratos (CPF, CNPJ alfanumérico, máquinas de estado, dinheiro, geo)
pnpm --filter @levoja/backend test         # unitários (criptografia, TOTP RFC 6238, horários, fluxo de aprovação, auditoria)
pnpm --filter @levoja/backend test:e2e     # E2E: API + PostgreSQL real (banco levoja_test)
pnpm --filter @levoja/backend typecheck
pnpm --filter @levoja/mobile-kit test      # cliente HTTP (renovação única de token) e fila offline
pnpm --filter @levoja/mobile-client test   # agendamento dentro do horário da loja
pnpm --filter @levoja/mobile-driver test   # status com ações offline e saneamento do GPS
pnpm --filter @levoja/mobile-client export:android   # bundle Android (Metro/Hermes) — também roda no CI
```

Os testes E2E aplicam as migrations no banco `levoja_test` e usam identidades únicas por execução —
podem ser repetidos sem limpar o banco. Cobrem as fases 1 a 5 (fundação, marketplace, logística,
financeiro e os contratos usados pelos apps: push segmentado por app, login com MFA no app, detalhe da
entrega do entregador).

### Pagamentos em desenvolvimento (sandbox)

Com `PAYMENT_GATEWAY=sandbox` (padrão do `.env.example`):

- **PIX**: o pedido gera um "copia e cola" válido estruturalmente (não pagável). Confirme com
  `POST /v1/payments/sandbox/{paymentId}/approve` ou pelo botão "Simular pagamento" nas telas.
- **Cartão**: envie `cardToken` = `tok_approved`, `tok_declined` ou `tok_insufficient`.
- **Saques** (`PAYOUT_PROVIDER=sandbox`): a aprovação no painel conclui a transferência na hora.

Em produção, `sandbox` é recusado na inicialização; use `PAYMENT_GATEWAY=none` (apenas dinheiro) ou
`mercadopago` (com `MERCADOPAGO_ACCESS_TOKEN` e `MERCADOPAGO_WEBHOOK_SECRET`) e `PAYOUT_PROVIDER=manual`.

## Principais decisões

| Tema | Decisão | Detalhes |
|---|---|---|
| Stack | NestJS 11 + Prisma 7 + PostgreSQL 17, Next.js 16, Expo | [ADR 0001](docs/adr/0001-stack-e-versoes.md) |
| Segurança e LGPD | JWT curto + refresh rotativo, Argon2id, AES-256-GCM, RBAC, auditoria, anonimização | [ADR 0002](docs/adr/0002-seguranca-e-lgpd.md) |
| Arquitetura | Monólito modular, stateless, eventos de domínio, integrações atrás de interfaces | [Arquitetura](docs/arquitetura.md) |
| Dinheiro | Inteiros em centavos em todo o sistema | `shared/src/money.ts` |
| Multi-tenant | `tenantId` em todas as entidades; tenant por cabeçalho `X-Tenant` ou domínio | [Arquitetura](docs/arquitetura.md#multi-tenant) |
| Financeiro | Razão imutável e idempotente, liquidação por evento, saques com retenção antifraude | [ADR 0003](docs/adr/0003-financeiro-ledger-e-liquidacao.md) |

## API

- Base: `http://localhost:3333/v1` · OpenAPI: `/docs` e `/docs/openapi.json`
- Saúde: `/health` (liveness) e `/health/ready` (banco, cache, armazenamento) · Métricas: `/metrics` (Prometheus)
- Erros sempre no formato `{ statusCode, error, message, details?, requestId }`

## Variáveis de ambiente

Documentadas em `backend/.env.example`, `frontend/.env.example` e `admin/.env.example`.
A API valida todas na inicialização e, em produção, **exige** Redis, armazenamento S3 e segredos definidos.
Nunca versione arquivos `.env`.
