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
| `chat` | conversas por pedido/entrega (cliente, loja, entregador), ligação mascarada, leitura auditada da equipe | 6 |
| `support` | chamados, SLA (primeira resposta e resolução), anexos privados, notas internas, avaliação | 6 |
| `operations` | torre de controle, mapa de calor, amostras agregadas de presença, relatórios (BI/CSV), painéis da empresa e da plataforma | 6 |
| `broadcasts` | comunicados em massa (promoção com consentimento; aviso operacional para parceiros) | 6 |
| `b2b` | contratos, tabela especial, limites, centros de custo, unidades, lotes e rotas, recorrências, faturas, chaves de API | 7 |
| `intelligence` | antifraude (sinais, score, casos), previsão de demanda e de entregadores, calibração do tempo de entrega, anomalias, adicionais de preço com aprovação, análise de avaliações, IA assistiva | 8 |
| `cities` | cidades atendidas, situação de operação, bloqueio de pedidos/entregas, lista de espera e indicadores por cidade | 9 |
| `saas` | planos, assinaturas, cobrança mensal na carteira, recursos (`@RequireFeature`) e limites por plano | 9 |
| `tenants` (admin) | provisionamento de tenants white label, marca do tenant, marca própria das empresas | 9 |
| `public-api` | webhooks assinados, uso das chaves de API e painel de integração | 9 |

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
| Ligação mascarada | Twilio (`VOICE_PROVIDER=twilio`): ponte com o número da plataforma | `none` — recurso oculto; o chat continua disponível |
| Webhooks (saída) | HTTPS com IP público, assinatura HMAC e novas tentativas | `WEBHOOK_ALLOW_PRIVATE_URLS=true` — permite `http://localhost` (proibido em produção) |
| IA assistiva | Claude pela API da Anthropic (`AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `AI_MODEL`) | `none` — modelos de texto, léxico e indicadores calculados (todos os recursos continuam funcionando) |

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

## Operação (Fase 6)

- **Chat:** a conversa pertence a um pedido ou entrega; quem participa é recalculado a cada acesso a partir do
  estado atual (ex.: o entregador que desiste perde o acesso). A conversa fica somente leitura após uma janela
  configurável. Nenhuma resposta inclui telefone; a equipe de suporte lê (não escreve) e o acesso é auditado.
- **Chamados:** prioridade inicial por regra (pagamento/reembolso e pedidos em andamento sobem), prazos de SLA
  por prioridade vindos das configurações, verificação a cada 5 minutos (alerta uma única vez) e encerramento
  automático de resolvidos. Anexos são validados pelo conteúdo e ficam em área privada do armazenamento.
- **Torre de controle:** uma leitura consolidada (`snapshot`) alimenta mapa, indicadores e alertas; eventos de
  tempo real antecipam a atualização. "Atrasado" usa o prazo prometido: previsão do pedido ou, na entrega
  avulsa, início + duração estimada + folga configurável.
- **Mapa de calor e relatórios:** agregação no banco (grade por coordenadas; fuso da operação com
  `AT TIME ZONE`), sem carregar registros individuais na API. A disponibilidade de entregadores é guardada só
  como contagem por célula a cada 5 minutos (LGPD). Relatórios devolvem indicadores, séries e tabelas genéricas;
  o CSV (separador `;`, BOM, valores em reais) é gerado a partir da mesma tabela e a exportação é auditada.
- **Comunicados:** promoções respeitam o consentimento mais recente de cada canal; avisos operacionais só vão
  para entregadores e empresas. O envio roda em segundo plano, em lotes, com contagem de alcance.
- **LGPD:** exportação e anonimização são extensíveis por eventos (`privacy.user.exporting`,
  `privacy.user.anonymized`): chat e atendimento acrescentam seus dados à exportação e removem o conteúdo
  escrito pelo titular após a exclusão.

## Corporativo (Fase 7)

- **Regras nas entregas:** o módulo B2B registra um gancho no serviço de entregas (mesmo padrão dos
  pagamentos): preço pelo contrato (tabela especial ou desconto) e validação de limites **dentro da transação
  de criação**, com trava por empresa (`pg_advisory_xact_lock`) — pedidos simultâneos não ultrapassam o
  crédito. Entregas únicas, lotes e recorrências usam o mesmo `insertPrepared`.
- **Lotes:** a planilha (CSV com `;`/`,`, Excel com proteção contra arquivos compactados maliciosos) vira linhas
  normalizadas; a validação roda em segundo plano (geocodificação com cache e no máximo 1 consulta/s ao
  Nominatim). Na confirmação, as linhas válidas são agrupadas em **rotas** (varredura angular por porte de
  veículo, paradas, capacidade e trechos longos; ordem por vizinho mais próximo + 2-opt) e as entregas são
  criadas numa única transação.
- **Despacho de rotas:** só o líder da rota recebe ofertas, e apenas entregadores livres; o aceite atribui todas
  as entregas da rota. Sem entregador dentro de `b2b.routeFallbackMinutes`, a rota é distribuída entrega a
  entrega; se o líder sai da busca, outra entrega assume.
- **Faturamento:** as entregas faturadas continuam lançando a dívida na carteira da empresa na conclusão; a
  fatura agrupa esses valores por período (entregue = taxa + gorjeta; não realizada = taxa) e o pagamento
  (PIX ou baixa manual) credita a carteira. A quitação avulsa de saldo desconta o que será cobrado em fatura.
- **Chaves de API:** guardadas como HMAC; a requisição age em nome de quem criou a chave, restrita à empresa e
  à interseção entre os escopos e as permissões atuais dessa pessoa, e só em rotas marcadas com `@AllowApiKey()`.

## Inteligência (Fase 8)

Princípio: regras explícitas e configuráveis, evidência guardada e **pessoa no controle** das decisões
críticas. Nenhuma conta é bloqueada, nenhum preço muda e nenhuma resposta é enviada sem alguém decidir.

- **Sinais de risco por evento:** os módulos emitem `risk.signal` (com a evidência e uma chave de
  idempotência) ou eventos de domínio (`auth.session.started`, `order.created`, `payment.failed`); o
  antifraude converte em pontos (`fraud.points`), recalcula o score com meia-vida e abre um caso acima de
  `fraud.caseScore` — com trava por conta, sem casos duplicados. Varredura diária (03h50) procura taxas de
  cancelamento e de desistência fora do padrão (desvio binomial) e aplica o decaimento.
- **Ações automáticas leves:** ganchos no checkout (`OrdersService.registerCheckoutGuard`: conta de risco
  alto paga online acima do limite), na elegibilidade de cupons (`CouponsService.registerEligibility`:
  primeira compra reaproveitada no mesmo aparelho/endereço) e na prova de entrega (GPS simulado). Descartar
  um caso isenta a conta por um período.
- **Aparelho:** `X-Device-Id` (app: id de instalação no armazenamento seguro; web: cookie httpOnly do BFF)
  entra no contexto da requisição; o antifraude guarda o HMAC por tenant, nunca o valor.
- **Previsão (a cada hora):** entregas por cidade e hora = média ponderada da mesma hora/dia nas últimas
  semanas × tendência (limitada), com intervalo de 80% e piso pelas entregas já agendadas. Entregadores
  necessários = previsão ÷ produtividade; esperados = presença habitual na área da cidade (amostras
  agregadas). Falta acima do limite gera `PricingSuggestion`; aprovada, vira `PricingSurcharge`, lida pelo
  `PricingService` no contexto da cotação (não vale para tabelas de contrato).
- **Tempo de entrega (diário):** fator real ÷ estimado por cidade × veículo × faixa horária, com recuo para
  grupos mais amplos; medianas de espera; preparo real por loja. O modelo fica em memória e é registrado
  em `DeliveriesService.eta` e na previsão do pedido.
- **Anomalias (a cada 10 min):** volume × intervalo previsto, cancelamentos e pagamentos recusados ×
  últimos 7 dias, despacho × mediana; chave de deduplicação por hora, encerramento automático quando o
  indicador volta e alertas na torre (`OperationsService.registerAlertSource`).
- **IA:** `AiProvider` abstrato (`DisabledAiProvider` / `AnthropicAiProvider` com o SDK oficial, saída
  estruturada validada por Zod e fallback no servidor em caso de recusa). `AiService` aplica recursos
  habilitados, limite diário e registra cada chamada (`AiInteraction`). Dados pessoais são removidos antes
  do envio; o assistente das lojas só tem ferramentas somente leitura presas à empresa da rota.

## Escala (Fase 9)

- **Tenants (white label da plataforma):** `provisionTenant` (usado pelo seed e pelo painel) cria de forma aditiva
  papéis, segmentos, preços, comissão, planos e documentos legais. A marca fica em `tenants.branding` e é
  exposta em `GET /v1/tenant`; portais e painel buscam a marca no servidor e trocam a paleta `--color-brand-*`
  (gerada a partir de uma cor) — um deploy de portal/painel por tenant (`TENANT_SLUG`). E-mails usam o nome e os
  endereços do tenant. Apps por marca são builds EAS parametrizados (nome, ícones, cor, bundle, tenant).
- **Cidades:** `CitiesService.gate` (cache curto) é consultado na cotação de pedidos (vira pendência) e de
  entregas (recusa). Cidade desconhecida é atendida, salvo `cities.restrictToRegistered`. A lista de espera cria a
  cidade "em preparação" — o painel mostra onde há demanda.
- **Planos SaaS:** `SubscriptionsService.effective` (cache de 30 s) resolve recursos e limites da empresa
  (desligado ⇒ tudo liberado). `PlanFeatureGuard` roda depois do acesso à empresa e respeita `@RequireFeature`
  (classe) com exceções por rota (`@RequireFeature(null)`); limites são conferidos nos serviços (produtos,
  equipe, chaves, unidades). Cobrança: lançamento `SUBSCRIPTION` na carteira da empresa e da plataforma
  (idempotente); a cobrança fica paga quando a carteira não está negativa. Ciclo horário: renovação, troca
  agendada, cancelamento e atraso (carência ⇒ `PAST_DUE`; depois, recursos do plano padrão).
- **API pública:** `@AllowApiKey(escopo)` marca a rota e a publica em `/docs/public`. O guard autentica a
  chave, registra o uso ao fim da resposta (inclusive recusas), confere escopo, recurso do plano e o limite
  por minuto (contador atômico no Redis). **Webhooks:** eventos de domínio viram entregas por endpoint
  (`webhook_deliveries`), enviadas por job com assinatura `t=,v1=` (HMAC-SHA256), sem seguir redirecionamentos,
  com checagem de IP público a cada envio, novas tentativas (1 min → 12 h) e desativação após 20 falhas.

## Complementos (Fase 10)

- **Módulo `growth`:** `CustomerHomeService` (favoritas, cupons listáveis, pedidos recentes, "pedir de novo" e
  o agregado `GET /v1/me/home`), `LoyaltyService`, `ReferralsService` e `FleetService`.
- **Fidelidade:** ouve `order.status.changed` (entregue) e lança pontos (`loyalty_transactions`, idempotente por
  `referenceKey`) e cashback no razão (`CREDIT` do cliente e `DISCOUNT` da plataforma). O nível é recalculado a
  cada ganho e revisto diariamente com a expiração. Cupom `TIER` usa o gancho `CouponsService.registerEligibility`.
- **Indicação:** gancho novo `AuthService.registerSignupHook` vincula o código dentro da transação do cadastro
  (código inválido recusa o cadastro; programa desligado ignora o código). Metas por eventos de pedido e de
  entrega; antes de pagar, confere aparelhos em comum (`device_sightings`) — em caso positivo, retém e emite
  `REFERRAL_ABUSE`. O pagamento é uma transição única para `REWARDED` com lançamentos idempotentes.
- **Concorrência:** ouvintes do mesmo evento lançam nas mesmas carteiras (liquidação, indicação, cashback);
  `retryOnConflict` repete a transação em deadlock/conflito de serialização.
- **Configurações:** `SettingsService` mescla o valor salvo sobre o padrão (dois níveis), então campos novos
  não invalidam configurações antigas.
- **PWA:** `app/manifest.ts` (marca do tenant), ícones por `ImageResponse` (`/pwa-icon/192|512`), `public/sw.js`
  (rede primeiro nas páginas com fallback offline, cache dos estáticos versionados, nunca `/api/*`) e
  notificações do navegador a partir do evento `notification` do tempo real.

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
