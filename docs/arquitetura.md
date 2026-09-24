# Arquitetura

## Visão geral

```
                    ┌──────────────────────────┐
  App Cliente  ───► │                          │ ───► PostgreSQL (dados transacionais)
  App Entregador ─► │   API LevoJá (NestJS)    │ ───► Redis (cache, filas BullMQ, rate limit, pub/sub)
  Portal Web  ────► │   REST /v1 + Socket.IO   │ ───► Object Storage S3 (documentos, imagens)
  Painel Admin ───► │                          │ ───► Provedores: pagamentos, mapas, e-mail, push, SMS
                    └──────────────────────────┘
```

- **Monólito modular**: um único deploy da API, com módulos de domínio isolados (pastas, serviços e eventos
  próprios). Permite começar simples e extrair serviços (ex.: despacho, rastreamento) quando a escala exigir,
  sem reescrever regras de negócio.
- **Stateless**: sessões em tokens, estado compartilhado no Redis → escala horizontal atrás de um load balancer.
- **Eventos de domínio** (`@nestjs/event-emitter`) desacoplam efeitos colaterais (notificações, métricas,
  auditoria) das regras principais. Tarefas assíncronas e agendadas vão para a fila (BullMQ).

## Módulos do backend

| Módulo | Responsabilidade | Fase |
|---|---|---|
| `auth` | cadastro, login, MFA, refresh, redefinição de senha, verificação | 1 |
| `access` | RBAC: papéis, permissões, perfil de acesso cacheado | 1 |
| `users` | perfil, administração de usuários, convites | 1 |
| `tenants` | resolução de tenant (cabeçalho, domínio) | 1 |
| `companies` | cadastro, documentos, horários, equipe, aprovação | 1 |
| `drivers` | cadastro, veículos, documentos, aprovação | 1 |
| `customers` | endereços | 1 |
| `privacy` | documentos legais, consentimentos, direitos do titular (LGPD) | 1 |
| `notifications` | central de notificações (in-app, push, e-mail, SMS/WhatsApp) | 1 |
| `audit` | trilha de auditoria | 1 |
| `segments` | categorias da Home | 1 |
| `admin` | dashboard administrativo | 1 |
| `settings` | parâmetros por tenant validados (marketplace, despacho, financeiro) | 2 |
| `catalog` | catálogo, áreas de atendimento, vitrine | 2 |
| `cart`, `orders` | carrinho, cotação, checkout, máquina de estados do pedido | 2 |
| `pricing`, `geo` | motor de precificação, camada de mapas | 2–3 |
| `realtime` | Socket.IO (salas por usuário, empresa, entregador e operação) | 2 |
| `logistics` | entregas, despacho, rastreamento, geofence, prova de entrega, avaliações | 3 |
| `coupons` | cupons e promoções | 4 |
| `finance` | pagamentos, estornos, razão/carteiras, comissões, liquidação, saques, conciliação | 4 |

Próximas fases: ver [roadmap](roadmap.md). Decisões do financeiro: [ADR 0003](adr/0003-financeiro-ledger-e-liquidacao.md).

## Camadas transversais

| Camada | Implementação |
|---|---|
| Configuração | `src/config/env.ts` — validação com Zod na inicialização; produção exige Redis e S3 |
| Contexto da requisição | `AsyncLocalStorage` com requestId, IP, usuário e tenant (logs e auditoria) |
| Autorização | guards globais `JwtAuthGuard` → `PermissionsGuard` → `CompanyAccessGuard` |
| Validação | `class-validator` com `whitelist` + `forbidNonWhitelisted` (campos extras são rejeitados) |
| Erros | filtro único: `{ statusCode, error, message, details?, requestId }` |
| Logs | JSON estruturado (pino), com redação de dados sensíveis |
| Métricas | Prometheus em `/metrics` (latência por rota, erros, eventos de negócio) |
| Saúde | `/health` (liveness) e `/health/ready` (banco, cache, armazenamento) |
| Documentação | OpenAPI em `/docs` e `/docs/openapi.json` |

## Integrações externas: camada de abstração + modo de desenvolvimento

Cada integração tem uma interface e pelo menos uma implementação real. Enquanto a integração não é
contratada, um modo de desenvolvimento **explícito** (configurado por variável de ambiente) é usado:

| Integração | Produção | Desenvolvimento |
|---|---|---|
| Arquivos | S3 compatível | disco local (`STORAGE_DRIVER=local`) |
| E-mail | SMTP (SES, SendGrid, Mailgun...) | log ou Mailpit |
| Push | Expo Push Service | log |
| SMS/WhatsApp | interface `SmsProvider` (Twilio, Zenvia...) | log |
| Cache/filas | Redis + BullMQ | memória / execução em processo |
| Mapas e rotas | OSRM + Nominatim (`MAPS_PROVIDER`, `GEOCODER`) | estimativa por distância em linha reta × 1,35 |
| Pagamentos | Mercado Pago (`PAYMENT_GATEWAY=mercadopago`) ou `none` (só dinheiro) | `sandbox` — PIX e cartões simulados; **proibido em produção** |
| Saques (PIX) | `PAYOUT_PROVIDER=manual` (financeiro transfere e confirma) | `sandbox` — transferência simulada; **proibido em produção** |

## Aplicativos (Expo)

- **Pacotes:** `mobile-kit` (código compartilhado, TypeScript consumido direto pelo Metro), `mobile-client` e
  `mobile-driver` (Expo Router em `src/app`). O `node-linker=hoisted` e a versão única de React evitam cópias
  duplicadas no bundle.
- **Sessão:** o refresh token fica no armazenamento seguro do sistema; o access token só em memória. Várias
  requisições com 401 aguardam uma única renovação (o servidor revoga a família se um refresh for reutilizado).
- **Tempo real:** Socket.IO autenticado com o access token; eventos invalidam as consultas abertas.
- **Push:** o aparelho é registrado por app (`CUSTOMER`/`DRIVER`); a API envia cada aviso só ao app certo e
  usa o canal `offers` (alta prioridade, validade = tempo da oferta) para o entregador.
- **Entregador offline:** posições e ações vão para uma fila persistente (FIFO) e são enviadas quando a
  conexão volta — os pontos gravados antes da conclusão chegam antes dela, e a validação de distância da API
  continua valendo. Erros de regra (4xx) são descartados e avisados; erros temporários mantêm a fila.
- **GPS em segundo plano:** a tarefa é registrada no ponto de entrada do app (`index.ts`), antes do roteador,
  porque o sistema pode iniciar o JavaScript sem interface só para entregar posições.

## Multi-tenant

- Toda entidade de negócio possui `tenantId` (isolamento lógico em um único banco).
- O tenant de requisições públicas vem do cabeçalho `X-Tenant` ou do domínio (white label); em requisições
  autenticadas, o tenant do token prevalece.
- Papéis são por tenant (cada operação white label pode ajustar permissões).

## Modelo de dados (Fase 1)

```
Tenant ─┬─ User ─┬─ UserRole ── Role ── RolePermission ── Permission
        │        ├─ RefreshToken / OneTimeToken
        │        ├─ Consent / PrivacyRequest
        │        ├─ Address
        │        ├─ Customer
        │        ├─ Driver ─┬─ Vehicle
        │        │          ├─ DriverDocument / DriverStatusHistory
        │        │          └─ BankAccount
        │        ├─ CompanyUser ── Company ─┬─ CompanyDocument / CompanyStatusHistory
        │        │                          ├─ CompanyOpeningHour
        │        │                          └─ BankAccount
        │        └─ Notification / DeviceToken
        ├─ Segment
        ├─ LegalDocument
        └─ PlatformSetting
AuditLog (append-only)
```
